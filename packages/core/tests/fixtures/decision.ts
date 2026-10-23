import { Decimal } from "decimal.js";
import type { ExchangeOrderSnapshot, PositionSnapshot } from "../../src/account";
import { decide } from "../../src/decide";
import type { DecisionInput } from "../../src/decision";
import {
  accountWith,
  bookAround,
  btcUsdRules,
  capturedHourlyFundingRate,
  defaultPolicy,
  fixtureNow,
  longPlan,
  markAt,
  shortPlan,
  takerFees,
} from "./btc-usd";

export const longInput = (): DecisionInput => ({
  plan: longPlan,
  admission: { status: "published", isCurrentVersion: true },
  policy: defaultPolicy,
  quantityCeiling: null,
  accountState: accountWith("1000", fixtureNow),
  accountReconciled: true,
  builderApproval: null,
  exposure: {
    busySymbols: [],
    knownClientOrderIds: [],
    committedRisk: "0",
    realizedSessionLoss: "0",
  },
  market: btcUsdRules,
  book: bookAround("83999", "84000", "0.5", fixtureNow),
  mark: markAt("84000", fixtureNow, capturedHourlyFundingRate),
  fees: takerFees,
  now: fixtureNow,
});

export const shortInput = (): DecisionInput => ({
  ...longInput(),
  plan: shortPlan,
  book: bookAround("84400", "84401", "0.5", fixtureNow),
  mark: markAt("84400", fixtureNow, capturedHourlyFundingRate),
});

export const withLongQuote = (ask: string, size = "0.5"): DecisionInput => {
  const bid = new Decimal(ask).minus(btcUsdRules.tickSize).toFixed();
  return {
    ...longInput(),
    book: bookAround(bid, ask, size, fixtureNow),
    mark: markAt(ask, fixtureNow, capturedHourlyFundingRate),
  };
};

export const openPosition = (symbol: string, signedSize: string): PositionSnapshot => ({
  symbol,
  signedSize,
  entryPrice: "84000",
  marginMode: "isolated",
  leverage: 5,
  liquidationPrice: null,
});

export const restingOrder = (clientOrderId: string): ExchangeOrderSnapshot => ({
  orderId: `order-${clientOrderId}`,
  clientOrderId,
  symbol: "BTC-USD",
  side: "sell",
  type: "stop",
  status: "untriggered",
  size: "0.01",
  filled: "0",
  price: null,
  stopPrice: "83200",
  reduceOnly: true,
  strategyId: "cad-earlier-intent",
  isStrategyPrimary: false,
  closeReason: null,
});

export const outcomeOf = (input: DecisionInput) => {
  const decision = decide(input);
  return { outcome: decision.outcome, reasons: decision.reasons };
};

export const blocked = (...reasons: string[]) => ({ outcome: "BLOCKED", reasons });

export const ready = { outcome: "READY", reasons: [] };
