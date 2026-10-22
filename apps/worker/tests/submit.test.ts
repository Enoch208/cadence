import { eq } from "drizzle-orm";
import {
  canonicalJson,
  clientOrderIdFor,
  publishedPlanSchema,
  sha256Hex,
  strategyIdFor,
} from "@cadence/core";
import { accountConnections, plans } from "@cadence/db";
import { strategyRequestBody } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { submitIntent } from "../src/submit";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { livePlan, replayPlan, testClock } from "./support/fixtures";
import {
  eventTypes,
  intentState,
  lastEventData,
  orderRowsOf,
  outboxOf,
  receiptOf,
  reservationStatus,
} from "./support/read";
import { approved } from "./support/flows";
import { insertPlanVersion } from "./support/rows";
import { rejectingStrategies } from "./support/strike";

resetDatabaseBetweenTests();

describe("submitting an approved intent", () => {
  it("persists the exact order and the submitted state before sending it, then sends it once", async () => {
    const seenAtSend: { state: string | null; roles: string[] }[] = [];
    const { intent, deps, replay } = await approved({
      client: (inner) => ({
        ...inner,
        placeStrategy: async (order) => {
          const rows = await orderRowsOf(intent.id);
          seenAtSend.push({ state: await intentState(intent.id), roles: rows.map((r) => r.role) });
          return inner.placeStrategy(order);
        },
      }),
    });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("acknowledged");
    expect(seenAtSend).toEqual([{ state: "submitted", roles: ["entry", "stop", "target"] }]);

    const [sent] = replay.submittedStrategies();
    expect(replay.submittedStrategies()).toHaveLength(1);
    expect(sent).toMatchObject({
      strategyId: strategyIdFor(intent.id),
      entryClientOrderId: clientOrderIdFor(intent.id, "entry"),
      size: intent.approved.quantity,
      limitPrice: intent.approved.limitPrice,
    });
    const rows = await orderRowsOf(intent.id);
    const digest = sha256Hex(canonicalJson(sent === undefined ? null : strategyRequestBody(sent)));
    expect(rows.map((row) => [row.role, row.clientOrderId, row.payloadDigest])).toEqual([
      ["entry", clientOrderIdFor(intent.id, "entry"), digest],
      ["stop", clientOrderIdFor(intent.id, "stop"), digest],
      ["target", clientOrderIdFor(intent.id, "target"), digest],
    ]);
    expect(await intentState(intent.id)).toBe("submitted");
    expect(await eventTypes(intent.id)).toEqual(["approved", "submit_attempted", "acknowledged"]);
    expect(await reservationStatus(intent.id)).toBe("active");
    expect(await outboxOf(intent.id)).toContainEqual({ kind: "reconcile", status: "pending" });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("not_reserved");
    expect(replay.submittedStrategies()).toHaveLength(1);
  });

  it("blocks with PLAN_SUPERSEDED and sends nothing when the plan was corrected after approval", async () => {
    const { intent, deps, replay, planRow } = await approved();
    const corrected = publishedPlanSchema.parse({ ...replayPlan, stopPrice: "83300" });
    await insertPlanVersion(planRow.id, 2, corrected);
    await db.update(plans).set({ currentVersion: 2 }).where(eq(plans.id, planRow.id));

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await intentState(intent.id)).toBe("blocked");
    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      reasons: ["PLAN_SUPERSEDED"],
    });
    expect(replay.submittedStrategies()).toEqual([]);
    expect(await orderRowsOf(intent.id)).toEqual([]);
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await receiptOf(intent.id)).toMatchObject({ state: "blocked", entry: null });
  });

  it("refuses a live order whose notional is above the live ceiling, and sends it under a higher one", async () => {
    const capped = await approved({ spec: { environment: "live" }, plan: livePlan });
    await expect(submitIntent(capped.deps, capped.intent.id)).resolves.toBe("refused");
    expect(await lastEventData(capped.intent.id, "validation_failed")).toMatchObject({
      refusal: "notional_above_live_ceiling",
    });
    expect(capped.replay.submittedStrategies()).toEqual([]);
    expect(await reservationStatus(capped.intent.id)).toBe("released");

    const roomy = await approved({
      spec: { environment: "live" },
      plan: livePlan,
      liveMaxNotional: "2000",
    });
    await expect(submitIntent(roomy.deps, roomy.intent.id)).resolves.toBe("acknowledged");
    expect(roomy.replay.submittedStrategies()).toHaveLength(1);
  });

  it("marks a rejected order rejected and releases its reservation", async () => {
    const { intent, deps } = await approved({ client: rejectingStrategies });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("rejected");

    expect(await intentState(intent.id)).toBe("rejected");
    expect(await lastEventData(intent.id, "exchange_rejected")).toMatchObject({
      status: 400,
      code: "insufficient_margin",
    });
    expect(await orderRowsOf(intent.id)).toHaveLength(3);
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await receiptOf(intent.id)).toMatchObject({ state: "rejected", entry: null });
  });

  it("keeps the reservation and queues a reconcile when the response is lost", async () => {
    const { intent, deps, replay } = await approved({
      spec: { environment: "replay", scenario: "ambiguous_response" },
    });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("unknown");

    expect(await intentState(intent.id)).toBe("unknown");
    expect(await reservationStatus(intent.id)).toBe("active");
    expect(await outboxOf(intent.id)).toContainEqual({ kind: "reconcile", status: "pending" });
    expect(replay.submittedStrategies()).toHaveLength(1);
    await expect(submitIntent(deps, intent.id)).resolves.toBe("not_reserved");
    expect(replay.submittedStrategies()).toHaveLength(1);
  });

  it("refuses a limit price worse than the one the member approved", async () => {
    const { intent, deps, replay } = await approved({
      approved: (decision) =>
        decision.outcome === "BLOCKED"
          ? decision
          : { ...decision, proposal: { ...decision.proposal, limitPrice: "84100" } },
    });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      refusal: "limit_price_worse_than_approved",
      approvedLimitPrice: "84100",
    });
    expect(replay.submittedStrategies()).toEqual([]);
  });

  it("submits nothing for a paused connection", async () => {
    const { intent, deps, replay, member } = await approved();
    await db
      .update(accountConnections)
      .set({ status: "paused" })
      .where(eq(accountConnections.id, member.connection.id));

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      refusal: "connection_not_active",
    });
    expect(replay.submittedStrategies()).toEqual([]);
  });

  it("refuses an approval older than the preview window instead of trading on it late", async () => {
    const { intent, deps, replay, clock } = await approved();
    clock.advance(15_001);

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      refusal: "approval_stale",
    });
    expect(replay.submittedStrategies()).toEqual([]);
  });

  it("expires the intent when the entry window closed before submission", async () => {
    const closing = publishedPlanSchema.parse({
      ...replayPlan,
      entryExpiresAt: new Date(testClock().now() + 1_000).toISOString(),
    });
    const { intent, deps, replay, clock } = await approved({ plan: closing });
    clock.advance(2_000);

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await intentState(intent.id)).toBe("expired");
    expect(await lastEventData(intent.id, "entry_window_closed")).toMatchObject({
      reasons: ["PLAN_EXPIRED"],
    });
    expect(replay.submittedStrategies()).toEqual([]);
    expect(await reservationStatus(intent.id)).toBe("released");
  });
});
