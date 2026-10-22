import {
  planVersionDigest,
  publishedPlanSchema,
  riskPolicySchema,
  type Decision,
  type Proposal,
  type PublishedPlan,
  type Receipt,
  type RiskPolicy,
} from "@cadence/core";

export const testNow = Date.parse("2026-10-22T12:00:00Z");

export const longPlan: PublishedPlan = publishedPlanSchema.parse({
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
  environment: "live",
});

export const correctedPlan: PublishedPlan = publishedPlanSchema.parse({
  ...longPlan,
  stopPrice: "83300",
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
  minRewardRisk: "1.2",
  liquidationBufferBps: 100,
  allowedMarkets: ["BTC-USD"],
});

export const readyProposal: Proposal = {
  quantity: "0.01208",
  limitPrice: "84268",
  notional: "1017.96",
  priceLoss: "12.90",
  costs: {
    entryFee: "0.51",
    exitFee: "0.50",
    stopSlippageReserve: "5.03",
    fundingReserve: "1.05",
  },
  plannedLoss: "19.99",
  rewardRiskNet: "1.48",
  leverage: 5,
  initialMargin: "203.59",
  estimatedLiquidationPrice: "67684",
  admissibleBudget: "20.00",
  limitedBy: "budget",
};

export const readyDecision: Decision = {
  outcome: "READY",
  reasons: [],
  proposal: readyProposal,
  evidence: {
    bestBid: "84099",
    bestAsk: "84100",
    markPrice: "84100",
    accountObservedAt: testNow - 400,
    bookObservedAt: testNow - 300,
    markObservedAt: testNow - 500,
    evaluatedAt: testNow,
  },
};

export const receiptBody = (intentId: string, realizedPnl: string | null): Receipt => ({
  intentId,
  planPublicId: "k7m2q9x4w8ab",
  planVersion: 1,
  planDigest: planVersionDigest(longPlan),
  policyVersion: 1,
  approved: readyProposal,
  state: "closed",
  entry: { size: "0.01208", averagePrice: "84212" },
  exit: { size: "0.01208", averagePrice: "83200" },
  feesPaid: "1.01",
  realizedPnl,
  exchangeOrderIds: ["1000001", "1000004"],
  incomplete: realizedPnl === null ? ["exit fills"] : [],
  reconciledAt: testNow,
});
