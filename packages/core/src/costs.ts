import type { Decimal } from "decimal.js";
import type { DecimalString, Direction } from "./contract";
import type { CadenceExposure } from "./decision";
import { Exact } from "./exact";
import type { FeeSchedule, MarkSnapshot } from "./market";
import type { RiskPolicy } from "./policy";

export type PerUnitLoss = {
  priceLoss: DecimalString;
  entryFee: DecimalString;
  exitFee: DecimalString;
  stopSlippageReserve: DecimalString;
  fundingReserve: DecimalString;
  curatorFee: DecimalString;
  total: DecimalString;
};

export function perUnitLoss(args: {
  direction: Direction;
  entry: DecimalString;
  stop: DecimalString;
  fees: FeeSchedule;
  policy: RiskPolicy;
  mark: MarkSnapshot;
  curatorFeeRate: Decimal.Value;
}): PerUnitLoss {
  const entry = new Exact(args.entry);
  const stop = new Exact(args.stop);
  const priceLoss = args.direction === "long" ? entry.minus(stop) : stop.minus(entry);
  if (!priceLoss.greaterThan(0)) {
    throw new RangeError(`A ${args.direction} entered at ${args.entry} is already past its stop`);
  }
  const entryFee = entry.times(args.fees.takerRate);
  const exitFee = stop.times(args.fees.takerRate);
  const stopSlippageReserve = stop.times(args.policy.stopSlippageReserveBps).dividedBy(10_000);
  const fundingReserve = entry
    .times(new Exact(args.mark.hourlyFundingRate).abs())
    .times(args.policy.fundingHorizonHours);
  const curatorFee = entry.plus(stop).times(args.curatorFeeRate);
  const total = priceLoss
    .plus(entryFee)
    .plus(exitFee)
    .plus(stopSlippageReserve)
    .plus(fundingReserve)
    .plus(curatorFee);
  return {
    priceLoss: priceLoss.toFixed(),
    entryFee: entryFee.toFixed(),
    exitFee: exitFee.toFixed(),
    stopSlippageReserve: stopSlippageReserve.toFixed(),
    fundingReserve: fundingReserve.toFixed(),
    curatorFee: curatorFee.toFixed(),
    total: total.toFixed(),
  };
}

export function admissibleBudget(args: {
  policy: RiskPolicy;
  exposure: CadenceExposure;
}): DecimalString {
  const committed = new Exact(args.exposure.committedRisk);
  const realizedLoss = new Exact(args.exposure.realizedSessionLoss).abs();
  const remaining = Exact.min(
    args.policy.perTradeBudget,
    new Exact(args.policy.aggregateBudget).minus(committed),
    new Exact(args.policy.sessionBudget).minus(realizedLoss).minus(committed),
  );
  return Exact.max(0, remaining).toFixed();
}
