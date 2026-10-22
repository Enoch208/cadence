import { describe, expect, it } from "vitest";
import { IllegalTransitionError, intentCursor, StaleIntentError } from "../src/transition";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { replayPlan, testClock, testNow } from "./support/fixtures";
import { eventTypes, intentState } from "./support/read";
import { approve, insertMember, insertPlan } from "./support/rows";
import { previewOn, replayOf } from "./support/strike";

resetDatabaseBetweenTests();

async function reservedIntent() {
  const { version } = await insertPlan(replayPlan);
  const member = await insertMember({ environment: "replay", scenario: "happy_path" });
  const decision = await previewOn(replayOf(member.connection, testClock()), replayPlan, testNow);
  return approve(member, version.id, decision);
}

const ref = (id: string) => ({ id, environment: "replay" as const });

describe("moving an intent through its lifecycle", () => {
  it("records every legal step as an event carrying where it came from and went", async () => {
    const intent = await reservedIntent();
    await db.transaction(async (tx) => {
      const cursor = intentCursor(tx, { ...ref(intent.id), state: "reserved" }, testNow + 5);
      await cursor.apply("submit_attempted");
      await cursor.apply("submit_timed_out", { error: "StrikeAmbiguousError" });
      expect(cursor.state).toBe("unknown");
      expect(cursor.finished).toBe(false);
    });
    expect(await intentState(intent.id)).toBe("unknown");
    expect(await eventTypes(intent.id)).toEqual([
      "approved",
      "submit_attempted",
      "submit_timed_out",
    ]);
  });

  it("throws on an illegal step and writes nothing", async () => {
    const intent = await reservedIntent();
    await expect(
      db.transaction(async (tx) => {
        await intentCursor(tx, { ...ref(intent.id), state: "reserved" }, testNow).apply(
          "fill_observed",
        );
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await intentState(intent.id)).toBe("reserved");
    expect(await eventTypes(intent.id)).toEqual(["approved"]);
  });

  it("throws when the intent already left the state the worker read", async () => {
    const intent = await reservedIntent();
    await expect(
      db.transaction(async (tx) => {
        await intentCursor(tx, { ...ref(intent.id), state: "submitted" }, testNow).apply(
          "acknowledged",
        );
      }),
    ).rejects.toBeInstanceOf(StaleIntentError);
    expect(await eventTypes(intent.id)).toEqual(["approved"]);
  });
});
