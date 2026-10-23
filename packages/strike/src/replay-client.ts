import type { DecimalString } from "@cadence/core";
import type { StrategyOrder, StrikeClient } from "./client";
import { StrikeAmbiguousError, StrikeReadError } from "./errors";
import { createReplayExchange } from "./replay-exchange";
import { capturedTierZeroFees, type ReplayScenario } from "./replay-scenarios";

export type ReplayStrikeClient = StrikeClient & {
  submittedStrategies(): readonly StrategyOrder[];
  builderFeesPaid(): DecimalString;
};

const settled = <T>(work: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(work());
  });

export function createReplayStrikeClient(
  scenario: ReplayScenario,
  now: () => number,
): ReplayStrikeClient {
  const exchange = createReplayExchange(scenario, now);
  const { market } = scenario;
  let responseLost = false;

  return {
    environment: "replay",
    serverTime: () => settled(now),
    markets: () => settled(() => [market]),
    book: (symbol) =>
      settled(() => {
        const at = now() - scenario.marketDataAgeMs;
        const listed = symbol === market.symbol;
        return {
          symbol,
          bids: listed ? [[scenario.bid, scenario.depthSize] as const] : [],
          asks: listed ? [[scenario.ask, scenario.depthSize] as const] : [],
          exchangeTime: at,
          observedAt: at,
        };
      }),
    mark: (symbol) =>
      settled(() => {
        if (symbol !== market.symbol) {
          throw new StrikeReadError({ operation: "mark", status: 400, detail: "unknown symbol" });
        }
        return exchange.mark();
      }),
    fees: () => settled(() => ({ ...capturedTierZeroFees })),
    accountState: (symbol) => settled(() => exchange.accountState(symbol)),
    order: (symbol, clientOrderId) => settled(() => exchange.order(symbol, clientOrderId)),
    openOrders: (symbol) => settled(() => exchange.openOrders(symbol)),
    fills: (symbol, sinceMs) => settled(() => exchange.fills(symbol, sinceMs)),
    placeStrategy: (order) =>
      settled(() => {
        const ack = exchange.placeStrategy(order);
        if (scenario.behaviour.loseFirstStrategyResponse && !responseLost) {
          responseLost = true;
          throw new StrikeAmbiguousError({
            operation: "placeStrategy",
            reason: "timeout",
            detail: "this replay scenario loses the response after the exchange accepted the order",
          });
        }
        return ack;
      }),
    cancel: (symbol, clientOrderId) =>
      settled(() => {
        exchange.cancel(symbol, clientOrderId);
      }),
    closeReduceOnly: (order) => settled(() => exchange.closeReduceOnly(order)),
    configureSymbol: (symbol, settings) =>
      settled(() => {
        exchange.configure(symbol, settings);
      }),
    submittedStrategies: exchange.submitted,
    builderFeesPaid: exchange.builderFeesPaid,
  };
}
