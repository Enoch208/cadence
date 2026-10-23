import { Decimal } from "decimal.js";
import type { CuratorFee, DecimalString } from "./contract";
import { Exact, moneyPlaces, roundTo } from "./exact";
import type { PublishedPlan } from "./plan";

export type BuilderApproval = { builderCode: string; maxFeeBps: number };

const basisPoints = 10_000;

export function appliedCuratorFee(
  plan: PublishedPlan,
  approval: BuilderApproval | null,
): CuratorFee | null {
  const fee = plan.curatorFee;
  if (fee === undefined || approval === null) {
    return null;
  }
  const covered = approval.builderCode === fee.builderCode && fee.feeBps <= approval.maxFeeBps;
  return covered ? { builderCode: fee.builderCode, feeBps: fee.feeBps } : null;
}

export const curatorFeeRate = (fee: CuratorFee | null): Decimal =>
  new Exact(fee?.feeBps ?? 0).dividedBy(basisPoints);

export const curatorFeeCharge = (
  price: DecimalString,
  size: DecimalString,
  feeBps: number,
): DecimalString =>
  roundTo(
    new Exact(price).times(size).times(feeBps).dividedBy(basisPoints),
    moneyPlaces,
    Decimal.ROUND_FLOOR,
  );
