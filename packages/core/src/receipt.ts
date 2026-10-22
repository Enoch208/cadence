import { Decimal } from "decimal.js";
import type { ExchangeFill, ExchangeOrderSnapshot } from "./account";
import type { DecimalString, IntentState, OrderSide } from "./contract";
import type { Decision, Proposal } from "./decision";
import { planVersionDigest } from "./digest";
import { Exact, quotePlaces } from "./exact";
import type { PublishedPlan } from "./plan";

export type ReceiptInput = {
  intentId: string;
  planPublicId: string;
  planVersion: number;
  planDigest: string;
  plan: PublishedPlan;
  policyVersion: number;
  decision: Decision;
  finalState: IntentState;
  orders: readonly ExchangeOrderSnapshot[];
  fills: readonly ExchangeFill[];
  reconciledAt: number;
};

export type FilledLeg = { size: DecimalString; averagePrice: DecimalString };

export type Receipt = {
  intentId: string;
  planPublicId: string;
  planVersion: number;
  planDigest: string;
  policyVersion: number;
  approved: Proposal | null;
  state: IntentState;
  entry: FilledLeg | null;
  exit: FilledLeg | null;
  feesPaid: DecimalString;
  realizedPnl: DecimalString | null;
  exchangeOrderIds: readonly string[];
  incomplete: readonly string[];
  reconciledAt: number;
};

const neverEntered: readonly IntentState[] = [
  "prepared",
  "reserved",
  "blocked",
  "rejected",
  "unfilled",
  "canceled",
  "expired",
];

const sumOf = (fills: readonly ExchangeFill[], amount: (fill: ExchangeFill) => Decimal.Value) =>
  fills.reduce((total, fill) => total.plus(amount(fill)), new Exact(0));

const valueOf = (fills: readonly ExchangeFill[]) =>
  sumOf(fills, (fill) => new Exact(fill.price).times(fill.size));

function filledLeg(fills: readonly ExchangeFill[]): FilledLeg | null {
  const size = sumOf(fills, (fill) => fill.size);
  if (!size.greaterThan(0)) {
    return null;
  }
  const averagePrice = valueOf(fills)
    .dividedBy(size)
    .toDecimalPlaces(quotePlaces, Decimal.ROUND_HALF_UP);
  return { size: size.toFixed(), averagePrice: averagePrice.toFixed() };
}

const uniqueInOrder = (ids: readonly string[]) => [...new Set(ids)];

export function buildReceipt(input: ReceiptInput): Receipt {
  const { plan, fills } = input;
  const openingSide: OrderSide = plan.direction === "long" ? "buy" : "sell";
  const entryFills = fills.filter((fill) => fill.side === openingSide);
  const exitFills = fills.filter((fill) => fill.side !== openingSide);
  const entered = sumOf(entryFills, (fill) => fill.size);
  const exited = sumOf(exitFills, (fill) => fill.size);
  const fees = sumOf(fills, (fill) => fill.fee);
  const closed = entered.greaterThan(0) && exited.equals(entered);
  const gross =
    plan.direction === "long"
      ? valueOf(exitFills).minus(valueOf(entryFills))
      : valueOf(entryFills).minus(valueOf(exitFills));
  const missing: [boolean, string][] = [
    [planVersionDigest(plan) !== input.planDigest, "plan digest"],
    [!entered.greaterThan(0) && !neverEntered.includes(input.finalState), "entry fills"],
    [entered.greaterThan(0) && exited.lessThan(entered), "exit fills"],
    [exited.greaterThan(entered), "exit fills exceed the entry"],
  ];
  return {
    intentId: input.intentId,
    planPublicId: input.planPublicId,
    planVersion: input.planVersion,
    planDigest: input.planDigest,
    policyVersion: input.policyVersion,
    approved: input.decision.outcome === "BLOCKED" ? null : input.decision.proposal,
    state: input.finalState,
    entry: filledLeg(entryFills),
    exit: filledLeg(exitFills),
    feesPaid: fees.toFixed(),
    realizedPnl: closed ? gross.minus(fees).toFixed() : null,
    exchangeOrderIds: uniqueInOrder([
      ...input.orders.map((order) => order.orderId),
      ...fills.map((fill) => fill.orderId),
    ]),
    incomplete: missing.filter(([isMissing]) => isMissing).map(([, what]) => what),
    reconciledAt: input.reconciledAt,
  };
}
