import { Decimal } from "decimal.js";
import { reasonCodes, type ReasonCode } from "./contract";
import { admissibleBudget } from "./costs";
import {
  budgetReasons,
  capabilityReasons,
  entryRangeReasons,
  exposureReasons,
  freshnessReasons,
  limitReasons,
  planStandingReasons,
  sizeReasons,
} from "./decide-checks";
import type { Decision, DecisionEvidence, DecisionInput } from "./decision";
import { Exact, moneyPlaces, roundTo } from "./exact";
import { adverseLimitPrice, bestAsk, bestBid } from "./pricing";
import { admittedOutcome, proposalFor } from "./proposal";
import { entryTerms, sizeEntry } from "./sizing";

const admissionStages = [
  planStandingReasons,
  capabilityReasons,
  freshnessReasons,
  entryRangeReasons,
  exposureReasons,
] as const;

const inReasonOrder = (reasons: readonly ReasonCode[]) =>
  reasonCodes.filter((code) => reasons.includes(code));

const evidenceFor = (input: DecisionInput): DecisionEvidence => ({
  bestBid: bestBid(input.book),
  bestAsk: bestAsk(input.book),
  markPrice: input.mark.markPrice,
  accountObservedAt: input.accountState.account.observedAt,
  bookObservedAt: input.book.observedAt,
  markObservedAt: input.mark.observedAt,
  evaluatedAt: input.now,
});

export function decide(input: DecisionInput): Decision {
  const evidence = evidenceFor(input);
  const blocked = (reasons: readonly ReasonCode[]): Decision => ({
    outcome: "BLOCKED",
    reasons: inReasonOrder(reasons),
    evidence,
  });

  for (const stage of admissionStages) {
    const reasons = stage(input);
    if (reasons.length > 0) {
      return blocked(reasons);
    }
  }

  const budget = roundTo(new Exact(admissibleBudget(input)), moneyPlaces, Decimal.ROUND_FLOOR);
  const budgetIssues = budgetReasons(budget);
  if (budgetIssues.length > 0) {
    return blocked(budgetIssues);
  }

  const limitPrice = adverseLimitPrice(input);
  const limitIssues = limitReasons(input, limitPrice);
  if (limitPrice === null || limitIssues.length > 0) {
    return blocked(limitIssues);
  }

  const sized = sizeEntry(input, limitPrice, budget);
  const terms = entryTerms(input, sized);
  const sizeIssues = sizeReasons(input, sized, terms);
  if (terms.liquidationPrice === null || sizeIssues.length > 0) {
    return blocked(sizeIssues);
  }

  return {
    ...admittedOutcome(sized.limitedBy),
    proposal: proposalFor(input, sized, terms, terms.liquidationPrice),
    evidence,
  };
}
