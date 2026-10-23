import type {
  AccountSnapshot,
  BookSnapshot,
  DecimalString,
  ExchangeFill,
  ExchangeOrderSnapshot,
  FeeSchedule,
  MarketRules,
  MarkSnapshot,
  PositionSnapshot,
  SymbolSettings,
} from "@cadence/core";
import type { z } from "zod";
import type { OrderAck, StrategyAck } from "./client";
import {
  documentedAccountSchema,
  documentedFillHistorySchema,
  documentedOpenOrdersSchema,
  documentedOrderAckSchema,
  documentedOrderSchema,
  documentedPositionsSchema,
  documentedStrategyAckSchema,
  documentedSymbolsSchema,
} from "./schemas/account";
import {
  depthResponseSchema,
  feeTiersSchema,
  marketsResponseSchema,
  markPriceSchema,
  serverTimeSchema,
} from "./schemas/public";

const priceOrNull = (price: string): DecimalString | null =>
  price === "" || /^0(?:\.0+)?$/.test(price) ? null : price;

export function toMarketRules(raw: unknown): MarketRules[] {
  return Object.values(marketsResponseSchema.parse(raw).markets).map((market) => ({
    symbol: market.symbol,
    status: market.status,
    reduceOnly: market.reduce_only,
    tickSize: market.order_tick_price,
    minPrice: market.order_min_price,
    maxPrice: market.order_max_price,
    limitPriceBound: market.order_limit_price_bound,
    limitStepSize: market.order_limit_step_size,
    limitMinSize: market.order_limit_min_size,
    limitMaxSize: market.order_limit_max_size,
    marketMinSize: market.order_market_min_size,
    minNotional: market.order_min_notional,
    marginTiers: market.margin_tiers.map((tier) => ({
      maxNotional: tier.max_notional,
      maxLeverage: tier.max_leverage,
      maintenanceMarginRate: tier.maintenance_margin_rate,
      maintenanceAmount: tier.maintenance_amount,
    })),
  }));
}

export function toBookSnapshot(raw: unknown, symbol: string, observedAt: number): BookSnapshot {
  const depth = depthResponseSchema.parse(raw);
  return { symbol, bids: depth.bids, asks: depth.asks, exchangeTime: depth.T, observedAt };
}

export function toMarkSnapshot(raw: unknown, observedAt: number): MarkSnapshot {
  const mark = markPriceSchema.parse(raw);
  return {
    symbol: mark.s,
    markPrice: mark.p,
    indexPrice: mark.i,
    hourlyFundingRate: mark.r,
    nextFundingTime: mark.T,
    exchangeTime: mark.E,
    observedAt,
  };
}

export function toFeeSchedule(raw: unknown, tier = 0): FeeSchedule {
  const found = feeTiersSchema.parse(raw).feeTiers.find((row) => row.Tier === tier);
  if (found === undefined) {
    throw new Error(`Strike publishes no fee tier ${String(tier)}`);
  }
  return { takerRate: found.TakerRate, makerRate: found.MakerRate };
}

export const toServerTime = (raw: unknown): number => serverTimeSchema.parse(raw).serverTime;

export function toAccountSnapshot(raw: unknown, observedAt: number): AccountSnapshot {
  const account = documentedAccountSchema.parse(raw);
  return {
    accountId: account.account_id,
    environment: "live",
    availableBalance: account.available_balance,
    observedAt,
  };
}

export const toPositionSnapshots = (raw: unknown): PositionSnapshot[] =>
  documentedPositionsSchema.parse(raw).positions.map((position) => ({
    symbol: position.symbol,
    signedSize: position.size,
    entryPrice: position.entry_price,
    marginMode: position.margin_mode,
    leverage: position.leverage,
    liquidationPrice: priceOrNull(position.liquidation_price),
  }));

const orderSnapshot = (order: z.infer<typeof documentedOrderSchema>): ExchangeOrderSnapshot => ({
  orderId: order.ID,
  clientOrderId: order.ClientOrderID,
  symbol: order.Symbol,
  side: order.Side,
  type: order.Type,
  status: order.Status,
  size: order.Size,
  filled: order.Filled,
  price: priceOrNull(order.Price),
  stopPrice: priceOrNull(order.StopPrice),
  reduceOnly: order.ReduceOnly,
  strategyId: order.Strategy?.ID ?? null,
  isStrategyPrimary: order.Strategy?.IsPrimary ?? false,
  closeReason: order.CloseReason === "" ? null : order.CloseReason,
});

export const toExchangeOrderSnapshot = (raw: unknown): ExchangeOrderSnapshot =>
  orderSnapshot(documentedOrderSchema.parse(raw));

export const toExchangeOrderSnapshots = (raw: unknown): ExchangeOrderSnapshot[] =>
  documentedOpenOrdersSchema.parse(raw).orders.map(orderSnapshot);

export function toSymbolSettings(raw: unknown, symbol: string): SymbolSettings {
  const symbols = documentedSymbolsSchema.parse(raw);
  const stored = symbols.symbol_settings[symbol];
  return {
    symbol,
    marginMode: stored?.margin_mode ?? symbols.default_margin_mode,
    leverage: stored?.leverage ?? symbols.default_leverage,
  };
}

export type FillRow = {
  fillId: string;
  orderId: string;
  symbol: string;
  side: ExchangeFill["side"];
  price: DecimalString;
  size: DecimalString;
  fee: DecimalString;
  filledAt: number;
};

export const toFillRows = (raw: unknown): FillRow[] =>
  documentedFillHistorySchema.parse(raw).fills.map((fill) => ({
    fillId: fill.id,
    orderId: fill.order_id,
    symbol: fill.symbol,
    side: fill.side,
    price: fill.price,
    size: fill.size,
    fee: fill.fee,
    filledAt: fill.timestamp,
  }));

export const toExchangeFill = (row: FillRow, clientOrderId: string | null): ExchangeFill => ({
  ...row,
  clientOrderId,
});

export function toStrategyAck(raw: unknown, acknowledgedAt: number): StrategyAck {
  const ack = documentedStrategyAckSchema.parse(raw);
  return {
    strategyId: ack.strategy_id,
    entryClientOrderId: ack.primary_client_order_id,
    accountId: ack.account_id,
    acknowledgedAt,
  };
}

export function toOrderAck(raw: unknown, acknowledgedAt: number): OrderAck {
  const ack = documentedOrderAckSchema.parse(raw);
  return { clientOrderId: ack.client_order_id, accountId: ack.account_id, acknowledgedAt };
}
