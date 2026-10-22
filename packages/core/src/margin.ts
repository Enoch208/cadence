import { Decimal } from "decimal.js";
import type { DecimalString, Direction } from "./contract";
import { Exact, quotePlaces } from "./exact";
import { floorToStep } from "./grid";
import type { MarginTier } from "./market";

function requireLeverage(leverage: number): void {
  if (!Number.isInteger(leverage) || leverage < 1) {
    throw new RangeError(`Leverage must be a whole number of at least 1, not ${String(leverage)}`);
  }
}

export function tierForNotional(
  notional: DecimalString,
  tiers: readonly MarginTier[],
): MarginTier | null {
  const value = new Exact(notional);
  return tiers.find((tier) => value.lessThanOrEqualTo(tier.maxNotional)) ?? null;
}

export function initialMargin(notional: DecimalString, leverage: number): DecimalString {
  requireLeverage(leverage);
  return new Exact(notional)
    .dividedBy(leverage)
    .toDecimalPlaces(quotePlaces, Decimal.ROUND_CEIL)
    .toFixed();
}

export function maxQuantityForMargin(args: {
  availableBalance: DecimalString;
  limitPrice: DecimalString;
  leverage: number;
  takerRate: DecimalString;
  step: DecimalString;
}): DecimalString {
  requireLeverage(args.leverage);
  const costPerUnitTimesLeverage = new Exact(args.limitPrice).times(
    new Exact(args.takerRate).times(args.leverage).plus(1),
  );
  const quantity = Exact.max(0, args.availableBalance)
    .times(args.leverage)
    .dividedBy(costPerUnitTimesLeverage);
  return floorToStep(quantity.toFixed(), args.step);
}

export function maxQuantityForLeverage(args: {
  leverage: number;
  limitPrice: DecimalString;
  tiers: readonly MarginTier[];
  step: DecimalString;
}): DecimalString {
  const widest = args.tiers.findLast((tier) => tier.maxLeverage >= args.leverage);
  const notional = widest === undefined ? new Exact(0) : new Exact(widest.maxNotional);
  return floorToStep(notional.dividedBy(args.limitPrice).toFixed(), args.step);
}

export function estimatedLiquidationPrice(args: {
  direction: Direction;
  entry: DecimalString;
  quantity: DecimalString;
  leverage: number;
  tier: MarginTier;
}): DecimalString {
  requireLeverage(args.leverage);
  const quantity = new Exact(args.quantity);
  if (!quantity.greaterThan(0)) {
    throw new RangeError("A liquidation price needs a position to liquidate");
  }
  const side = args.direction === "long" ? 1 : -1;
  const notionalTimesLeverage = quantity.times(args.entry).times(args.leverage);
  const isolatedBalanceTimesLeverage = quantity.times(args.entry);
  const maintenanceAmountTimesLeverage = new Exact(args.tier.maintenanceAmount).times(
    args.leverage,
  );
  const numerator = notionalTimesLeverage.minus(
    isolatedBalanceTimesLeverage.plus(maintenanceAmountTimesLeverage).times(side),
  );
  const denominator = quantity
    .times(args.leverage)
    .times(new Exact(args.tier.maintenanceMarginRate).times(side).negated().plus(1));
  const towardEntry = side === 1 ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR;
  return numerator.dividedBy(denominator).toDecimalPlaces(quotePlaces, towardEntry).toFixed();
}
