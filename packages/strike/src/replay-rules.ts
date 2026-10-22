import {
  floorToGrid,
  withinPriceBounds,
  type DecimalString,
  type MarketRules,
  type MarkSnapshot,
} from "@cadence/core";
import type { StrategyOrder } from "./client";
import { compareDecimal, multiplyDecimal } from "./exact";
import type { ReplayScenario } from "./replay-scenarios";

const hourMs = 3_600_000;

export function replayMark(scenario: ReplayScenario, at: number): MarkSnapshot {
  return {
    symbol: scenario.market.symbol,
    markPrice: scenario.markPrice,
    indexPrice: scenario.markPrice,
    hourlyFundingRate: scenario.hourlyFundingRate,
    nextFundingTime: Math.floor(at / hourMs) * hourMs + hourMs,
    exchangeTime: at,
    observedAt: at,
  };
}

const onGrid = (value: DecimalString, origin: DecimalString, step: DecimalString) =>
  compareDecimal(floorToGrid(value, origin, step), value) === 0;

export function ruleViolation(
  order: StrategyOrder,
  market: MarketRules,
  mark: MarkSnapshot,
): string | null {
  if (order.symbol !== market.symbol) {
    return "the replay exchange lists only its scenario's market";
  }
  const prices = [order.limitPrice, order.stopPrice, order.targetPrice];
  if (!prices.every((price) => onGrid(price, market.minPrice, market.tickSize))) {
    return "a price is off the tick grid";
  }
  const lotSized = onGrid(order.size, market.limitMinSize, market.limitStepSize);
  if (!lotSized || compareDecimal(order.size, market.marketMinSize) < 0) {
    return "the size is off the lot grid";
  }
  if (compareDecimal(order.size, market.limitMaxSize) > 0) {
    return "the size is above the limit maximum";
  }
  if (compareDecimal(multiplyDecimal(order.size, order.limitPrice), market.minNotional) < 0) {
    return "the notional is below the minimum";
  }
  if (!withinPriceBounds({ price: order.limitPrice, mark, market })) {
    return "the limit price is outside the bound from mark";
  }
  return null;
}
