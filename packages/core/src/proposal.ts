import { Decimal } from "decimal.js";
import type { DecisionOutcome, DecimalString, LimitingFactor, ReasonCode } from "./contract";
import type { DecisionInput, Proposal } from "./decision";
import { appliedCuratorFee } from "./curator-fee";
import { Exact, moneyPlaces, roundTo } from "./exact";
import { plannedLossFor, type EntryTerms, type SizedEntry } from "./sizing";

const ratioPlaces = 2;

const resizedReason: Partial<Record<LimitingFactor, ReasonCode>> = {
  depth: "INSUFFICIENT_DEPTH",
  margin: "INSUFFICIENT_MARGIN",
  leverage_tier: "INSUFFICIENT_MARGIN",
  max_order_size: "UNSUPPORTED_CAPABILITY",
};

export function admittedOutcome(limitedBy: LimitingFactor): {
  outcome: Exclude<DecisionOutcome, "BLOCKED">;
  reasons: readonly ReasonCode[];
} {
  const reason = resizedReason[limitedBy];
  return reason === undefined
    ? { outcome: "READY", reasons: [] }
    : { outcome: "RESIZED", reasons: [reason] };
}

export function proposalFor(
  input: DecisionInput,
  sized: SizedEntry,
  terms: EntryTerms,
  liquidationPrice: DecimalString,
): Proposal {
  const loss = plannedLossFor(sized.quantity, sized.perUnit);
  const leverage = input.accountState.symbolSettings.leverage;
  const tickPlaces = new Exact(input.market.tickSize).decimalPlaces();
  const towardEntry = input.plan.direction === "long" ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR;
  return {
    quantity: sized.quantity,
    limitPrice: sized.limitPrice,
    notional: roundTo(terms.notional, moneyPlaces, Decimal.ROUND_CEIL),
    priceLoss: loss.priceLoss,
    costs: loss.costs,
    plannedLoss: loss.plannedLoss,
    rewardRiskNet: roundTo(terms.rewardRisk, ratioPlaces, Decimal.ROUND_FLOOR),
    leverage,
    initialMargin: roundTo(terms.notional.dividedBy(leverage), moneyPlaces, Decimal.ROUND_CEIL),
    estimatedLiquidationPrice: roundTo(new Exact(liquidationPrice), tickPlaces, towardEntry),
    admissibleBudget: sized.budget,
    limitedBy: sized.limitedBy,
    curatorFee: appliedCuratorFee(input.plan, input.builderApproval),
  };
}
