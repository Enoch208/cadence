import { Decimal } from "decimal.js";
import type {
  CadenceExposure,
  CuratorFee,
  DecimalString,
  Direction,
  Environment,
  Proposal,
} from "@cadence/core";

export type EnvelopeBreach =
  | "curator_fee_changed"
  | "quantity_above_approval"
  | "limit_price_worse_than_approved"
  | "notional_above_live_ceiling";

export const sameCuratorFee = (approved: CuratorFee | null, now: CuratorFee | null) =>
  approved?.builderCode === now?.builderCode && approved?.feeBps === now?.feeBps;

export function envelopeBreach(args: {
  approved: Proposal;
  proposal: Proposal;
  direction: Direction;
  environment: Environment;
  liveMaxNotional: DecimalString;
}): EnvelopeBreach | null {
  const { approved, proposal } = args;
  if (!sameCuratorFee(approved.curatorFee, proposal.curatorFee)) {
    return "curator_fee_changed";
  }
  if (new Decimal(proposal.quantity).greaterThan(approved.quantity)) {
    return "quantity_above_approval";
  }
  const priceMove = new Decimal(proposal.limitPrice).comparedTo(approved.limitPrice);
  if (args.direction === "long" ? priceMove > 0 : priceMove < 0) {
    return "limit_price_worse_than_approved";
  }
  const notional = new Decimal(proposal.quantity).times(proposal.limitPrice);
  if (args.environment === "live" && notional.greaterThan(args.liveMaxNotional)) {
    return "notional_above_live_ceiling";
  }
  return null;
}

export function exposureBesides(
  exposure: CadenceExposure,
  own: { market: string; reservedLoss: DecimalString },
): CadenceExposure {
  return {
    ...exposure,
    busySymbols: exposure.busySymbols.filter((symbol) => symbol !== own.market),
    committedRisk: Decimal.max(
      0,
      new Decimal(exposure.committedRisk).minus(own.reservedLoss),
    ).toFixed(),
  };
}
