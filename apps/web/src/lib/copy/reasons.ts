import type { DecisionEvidence, Direction, PublishedPlan, ReasonCode } from "@cadence/core";
import { Decimal } from "decimal.js";

const fixedCopy: Record<Exclude<ReasonCode, "OUTSIDE_ENTRY_RANGE">, string> = {
  PLAN_EXPIRED: "The entry window ended. This plan takes no new entries.",
  PLAN_REVOKED: "The curator withdrew this plan. It takes no new entries.",
  PLAN_SUPERSEDED: "The curator published a newer version. Review the new terms first.",
  STALE_DATA: "Prices or your account could not be confirmed in the last few seconds. Try again.",
  ACCOUNT_CHANGED: "Your account changed after the preview. Review the updated plan.",
  ACCOUNT_UNRECONCILED: "We cannot confirm your previous order yet. New entries are paused.",
  SYMBOL_BUSY: "You already have a Cadence plan open on this market.",
  UNKNOWN_EXPOSURE:
    "Your account holds a position or order Cadence did not place. New entries wait until it is closed.",
  RISK_BUDGET_EXHAUSTED: "Your open plans already use your whole risk budget.",
  BELOW_MARKET_MINIMUM:
    "Your remaining planned-risk budget is below this market’s minimum trade size.",
  INSUFFICIENT_MARGIN: "Your available margin cannot hold this position at your leverage.",
  INSUFFICIENT_DEPTH: "The order book cannot fill this size at the plan’s price.",
  RR_BELOW_POLICY: "After costs, the reward is too small for the risk under your rules.",
  LIQUIDATION_BUFFER_FAILED:
    "At your leverage the liquidation price would sit too close to the stop.",
  DUPLICATE_INTENT: "You already approved this plan.",
  UNSUPPORTED_CAPABILITY: "This plan cannot be placed on your account as it is set up.",
};

const resizedCopy: Partial<Record<ReasonCode, string>> = {
  INSUFFICIENT_DEPTH: "Sized down to what the order book can fill at the plan’s price.",
  INSUFFICIENT_MARGIN: "Sized down to fit your available margin.",
  UNSUPPORTED_CAPABILITY: "Sized down to the largest order this market accepts.",
};

function outsideRangeCopy(direction: Direction, plan: PublishedPlan, evidence: DecisionEvidence) {
  const side = direction === "long" ? "ask" : "bid";
  const price = direction === "long" ? evidence.bestAsk : evidence.bestBid;
  if (price === null) {
    return `There is no ${side} on the order book right now.`;
  }
  return new Decimal(price).greaterThan(plan.entryMax)
    ? `The current ${side} is above this plan’s highest entry price.`
    : `The current ${side} is below this plan’s lowest entry price.`;
}

export function blockedReasonCopy(
  reason: ReasonCode,
  plan: PublishedPlan,
  evidence: DecisionEvidence,
): string {
  return reason === "OUTSIDE_ENTRY_RANGE"
    ? outsideRangeCopy(plan.direction, plan, evidence)
    : fixedCopy[reason];
}

export function resizedReasonCopy(reason: ReasonCode): string {
  return resizedCopy[reason] ?? "Sized down to fit the market and your account.";
}
