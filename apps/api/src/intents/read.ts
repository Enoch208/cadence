import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  accountConnections,
  events,
  exchangeOrders,
  executionIntents,
  outbox,
  planVersions,
  plans,
  receipts,
  type Executor,
} from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict, notFound } from "../http/errors";

const missingIntent = () => notFound("That intent does not exist.");

async function ownedIntent(db: Executor, userId: string, intentId: string, lock = false) {
  const query = db
    .select()
    .from(executionIntents)
    .where(and(eq(executionIntents.id, intentId), eq(executionIntents.userId, userId)));
  const [intent] = await (lock ? query.for("update") : query);
  if (intent === undefined) {
    throw missingIntent();
  }
  return intent;
}

export async function intentView(db: Executor, userId: string, intentId: string) {
  const [row] = await db
    .select({
      intent: executionIntents,
      environment: accountConnections.environment,
      planPublicId: plans.publicId,
      planVersion: planVersions.version,
    })
    .from(executionIntents)
    .innerJoin(accountConnections, eq(accountConnections.id, executionIntents.accountConnectionId))
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .innerJoin(plans, eq(plans.id, planVersions.planId))
    .where(and(eq(executionIntents.id, intentId), eq(executionIntents.userId, userId)));
  if (row === undefined) {
    throw missingIntent();
  }
  const orders = await db
    .select({
      role: exchangeOrders.role,
      clientOrderId: exchangeOrders.clientOrderId,
      exchangeOrderId: exchangeOrders.exchangeOrderId,
      lastStatus: exchangeOrders.lastStatus,
      filledSize: exchangeOrders.filledSize,
    })
    .from(exchangeOrders)
    .where(eq(exchangeOrders.intentId, intentId))
    .orderBy(asc(exchangeOrders.role));
  const history = await db
    .select({ at: events.at, type: events.type })
    .from(events)
    .where(eq(events.correlationId, intentId))
    .orderBy(asc(events.id));
  const { intent } = row;
  return {
    id: intent.id,
    state: intent.state,
    environment: row.environment,
    planPublicId: row.planPublicId,
    planVersion: row.planVersion,
    market: intent.market,
    approved: intent.approved,
    orders,
    events: history,
  };
}

const cancellableStates = ["reserved", "submitted", "unknown"] as const;

export function requestEntryCancel(deps: AppDeps, userId: string, intentId: string) {
  return deps.db.transaction(async (tx) => {
    const intent = await ownedIntent(tx, userId, intentId, true);
    if (!(cancellableStates as readonly string[]).includes(intent.state)) {
      throw conflict("NOTHING_TO_CANCEL", "There is no unfilled entry left to cancel.");
    }
    const queued = await tx
      .insert(outbox)
      .values({
        kind: "cancel_entry",
        intentId,
        accountConnectionId: intent.accountConnectionId,
        nextAttemptAt: deps.now(),
      })
      .onConflictDoNothing()
      .returning({ id: outbox.id });
    if (queued.length > 0) {
      await recordEvent(tx, {
        at: deps.now(),
        actor: userActor(userId),
        correlationId: intentId,
        environment: null,
        type: "entry_cancel_requested",
        data: {},
      });
    }
    return { id: intentId };
  });
}

export async function receiptView(db: Executor, userId: string, intentId: string) {
  await ownedIntent(db, userId, intentId);
  const [receipt] = await db.select().from(receipts).where(eq(receipts.intentId, intentId));
  if (receipt === undefined) {
    throw notFound("The receipt is built once the trade is reconciled.", "RECEIPT_NOT_READY");
  }
  return { receipt: receipt.body, builtAt: receipt.builtAt };
}

export function intentEventsAfter(db: Executor, userId: string, afterId: number) {
  const ownIntents = db
    .select({ id: executionIntents.id })
    .from(executionIntents)
    .where(eq(executionIntents.userId, userId));
  return db
    .select({
      id: events.id,
      correlationId: events.correlationId,
      at: events.at,
      type: events.type,
    })
    .from(events)
    .where(and(gt(events.id, afterId), inArray(events.correlationId, ownIntents)))
    .orderBy(asc(events.id))
    .limit(100);
}
