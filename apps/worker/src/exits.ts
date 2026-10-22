import { Decimal } from "decimal.js";
import type {
  DecimalString,
  ExchangeOrderSnapshot,
  ExchangeOrderStatus,
  OrderSide,
} from "@cadence/core";

export type LegExpectation = {
  clientOrderId: string;
  strategyId: string;
  side: OrderSide;
  triggerPrice: DecimalString;
};

export type ExitsSummary = {
  armed: boolean;
  live: boolean;
  exiting: boolean;
};

const liveStatuses: readonly ExchangeOrderStatus[] = ["pending", "open", "untriggered"];

export const isLive = (order: ExchangeOrderSnapshot | null) =>
  order !== null && liveStatuses.includes(order.status);

const hasFilled = (order: ExchangeOrderSnapshot) => new Decimal(order.filled).greaterThan(0);

export function legArmed(
  leg: ExchangeOrderSnapshot | null,
  expected: LegExpectation,
  positionSize: DecimalString,
): boolean {
  return (
    leg !== null &&
    leg.clientOrderId === expected.clientOrderId &&
    leg.strategyId === expected.strategyId &&
    leg.status === "untriggered" &&
    leg.reduceOnly &&
    leg.side === expected.side &&
    leg.stopPrice !== null &&
    new Decimal(leg.stopPrice).equals(expected.triggerPrice) &&
    new Decimal(leg.size).minus(leg.filled).greaterThanOrEqualTo(positionSize)
  );
}

export function summarizeExits(
  legs: readonly { leg: ExchangeOrderSnapshot | null; expected: LegExpectation }[],
  positionSize: DecimalString,
): ExitsSummary {
  return {
    armed: legs.every(({ leg, expected }) => legArmed(leg, expected, positionSize)),
    live: legs.some(({ leg }) => isLive(leg)),
    exiting: legs.some(
      ({ leg }) =>
        leg !== null && (leg.status === "open" || leg.status === "filled" || hasFilled(leg)),
    ),
  };
}

export type HeldPosition = { size: DecimalString; opposite: boolean };

export function heldPosition(signedSize: DecimalString, buying: boolean): HeldPosition {
  const along = new Decimal(signedSize).times(buying ? 1 : -1);
  return { size: Decimal.max(0, along).toFixed(), opposite: along.isNegative() && !along.isZero() };
}
