import { eq } from "drizzle-orm";
import { publishedPlanSchema, type Decision } from "@cadence/core";
import { accountConnections } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { submitIntent } from "../src/submit";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { replayPlan } from "./support/fixtures";
import { approved } from "./support/flows";
import { intentState, lastEventData, reservationStatus } from "./support/read";

resetDatabaseBetweenTests();

const curatorFee = { builderCode: "range_traders", feeBps: 5 };
const feePlan = publishedPlanSchema.parse({ ...replayPlan, targetPrice: "88000", curatorFee });
const underCuratorCode = {
  environment: "replay",
  scenario: "happy_path",
  builder: { builderCode: "range_traders", builderFeeBps: 5 },
} as const;

const withoutFeeTerms = (decision: Decision): Decision =>
  decision.outcome === "BLOCKED"
    ? decision
    : { ...decision, proposal: { ...decision.proposal, curatorFee: null } };

describe("the curator fee at the final check", () => {
  it("sends an approval whose curator fee still applies on the same terms", async () => {
    const { intent, deps, replay } = await approved({ spec: underCuratorCode, plan: feePlan });
    expect(intent.approved.curatorFee).toEqual(curatorFee);
    await expect(submitIntent(deps, intent.id)).resolves.toBe("acknowledged");
    expect(replay.submittedStrategies().map((order) => order.builderFeeBps)).toEqual([5]);
    expect(replay.builderFeesPaid()).not.toBe("0");
  });

  it("sends the same plan without the fee header from an account under another code", async () => {
    const { intent, deps, replay } = await approved({
      spec: { environment: "replay", scenario: "happy_path" },
      plan: feePlan,
    });
    expect(intent.approved.curatorFee).toBeNull();
    await expect(submitIntent(deps, intent.id)).resolves.toBe("acknowledged");
    expect(replay.submittedStrategies().map((order) => order.builderFeeBps)).toEqual([null]);
    expect(replay.builderFeesPaid()).toBe("0");
  });

  it("refuses to send when the member approved no fee but the account now pays one", async () => {
    const { intent, deps, replay } = await approved({
      spec: underCuratorCode,
      plan: feePlan,
      approved: withoutFeeTerms,
    });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await intentState(intent.id)).toBe("blocked");
    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      refusal: "curator_fee_changed",
      approvedCuratorFeeCode: null,
      curatorFeeCode: "range_traders",
      curatorFeeBps: 5,
    });
    expect(replay.submittedStrategies()).toEqual([]);
    expect(await reservationStatus(intent.id)).toBe("released");
  });

  it("refuses to send when the account's builder approval changed after approval", async () => {
    const { intent, deps, replay, member } = await approved({
      spec: underCuratorCode,
      plan: feePlan,
    });
    await db
      .update(accountConnections)
      .set({ builderCode: "someone_else" })
      .where(eq(accountConnections.id, member.connection.id));

    await expect(submitIntent(deps, intent.id)).resolves.toBe("refused");

    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      refusal: "curator_fee_changed",
      approvedCuratorFeeCode: "range_traders",
      approvedCuratorFeeBps: 5,
      curatorFeeCode: null,
    });
    expect(replay.submittedStrategies()).toEqual([]);
  });
});
