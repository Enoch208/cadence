import { and, asc, eq, exists, gt, lte, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { publishedPlanSchema } from "@cadence/core";
import {
  accountConnections,
  executionIntents,
  notifications,
  planVersions,
  receipts,
  users,
  type Db,
  type Executor,
  type NotificationRow,
} from "@cadence/db";
import { logLine } from "./log";
import { orderMessage, type MessageFacts } from "./notify-message";
import type { Delivery, MessageSender } from "./notify-telegram";

export type NotifierDeps = {
  db: Db;
  now: () => number;
  sender: MessageSender;
  webOrigin: string;
};

export type NotifyReport = { superseded: number; abandoned: number; delivered: number };

export const notificationLeaseMs = 60_000;
export const maxNotificationAttempts = 5;

const maxPerPass = 20;

export const notificationBackoffMs = (attempts: number) =>
  Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));

const later = alias(notifications, "later");

const hasLaterSibling = (db: Executor) =>
  exists(
    db
      .select({ id: later.id })
      .from(later)
      .where(and(eq(later.intentId, notifications.intentId), gt(later.id, notifications.id))),
  );

async function supersedeOlder(db: Db): Promise<number> {
  const superseded = await db
    .update(notifications)
    .set({ status: "superseded" })
    .where(and(eq(notifications.status, "pending"), hasLaterSibling(db)))
    .returning({ id: notifications.id });
  return superseded.length;
}

async function abandonStaleClaims(db: Db, now: number): Promise<number> {
  const abandoned = await db
    .update(notifications)
    .set({
      status: "failed",
      failure: "Unconfirmed: the worker stopped while sending, so it is not sent again",
    })
    .where(
      and(
        eq(notifications.status, "claimed"),
        lte(notifications.claimedAt, now - notificationLeaseMs),
      ),
    )
    .returning({ id: notifications.id });
  return abandoned.length;
}

type Claimed = Pick<NotificationRow, "id" | "intentId" | "userId" | "state" | "attempts">;
type Claim = { notification: Claimed; facts: MessageFacts; botStarted: boolean };

async function factsFor(db: Executor, notification: Claimed) {
  const [row] = await db
    .select({
      chatId: users.telegramUserId,
      botStartedAt: users.botStartedAt,
      market: executionIntents.market,
      environment: accountConnections.environment,
      payload: planVersions.payload,
      receiptId: receipts.id,
    })
    .from(executionIntents)
    .innerJoin(users, eq(users.id, executionIntents.userId))
    .innerJoin(accountConnections, eq(accountConnections.id, executionIntents.accountConnectionId))
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .leftJoin(receipts, eq(receipts.intentId, executionIntents.id))
    .where(eq(executionIntents.id, notification.intentId));
  if (row === undefined) {
    throw new Error(`Notification ${String(notification.id)} names no execution intent`);
  }
  const facts: MessageFacts = {
    chatId: row.chatId,
    intentId: notification.intentId,
    state: notification.state,
    market: row.market,
    direction: publishedPlanSchema.parse(row.payload).direction,
    environment: row.environment,
    receiptReady: row.receiptId !== null,
  };
  return { facts, botStarted: row.botStartedAt !== null };
}

function claimNextNotification(db: Db, now: number): Promise<Claim | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, "pending"),
          lte(notifications.nextAttemptAt, now),
          not(hasLaterSibling(tx)),
        ),
      )
      .orderBy(asc(notifications.nextAttemptAt), asc(notifications.id))
      .limit(1)
      .for("update", { of: notifications, skipLocked: true });
    if (candidate === undefined) {
      return null;
    }
    const [notification] = await tx
      .update(notifications)
      .set({ status: "claimed", claimedAt: now, attempts: sql`${notifications.attempts} + 1` })
      .where(eq(notifications.id, candidate.id))
      .returning({
        id: notifications.id,
        intentId: notifications.intentId,
        userId: notifications.userId,
        state: notifications.state,
        attempts: notifications.attempts,
      });
    if (notification === undefined) {
      return null;
    }
    return { notification, ...(await factsFor(tx, notification)) };
  });
}

const stillClaimed = (id: number) =>
  and(eq(notifications.id, id), eq(notifications.status, "claimed"));

async function fail(db: Db, notification: Claimed, failure: string): Promise<void> {
  await db
    .update(notifications)
    .set({ status: "failed", failure })
    .where(stillClaimed(notification.id));
}

async function record(deps: NotifierDeps, claim: Claim, delivery: Delivery): Promise<string> {
  const { db } = deps;
  const { notification } = claim;
  const now = deps.now();
  switch (delivery.kind) {
    case "sent":
      await db
        .update(notifications)
        .set({ status: "sent", sentAt: now, telegramMessageId: delivery.messageId })
        .where(stillClaimed(notification.id));
      return "sent";
    case "retry":
      if (notification.attempts >= maxNotificationAttempts) {
        await fail(db, notification, delivery.reason);
        return `failed after ${String(notification.attempts)} attempts`;
      }
      await db
        .update(notifications)
        .set({
          status: "pending",
          claimedAt: null,
          failure: delivery.reason,
          nextAttemptAt: now + (delivery.afterMs ?? notificationBackoffMs(notification.attempts)),
        })
        .where(stillClaimed(notification.id));
      return "deferred";
    case "refused":
      await fail(db, notification, delivery.reason);
      if (delivery.botStopped) {
        await db.update(users).set({ botStartedAt: null }).where(eq(users.id, notification.userId));
      }
      return "refused by Telegram";
    case "unconfirmed":
      await fail(db, notification, `Unconfirmed, so it is not sent again: ${delivery.reason}`);
      return "unconfirmed";
  }
}

async function deliver(deps: NotifierDeps, claim: Claim): Promise<string> {
  if (!claim.botStarted) {
    await fail(deps.db, claim.notification, "The member stopped the bot before it was sent");
    return "skipped, bot stopped";
  }
  const delivery = await deps.sender.send(orderMessage(claim.facts, deps.webOrigin));
  return record(deps, claim, delivery);
}

export async function runNotifier(deps: NotifierDeps): Promise<NotifyReport> {
  const superseded = await supersedeOlder(deps.db);
  const abandoned = await abandonStaleClaims(deps.db, deps.now());
  let delivered = 0;
  while (delivered < maxPerPass) {
    const claim = await claimNextNotification(deps.db, deps.now());
    if (claim === null) {
      break;
    }
    const { id, intentId, state } = claim.notification;
    const outcome = await deliver(deps, claim);
    logLine(`notify ${String(id)} ${intentId} ${state}: ${outcome}`);
    delivered += 1;
  }
  return { superseded, abandoned, delivered };
}
