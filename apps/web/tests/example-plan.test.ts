import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { publishedPlanSchema } from "@cadence/core";
import {
  exampleLateAsk,
  examplePlan,
  examplePreview,
  exampleRewardRisk,
} from "../src/components/landing/example-plan";

const lotStep = "0.00001";
const riskPerUnit = new Decimal(examplePlan.entryMax).minus(examplePlan.stopPrice);

describe("the landing page example", () => {
  it("is a plan the published-plan schema accepts", () => {
    expect(publishedPlanSchema.safeParse(examplePlan).success).toBe(true);
  });

  it("is labelled replay, never live", () => {
    expect(examplePlan.environment).toBe("replay");
  });

  it("shows the reward to risk the engine computes", () => {
    expect(exampleRewardRisk).toEqual({ atEntry: "2.00", atLateAsk: "0.85" });
  });

  it("sizes the preview down to the lot step from the budget", () => {
    const size = new Decimal(examplePreview.budget)
      .dividedBy(riskPerUnit)
      .toNearest(lotStep, Decimal.ROUND_DOWN);
    expect(size.toFixed(5)).toBe(examplePreview.size);
  });

  it("states the notional and planned risk of that size", () => {
    const size = new Decimal(examplePreview.size);
    expect(size.times(examplePlan.entryMax).toFixed(2, Decimal.ROUND_DOWN)).toBe(
      examplePreview.notional,
    );
    expect(size.times(riskPerUnit).toFixed(2, Decimal.ROUND_DOWN)).toBe(examplePreview.plannedRisk);
  });

  it("fills inside the entry range and declines an ask above it", () => {
    expect(new Decimal(examplePreview.fillPrice).greaterThanOrEqualTo(examplePlan.entryMin)).toBe(
      true,
    );
    expect(new Decimal(examplePreview.fillPrice).lessThanOrEqualTo(examplePlan.entryMax)).toBe(
      true,
    );
    expect(new Decimal(exampleLateAsk).greaterThan(examplePlan.entryMax)).toBe(true);
  });
});
