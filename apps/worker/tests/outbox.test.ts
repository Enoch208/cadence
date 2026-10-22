import { eq } from "drizzle-orm";
import { outbox } from "@cadence/db";
import { describe, expect, it } from "vitest";
import {
  backoffMs,
  claimNext,
  completeItem,
  deferItem,
  enqueue,
  leaseMs,
  reclaimExpiredClaims,
} from "../src/outbox";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { replayPlan, testClock, testNow } from "./support/fixtures";
import { approve, insertMember, insertPlan } from "./support/rows";
import { previewOn, replayOf } from "./support/strike";

resetDatabaseBetweenTests();

async function approvedIntent() {
  const clock = testClock();
  const { version } = await insertPlan(replayPlan);
  const member = await insertMember({ environment: "replay", scenario: "happy_path" });
  const decision = await previewOn(replayOf(member.connection, clock), replayPlan, testNow);
  const intent = await approve(member, version.id, decision);
  return { intent, member };
}

async function outboxRow(id: number) {
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
  return row;
}

describe("the outbox", () => {
  it("claims a due item once, counts the attempt and leaves items that are not yet due", async () => {
    const { intent } = await approvedIntent();
    expect(await claimNext(db, testNow - 1)).toBeNull();

    const item = await claimNext(db, testNow);
    expect(item).toMatchObject({ kind: "submit", intentId: intent.id, attempts: 1 });
    expect(await claimNext(db, testNow)).toBeNull();
    expect(await outboxRow(item?.id ?? 0)).toMatchObject({
      status: "claimed",
      claimedAt: testNow,
    });
  });

  it("never hands one item to two claimers racing for it", async () => {
    await approvedIntent();
    const claims = await Promise.all([claimNext(db, testNow), claimNext(db, testNow)]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("lets racing claimers take different accounts' work at the same time", async () => {
    const first = await approvedIntent();
    const second = await approvedIntent();
    const claims = await Promise.all([claimNext(db, testNow), claimNext(db, testNow)]);
    expect(claims.map((claim) => claim?.intentId).sort()).toEqual(
      [first.intent.id, second.intent.id].sort(),
    );
  });

  it("keeps one item in flight per account, so an account's work never overlaps", async () => {
    const { intent, member } = await approvedIntent();
    await enqueue(db, {
      kind: "reconcile",
      intentId: intent.id,
      accountConnectionId: member.connection.id,
      at: testNow,
    });
    const inFlight = await claimNext(db, testNow);
    expect(inFlight?.kind).toBe("submit");
    expect(await claimNext(db, testNow)).toBeNull();

    if (inFlight === null) {
      throw new Error("Expected an item in flight");
    }
    await completeItem(db, inFlight);
    expect(await claimNext(db, testNow)).toMatchObject({ kind: "reconcile" });
  });

  it("reclaims an item whose lease ran out, and only then", async () => {
    await approvedIntent();
    const item = await claimNext(db, testNow);
    expect(await reclaimExpiredClaims(db, testNow + leaseMs - 1)).toBe(0);
    expect(await reclaimExpiredClaims(db, testNow + leaseMs)).toBe(1);
    expect(await claimNext(db, testNow + leaseMs)).toMatchObject({ id: item?.id, attempts: 2 });
  });

  it("backs a failed item off for longer each attempt, up to a ceiling", async () => {
    await approvedIntent();
    const item = await claimNext(db, testNow);
    if (item === null) {
      throw new Error("Expected an item");
    }
    await deferItem(db, item, testNow);
    expect(await outboxRow(item.id)).toMatchObject({
      status: "pending",
      claimedAt: null,
      nextAttemptAt: testNow + 1_000,
    });
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("keeps a single open item per intent and kind", async () => {
    const { intent, member } = await approvedIntent();
    const request = {
      kind: "reconcile" as const,
      intentId: intent.id,
      accountConnectionId: member.connection.id,
      at: testNow,
    };
    await enqueue(db, request);
    await enqueue(db, request);
    const rows = await db.select().from(outbox).where(eq(outbox.intentId, intent.id));
    expect(rows.map((row) => row.kind).sort()).toEqual(["reconcile", "submit"]);
  });
});
