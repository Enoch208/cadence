import {
  publishedPlanSchema,
  riskPolicySchema,
  type PublishedPlan,
  type RiskPolicy,
} from "@cadence/core";

export const testNow = Date.parse("2026-10-22T12:00:00Z");

export function testClock(start = testNow) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export type TestClock = ReturnType<typeof testClock>;

export const replayPlan: PublishedPlan = publishedPlanSchema.parse({
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "Reclaim of the weekly open with a stop under the range low.",
  environment: "replay",
});

export const livePlan: PublishedPlan = publishedPlanSchema.parse({
  ...replayPlan,
  environment: "live",
});

export const testPolicy: RiskPolicy = riskPolicySchema.parse({
  version: 1,
  perTradeBudget: "20",
  aggregateBudget: "60",
  sessionBudget: "40",
  leverageCap: 5,
  maxEntrySlippageBps: 20,
  stopSlippageReserveBps: 50,
  fundingHorizonHours: 24,
  minRewardRisk: "1.5",
  liquidationBufferBps: 100,
  allowedMarkets: ["BTC-USD"],
});
