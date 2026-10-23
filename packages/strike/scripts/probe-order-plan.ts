import {
  bestAsk,
  ceilToGrid,
  clientOrderIdFor,
  floorToGrid,
  positiveDecimalSchema,
  strategyIdFor,
  withinPriceBounds,
  type BookSnapshot,
  type DecimalString,
  type MarketRules,
  type MarkSnapshot,
} from "@cadence/core";
import type { StrategyOrder } from "../src/client";
import { addDecimal, compareDecimal, divideDecimal, multiplyDecimal } from "../src/exact";

export function liveCeiling(env: Record<string, string | undefined>): DecimalString {
  const parsed = positiveDecimalSchema.safeParse(env.CADENCE_LIVE_MAX_NOTIONAL);
  if (!parsed.success) {
    throw new Error("CADENCE_LIVE_MAX_NOTIONAL must be set to a positive decimal such as 15");
  }
  return parsed.data;
}

const larger = (a: DecimalString, b: DecimalString) => (compareDecimal(a, b) >= 0 ? a : b);
const smaller = (a: DecimalString, b: DecimalString) => (compareDecimal(a, b) <= 0 ? a : b);

function smallestSize(market: MarketRules, price: DecimalString): DecimalString {
  const floor = larger(market.limitMinSize, market.marketMinSize);
  const needed = divideDecimal(market.minNotional, price, 18);
  const size = larger(floor, ceilToGrid(needed, market.limitMinSize, market.limitStepSize));
  return compareDecimal(multiplyDecimal(size, price), market.minNotional) >= 0
    ? size
    : addDecimal(size, market.limitStepSize);
}

export function minimumProbeOrder(args: {
  intentId: string;
  market: MarketRules;
  book: BookSnapshot;
  mark: MarkSnapshot;
  maxNotional: DecimalString;
}): { order: StrategyOrder; notional: DecimalString } {
  const { market, mark } = args;
  if (market.status !== "trading" || market.reduceOnly) {
    throw new Error(`${market.symbol} is not trading normally (${market.status})`);
  }
  const ask = bestAsk(args.book);
  if (ask === null) {
    throw new Error(`The ${market.symbol} book has no ask`);
  }
  if (!withinPriceBounds({ price: ask, mark, market })) {
    throw new Error(`The best ask ${ask} is outside Strike's price bounds around mark`);
  }
  const size = smallestSize(market, smaller(ask, mark.markPrice));
  const notional = multiplyDecimal(size, ask);
  if (compareDecimal(notional, args.maxNotional) > 0) {
    throw new Error(
      `The probe order's notional ${notional} exceeds CADENCE_LIVE_MAX_NOTIONAL ${args.maxNotional}`,
    );
  }
  const order: StrategyOrder = {
    strategyId: strategyIdFor(args.intentId),
    entryClientOrderId: clientOrderIdFor(args.intentId, "entry"),
    stopClientOrderId: clientOrderIdFor(args.intentId, "stop"),
    targetClientOrderId: clientOrderIdFor(args.intentId, "target"),
    symbol: market.symbol,
    side: "buy",
    size,
    limitPrice: ask,
    stopPrice: floorToGrid(multiplyDecimal(ask, "0.99"), market.minPrice, market.tickSize),
    targetPrice: ceilToGrid(multiplyDecimal(ask, "1.01"), market.minPrice, market.tickSize),
    builderFeeBps: null,
  };
  return { order, notional };
}
