import type { AccountState } from "./account";
import type { DecimalString, DecisionOutcome, LimitingFactor, ReasonCode } from "./contract";
import type { BookSnapshot, FeeSchedule, MarketRules, MarkSnapshot } from "./market";
import type { PublishedPlan } from "./plan";
import type { RiskPolicy } from "./policy";

export type PlanAdmission = {
  status: "published" | "revoked";
  isCurrentVersion: boolean;
};

export type CadenceExposure = {
  busySymbols: readonly string[];
  knownClientOrderIds: readonly string[];
  committedRisk: DecimalString;
  realizedSessionLoss: DecimalString;
};

export type DecisionInput = {
  plan: PublishedPlan;
  admission: PlanAdmission;
  policy: RiskPolicy;
  quantityCeiling: DecimalString | null;
  accountState: AccountState;
  accountReconciled: boolean;
  exposure: CadenceExposure;
  market: MarketRules;
  book: BookSnapshot;
  mark: MarkSnapshot;
  fees: FeeSchedule;
  now: number;
};

export type CostBreakdown = {
  entryFee: DecimalString;
  exitFee: DecimalString;
  stopSlippageReserve: DecimalString;
  fundingReserve: DecimalString;
};

export type Proposal = {
  quantity: DecimalString;
  limitPrice: DecimalString;
  notional: DecimalString;
  priceLoss: DecimalString;
  costs: CostBreakdown;
  plannedLoss: DecimalString;
  rewardRiskNet: DecimalString;
  leverage: number;
  initialMargin: DecimalString;
  estimatedLiquidationPrice: DecimalString;
  admissibleBudget: DecimalString;
  limitedBy: LimitingFactor;
};

export type DecisionEvidence = {
  bestBid: DecimalString | null;
  bestAsk: DecimalString | null;
  markPrice: DecimalString;
  accountObservedAt: number;
  bookObservedAt: number;
  markObservedAt: number;
  evaluatedAt: number;
};

export type Decision =
  | {
      outcome: Extract<DecisionOutcome, "BLOCKED">;
      reasons: readonly ReasonCode[];
      evidence: DecisionEvidence;
    }
  | {
      outcome: Exclude<DecisionOutcome, "BLOCKED">;
      reasons: readonly ReasonCode[];
      proposal: Proposal;
      evidence: DecisionEvidence;
    };
