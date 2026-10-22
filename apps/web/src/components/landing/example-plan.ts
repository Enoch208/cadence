import { rewardToRiskBeforeCosts } from "@cadence/core/reward-risk";

export const examplePlan = {
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "Illustration for the landing page.",
  environment: "replay",
} as const;

export const exampleLateAsk = "85150";

export const examplePreview = {
  budget: "20",
  size: "0.01666",
  notional: "1406.10",
  plannedRisk: "19.99",
  fillPrice: "84212",
} as const;

export const exampleRewardRisk = {
  atEntry: rewardToRiskBeforeCosts({ ...examplePlan, entry: examplePlan.entryMax }, 2),
  atLateAsk: rewardToRiskBeforeCosts({ ...examplePlan, entry: exampleLateAsk }, 2),
};

const price = new Intl.NumberFormat("en-US");

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPrice = (value: string) => price.format(value as Intl.StringNumericLiteral);

export const formatUsd = (value: string) => `$${usd.format(value as Intl.StringNumericLiteral)}`;
