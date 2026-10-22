import { clientOrderIdFor, strategyIdFor, type Proposal, type PublishedPlan } from "@cadence/core";
import type { ReduceOnlyClose, StrategyOrder } from "./client";
import { compareDecimal } from "./exact";

export function toStrategyOrder(args: {
  intentId: string;
  plan: PublishedPlan;
  proposal: Proposal;
}): StrategyOrder {
  return {
    strategyId: strategyIdFor(args.intentId),
    entryClientOrderId: clientOrderIdFor(args.intentId, "entry"),
    stopClientOrderId: clientOrderIdFor(args.intentId, "stop"),
    targetClientOrderId: clientOrderIdFor(args.intentId, "target"),
    symbol: args.plan.market,
    side: args.plan.direction === "long" ? "buy" : "sell",
    size: args.proposal.quantity,
    limitPrice: args.proposal.limitPrice,
    stopPrice: args.plan.stopPrice,
    targetPrice: args.plan.targetPrice,
  };
}

export function exitsSurroundEntry(order: StrategyOrder): boolean {
  const below = order.side === "buy" ? order.stopPrice : order.targetPrice;
  const above = order.side === "buy" ? order.targetPrice : order.stopPrice;
  return compareDecimal(below, order.limitPrice) < 0 && compareDecimal(order.limitPrice, above) < 0;
}

export function strategyRequestBody(order: StrategyOrder) {
  if (!exitsSurroundEntry(order)) {
    throw new Error("The exits are on the wrong side of the entry");
  }
  return {
    strategy_id: order.strategyId,
    client_order_id: order.entryClientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: "limit",
    size: order.size,
    price: order.limitPrice,
    time_in_force: "FOK",
    tp_order: {
      client_order_id: order.targetClientOrderId,
      type: "take_profit",
      size: order.size,
      stop_price: order.targetPrice,
      working_type: "mark_price",
    },
    sl_order: {
      client_order_id: order.stopClientOrderId,
      type: "stop",
      size: order.size,
      stop_price: order.stopPrice,
      working_type: "mark_price",
    },
  } as const;
}

export const reduceOnlyCloseBody = (order: ReduceOnlyClose) =>
  ({
    client_order_id: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: "market",
    size: order.size,
    reduce_only: true,
  }) as const;
