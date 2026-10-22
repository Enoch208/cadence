import { asc, eq } from "drizzle-orm";
import { publishedPlanSchema, type IntentEvent } from "@cadence/core";
import { notifications, users } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { startWorkerLoop } from "../src/loop";
import {
  maxNotificationAttempts,
  notificationBackoffMs,
  notificationLeaseMs,
  runNotifier,
  type NotifierDeps,
} from "../src/notify";
import type { OutgoingMessage } from "../src/notify-message";
import type { Delivery, MessageSender } from "../src/notify-telegram";
import { runPass } from "../src/pass";
import { submitIntent } from "../src/submit";
import { intentCursor } from "../src/transition";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { livePlan, replayPlan, testClock, testNow, type TestClock } from "./support/fixtures";
import { approved } from "./support/flows";
import { intentState } from "./support/read";
import { until } from "./support/wait";

resetDatabaseBetweenTests();

const webOrigin = "https://cadence.test";

class RecordingSender implements MessageSender {
  readonly sent: OutgoingMessage[] = [];
  private readonly answers: Delivery[] = [];

  answerNext(...answers: Delivery[]): void {
    this.answers.push(...answers);
  }

  send(message: OutgoingMessage): Promise<Delivery> {
    this.sent.push(message);
    return Promise.resolve(this.answers.shift() ?? { kind: "sent", messageId: this.sent.length });
  }
}

const notifierOf = (clock: TestClock, sender: MessageSender = new RecordingSender()) =>
  ({ db, now: clock.now, sender, webOrigin }) satisfies NotifierDeps;

const startBot = (userId: string) =>
  db.update(users).set({ botStartedAt: testNow }).where(eq(users.id, userId));

const notificationsOf = (intentId: string) =>
  db
    .select({
      state: notifications.state,
      status: notifications.status,
      attempts: notifications.attempts,
      failure: notifications.failure,
      nextAttemptAt: notifications.nextAttemptAt,
      telegramMessageId: notifications.telegramMessageId,
    })
    .from(notifications)
    .where(eq(notifications.intentId, intentId))
    .orderBy(asc(notifications.id));

const statesOf = async (intentId: string) =>
  (await notificationsOf(intentId)).map(({ state, status }) => `${state}:${status}`);

async function startedMember(setup: Parameters<typeof approved>[0] = {}) {
  const flow = await approved(setup);
  await startBot(flow.member.user.id);
  return flow;
}

async function walk(flow: Awaited<ReturnType<typeof approved>>, events: IntentEvent[]) {
  await db.transaction(async (tx) => {
    const cursor = intentCursor(
      tx,
      { id: flow.intent.id, state: "reserved", environment: flow.member.connection.environment },
      flow.clock.now(),
    );
    for (const event of events) {
      await cursor.apply(event);
    }
  });
}

async function oneExpiredMessage() {
  const flow = await startedMember();
  await walk(flow, ["entry_window_closed"]);
  return flow;
}

describe("queueing order messages", () => {
  it("queues each announced state with its state change, for a member who started the bot", async () => {
    const { intent, deps } = await startedMember();

    await runPass(deps);
    await runPass(deps);

    expect(await intentState(intent.id)).toBe("open_verified");
    expect(await statesOf(intent.id)).toEqual([
      "submitted:pending",
      "open_verifying:pending",
      "open_verified:pending",
    ]);
  });

  it("queues nothing for a member who never started the bot", async () => {
    const { intent, deps } = await approved();
    await runPass(deps);
    expect(await intentState(intent.id)).toBe("open_verified");
    expect(await notificationsOf(intent.id)).toEqual([]);
  });

  it("rolls the message back with a state change that does not commit", async () => {
    const flow = await startedMember();
    const crashing = db.transaction(async (tx) => {
      const ref = {
        id: flow.intent.id,
        state: "reserved" as const,
        environment: "replay" as const,
      };
      await intentCursor(tx, ref, flow.clock.now()).apply("entry_window_closed");
      throw new Error("the worker died before committing");
    });
    await expect(crashing).rejects.toThrow("the worker died before committing");
    expect(await intentState(flow.intent.id)).toBe("reserved");
    expect(await notificationsOf(flow.intent.id)).toEqual([]);
  });

  it("announces Strike's acknowledgement once, even when it arrives again after a timeout", async () => {
    const flow = await startedMember();
    await walk(flow, ["submit_attempted", "acknowledged", "submit_timed_out", "acknowledged"]);
    expect(await intentState(flow.intent.id)).toBe("submitted");
    expect(await statesOf(flow.intent.id)).toEqual(["submitted:pending"]);
  });
});

describe("the notifier", () => {
  it("sends only an order's latest state and supersedes the messages it overtook", async () => {
    const { intent, deps, member, clock } = await startedMember();
    await runPass(deps);
    const sender = new RecordingSender();

    await expect(runNotifier(notifierOf(clock, sender))).resolves.toEqual({
      superseded: 2,
      abandoned: 0,
      delivered: 1,
    });

    expect(sender.sent).toEqual([
      {
        chatId: member.user.telegramUserId,
        text: [
          "Exits verified",
          "BTC-USD long · Replay",
          "Your stop and target are confirmed on the replay exchange for the filled size.",
        ].join("\n"),
        button: { label: "Open order", url: `${webOrigin}/intents/${intent.id}` },
      },
    ]);
    expect(await notificationsOf(intent.id)).toMatchObject([
      { state: "submitted", status: "superseded" },
      { state: "open_verifying", status: "superseded" },
      { state: "open_verified", status: "sent", attempts: 1, telegramMessageId: 1 },
    ]);
    await runNotifier(notifierOf(clock, sender));
    expect(sender.sent).toHaveLength(1);
  });

  it("links to the receipt once there is one and names Strike only for live orders", async () => {
    const declined = await startedMember({ spec: { environment: "live" }, plan: livePlan });
    await expect(submitIntent(declined.deps, declined.intent.id)).resolves.toBe("refused");
    expect(await intentState(declined.intent.id)).toBe("blocked");
    expect(await notificationsOf(declined.intent.id)).toEqual([]);
    const closing = publishedPlanSchema.parse({
      ...replayPlan,
      entryExpiresAt: new Date(testClock().now() + 1_000).toISOString(),
    });
    const late = await startedMember({ plan: closing });
    late.clock.advance(2_000);
    await expect(submitIntent(late.deps, late.intent.id)).resolves.toBe("refused");
    const sender = new RecordingSender();

    await runNotifier(notifierOf(late.clock, sender));

    expect(await intentState(late.intent.id)).toBe("expired");
    expect(sender.sent).toEqual([
      {
        chatId: late.member.user.telegramUserId,
        text: [
          "Entry window closed",
          "BTC-USD long · Replay",
          "The entry window closed before the order was sent.",
        ].join("\n"),
        button: { label: "Open receipt", url: `${webOrigin}/receipts/${late.intent.id}` },
      },
    ]);

    const roomy = await startedMember({
      spec: { environment: "live" },
      plan: livePlan,
      liveMaxNotional: "2000",
    });
    await runPass(roomy.deps);
    await runNotifier(notifierOf(roomy.clock, sender));
    expect(sender.sent.at(-1)?.text.split("\n")).toEqual([
      "Exits verified",
      "BTC-USD long · Live",
      "Your stop and target are confirmed on Strike for the filled size.",
    ]);
  });

  it("waits as Telegram asks, backs off on its failures, and stops at the attempt limit", async () => {
    const { intent, clock } = await oneExpiredMessage();
    const sender = new RecordingSender();
    const notifier = notifierOf(clock, sender);
    sender.answerNext({ kind: "retry", afterMs: 7_000, reason: "Telegram 429: Too Many Requests" });

    await runNotifier(notifier);
    expect(await notificationsOf(intent.id)).toMatchObject([
      {
        status: "pending",
        attempts: 1,
        failure: "Telegram 429: Too Many Requests",
        nextAttemptAt: clock.now() + 7_000,
      },
    ]);
    await runNotifier(notifier);
    expect(sender.sent).toHaveLength(1);

    for (let attempt = 2; attempt <= maxNotificationAttempts; attempt += 1) {
      clock.advance(60_000);
      sender.answerNext({ kind: "retry", afterMs: null, reason: "Telegram 502: Bad Gateway" });
      await runNotifier(notifier);
    }

    expect(sender.sent).toHaveLength(maxNotificationAttempts);
    expect(notificationBackoffMs(2)).toBe(4_000);
    expect(await notificationsOf(intent.id)).toMatchObject([
      { status: "failed", attempts: maxNotificationAttempts, failure: "Telegram 502: Bad Gateway" },
    ]);
    clock.advance(600_000);
    await runNotifier(notifier);
    expect(sender.sent).toHaveLength(maxNotificationAttempts);
  });

  it("stops messaging a member who blocked the bot", async () => {
    const flow = await oneExpiredMessage();
    const sender = new RecordingSender();
    sender.answerNext({
      kind: "refused",
      reason: "Telegram 403: Forbidden: bot was blocked by the user",
      botStopped: true,
    });

    await runNotifier(notifierOf(flow.clock, sender));

    expect(await notificationsOf(flow.intent.id)).toMatchObject([
      { status: "failed", failure: "Telegram 403: Forbidden: bot was blocked by the user" },
    ]);
    const [user] = await db.select().from(users).where(eq(users.id, flow.member.user.id));
    expect(user?.botStartedAt).toBeNull();
  });

  it("skips a message queued before the member stopped the bot", async () => {
    const flow = await oneExpiredMessage();
    await db.update(users).set({ botStartedAt: null }).where(eq(users.id, flow.member.user.id));
    const sender = new RecordingSender();

    await runNotifier(notifierOf(flow.clock, sender));

    expect(sender.sent).toEqual([]);
    expect(await notificationsOf(flow.intent.id)).toMatchObject([
      { status: "failed", failure: "The member stopped the bot before it was sent" },
    ]);
  });

  it("never sends again a message whose delivery Telegram did not confirm", async () => {
    const flow = await oneExpiredMessage();
    const sender = new RecordingSender();
    sender.answerNext({ kind: "unconfirmed", reason: "Network request for 'sendMessage' failed!" });

    await runNotifier(notifierOf(flow.clock, sender));
    flow.clock.advance(600_000);
    await runNotifier(notifierOf(flow.clock, sender));

    expect(sender.sent).toHaveLength(1);
    expect(await notificationsOf(flow.intent.id)).toMatchObject([
      {
        status: "failed",
        failure: "Unconfirmed, so it is not sent again: Network request for 'sendMessage' failed!",
      },
    ]);
  });

  it("leaves a message the worker died while sending failed, never sent twice", async () => {
    const flow = await oneExpiredMessage();
    let calls = 0;
    const dying: MessageSender = {
      send: () => {
        calls += 1;
        return Promise.reject(new Error("the process was killed mid-send"));
      },
    };

    await expect(runNotifier(notifierOf(flow.clock, dying))).rejects.toThrow("killed mid-send");
    expect(await statesOf(flow.intent.id)).toEqual(["expired:claimed"]);
    await runNotifier(notifierOf(flow.clock, dying));
    flow.clock.advance(notificationLeaseMs);

    await expect(runNotifier(notifierOf(flow.clock, dying))).resolves.toEqual({
      superseded: 0,
      abandoned: 1,
      delivered: 0,
    });
    expect(calls).toBe(1);
    expect(await notificationsOf(flow.intent.id)).toMatchObject([
      {
        status: "failed",
        failure: "Unconfirmed: the worker stopped while sending, so it is not sent again",
      },
    ]);
  });

  it("lets two notifiers race without sending one message twice", async () => {
    const flow = await oneExpiredMessage();
    const sent: OutgoingMessage[] = [];
    const slow: MessageSender = {
      send: async (message) => {
        sent.push(message);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { kind: "sent", messageId: 9 };
      },
    };

    await Promise.all([
      runNotifier(notifierOf(flow.clock, slow)),
      runNotifier(notifierOf(flow.clock, slow)),
    ]);

    expect(sent).toHaveLength(1);
    expect(await statesOf(flow.intent.id)).toEqual(["expired:sent"]);
  });
});

const violation = (code: string, constraint: string) => ({
  cause: { code, constraint_name: constraint },
});

describe("notification rows", () => {
  it("refuse a second message for one state and a sent message with no Telegram ID", async () => {
    const flow = await oneExpiredMessage();
    const row = {
      intentId: flow.intent.id,
      userId: flow.member.user.id,
      nextAttemptAt: testNow,
      createdAt: testNow,
    };
    await expect(
      db.insert(notifications).values({ ...row, state: "expired" }),
    ).rejects.toMatchObject(violation("23505", "notifications_intent_state_unique"));
    await expect(
      db.insert(notifications).values({ ...row, state: "closed", status: "sent", sentAt: testNow }),
    ).rejects.toMatchObject(violation("23514", "notifications_sent_when_sent"));
    await expect(
      db.insert(notifications).values({ ...row, state: "closed", status: "failed" }),
    ).rejects.toMatchObject(violation("23514", "notifications_failed_has_failure"));
    expect(await statesOf(flow.intent.id)).toEqual(["expired:pending"]);
  });
});

describe("the worker loop with order messages", () => {
  it("delivers messages beside the order passes", async () => {
    const { intent, deps, clock } = await startedMember();
    const sender = new RecordingSender();
    const loop = startWorkerLoop(deps, { intervalMs: 10, notifier: notifierOf(clock, sender) });
    await until(async () => (await statesOf(intent.id)).includes("open_verified:sent"));
    await loop.stop();
    expect(sender.sent.map((message) => message.text.split("\n")[0])).toContain("Exits verified");
  });

  it("leaves messages pending and harmless when Telegram is not configured", async () => {
    const { intent, deps } = await startedMember();
    const loop = startWorkerLoop(deps, { intervalMs: 10 });
    await until(async () => (await intentState(intent.id)) === "open_verified");
    await loop.stop();
    expect(await statesOf(intent.id)).toEqual([
      "submitted:pending",
      "open_verifying:pending",
      "open_verified:pending",
    ]);
  });
});
