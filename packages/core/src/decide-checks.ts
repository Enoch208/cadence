import type { LimitingFactor, ReasonCode } from "./contract";
import type { DecisionInput } from "./decision";
import { Exact } from "./exact";
import { freshness } from "./freshness";
import { executablePrice, isOrderablePrice, withinPriceBounds } from "./pricing";
import type { EntryTerms, SizedEntry } from "./sizing";

type Check = readonly [failed: boolean, reason: ReasonCode];

const failing = (checks: readonly Check[]): ReasonCode[] =>
  checks.filter(([failed]) => failed).map(([, reason]) => reason);

export const planStandingReasons = ({ admission, plan, now }: DecisionInput) =>
  failing([
    [admission.status === "revoked", "PLAN_REVOKED"],
    [!admission.isCurrentVersion, "PLAN_SUPERSEDED"],
    [now >= Date.parse(plan.entryExpiresAt), "PLAN_EXPIRED"],
  ]);

export function capabilityReasons(input: DecisionInput): ReasonCode[] {
  const { plan, policy, market } = input;
  const settings = input.accountState.symbolSettings;
  const symbols = [market.symbol, input.book.symbol, input.mark.symbol, settings.symbol];
  const leverageAllowed =
    Number.isInteger(settings.leverage) &&
    settings.leverage >= 1 &&
    settings.leverage <= policy.leverageCap;
  const unsupported =
    input.accountState.account.environment !== plan.environment ||
    !policy.allowedMarkets.includes(plan.market) ||
    symbols.some((symbol) => symbol !== plan.market) ||
    market.status !== "trading" ||
    market.reduceOnly ||
    settings.marginMode !== "isolated" ||
    !leverageAllowed;
  return failing([[unsupported, "UNSUPPORTED_CAPABILITY"]]);
}

export function freshnessReasons(input: DecisionInput): ReasonCode[] {
  const ageOf = (observedAt: number) => input.now - observedAt;
  const stale =
    ageOf(input.accountState.account.observedAt) > freshness.accountMaxAgeMs ||
    ageOf(input.book.observedAt) > freshness.depthMaxAgeMs ||
    ageOf(input.mark.observedAt) > freshness.markMaxAgeMs;
  return failing([
    [stale, "STALE_DATA"],
    [!input.accountReconciled, "ACCOUNT_UNRECONCILED"],
  ]);
}

export function entryRangeReasons({ plan, book }: DecisionInput): ReasonCode[] {
  const quote = executablePrice(plan.direction, book);
  const outside =
    quote === null ||
    new Exact(quote).lessThan(plan.entryMin) ||
    new Exact(quote).greaterThan(plan.entryMax);
  return failing([[outside, "OUTSIDE_ENTRY_RANGE"]]);
}

export function exposureReasons({ plan, accountState, exposure }: DecisionInput): ReasonCode[] {
  const busy = new Set(exposure.busySymbols);
  const known = new Set(exposure.knownClientOrderIds);
  const strayPosition = accountState.positions.some(
    (position) => !new Exact(position.signedSize).isZero() && !busy.has(position.symbol),
  );
  const strayOrder = accountState.openOrders.some((order) => !known.has(order.clientOrderId));
  return failing([
    [busy.has(plan.market), "SYMBOL_BUSY"],
    [strayPosition || strayOrder, "UNKNOWN_EXPOSURE"],
  ]);
}

export const budgetReasons = (budget: string): ReasonCode[] =>
  failing([[!new Exact(budget).greaterThan(0), "RISK_BUDGET_EXHAUSTED"]]);

export function limitReasons(input: DecisionInput, limitPrice: string | null): ReasonCode[] {
  if (limitPrice === null) {
    return ["OUTSIDE_ENTRY_RANGE"];
  }
  const { plan, market } = input;
  const unsupported =
    !withinPriceBounds({ price: limitPrice, mark: input.mark, market }) ||
    !isOrderablePrice(plan.stopPrice, market) ||
    !isOrderablePrice(plan.targetPrice, market);
  return failing([[unsupported, "UNSUPPORTED_CAPABILITY"]]);
}

const undersizedReason: Record<LimitingFactor, ReasonCode> = {
  budget: "BELOW_MARKET_MINIMUM",
  ceiling: "BELOW_MARKET_MINIMUM",
  depth: "INSUFFICIENT_DEPTH",
  margin: "INSUFFICIENT_MARGIN",
  max_order_size: "BELOW_MARKET_MINIMUM",
  leverage_tier: "INSUFFICIENT_MARGIN",
};

function liquidationBeyondStop(input: DecisionInput, liquidationPrice: string | null): boolean {
  if (liquidationPrice === null) {
    return false;
  }
  const buffer = new Exact(input.policy.liquidationBufferBps).dividedBy(10_000);
  const stop = new Exact(input.plan.stopPrice);
  return input.plan.direction === "long"
    ? new Exact(liquidationPrice).lessThanOrEqualTo(stop.times(new Exact(1).minus(buffer)))
    : new Exact(liquidationPrice).greaterThanOrEqualTo(stop.times(buffer.plus(1)));
}

export function sizeReasons(
  input: DecisionInput,
  sized: SizedEntry,
  terms: EntryTerms,
): ReasonCode[] {
  const { market } = input;
  const quantity = new Exact(sized.quantity);
  const smallestLot = Exact.max(market.limitMinSize, market.marketMinSize);
  const undersized =
    !quantity.greaterThan(0) ||
    quantity.lessThan(smallestLot) ||
    terms.notional.lessThan(market.minNotional);
  return failing([
    [undersized, undersizedReason[sized.limitedBy]],
    [
      quantity.greaterThan(0) && !liquidationBeyondStop(input, terms.liquidationPrice),
      "LIQUIDATION_BUFFER_FAILED",
    ],
    [terms.rewardRisk.lessThan(input.policy.minRewardRisk), "RR_BELOW_POLICY"],
  ]);
}
