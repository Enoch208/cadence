import { eq } from "drizzle-orm";
import { outbox } from "@cadence/db";
import { StrikeReadError } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { startWorkerLoop } from "../src/loop";
import { claimNext, leaseMs } from "../src/outbox";
import { intentsToReconcile, runPass } from "../src/pass";
import { submitIntent } from "../src/submit";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { approved } from "./support/flows";
import { intentState, outboxOf } from "./support/read";
import { until } from "./support/wait";

resetDatabaseBetweenTests();

describe("one worker pass", () => {
  it("takes an approval to verified exits: submit, reconcile, then the sweep", async () => {
    const { intent, deps, replay } = await approved();

    await expect(runPass(deps)).resolves.toEqual({
      reclaimed: 0,
      processed: 2,
      reconciled: 1,
      failed: 0,
    });

    expect(await intentState(intent.id)).toBe("open_verified");
    expect(await outboxOf(intent.id)).toEqual([
      { kind: "submit", status: "done" },
      { kind: "reconcile", status: "done" },
    ]);
    expect(replay.submittedStrategies()).toHaveLength(1);
    await runPass(deps);
    expect(replay.submittedStrategies()).toHaveLength(1);
  });

  it("backs off an item that fails and leaves the intent reserved for the next attempt", async () => {
    const outage = { started: false };
    const { intent, deps, clock } = await approved({
      client: (replay) => ({
        ...replay,
        mark: (symbol) =>
          outage.started
            ? Promise.reject(
                new StrikeReadError({ operation: "mark", status: 503, detail: "down" }),
              )
            : replay.mark(symbol),
      }),
    });
    outage.started = true;

    await expect(runPass(deps)).resolves.toMatchObject({ processed: 0, failed: 1 });

    expect(await intentState(intent.id)).toBe("reserved");
    const [item] = await db.select().from(outbox).where(eq(outbox.intentId, intent.id));
    expect(item).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: clock.now() + 1_000,
    });
  });

  it("leaves an intent to whoever holds its outbox lease, until the lease runs out", async () => {
    const { intent, deps, clock } = await approved();
    await submitIntent(deps, intent.id);
    await db.update(outbox).set({ status: "done" }).where(eq(outbox.kind, "submit"));
    const held = await claimNext(db, clock.now());
    expect(held?.kind).toBe("reconcile");

    expect(await intentsToReconcile(db, clock.now())).toEqual([]);
    expect(await intentsToReconcile(db, clock.now() + leaseMs)).toEqual([
      { id: intent.id, state: "submitted" },
    ]);
  });
});

describe("the worker loop", () => {
  it("finishes the pass in flight and stops without waiting out its interval", async () => {
    const { intent, deps } = await approved();
    const loop = startWorkerLoop(deps, { intervalMs: 60_000 });
    await until(async () => (await intentState(intent.id)) === "open_verified");
    const asked = performance.now();

    await loop.stop();

    expect(performance.now() - asked).toBeLessThan(1_000);
    expect(await intentState(intent.id)).toBe("open_verified");
  });
});
