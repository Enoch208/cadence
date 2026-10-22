import type { DecimalString, MarketStatus } from "./contract";

export type MarginTier = {
  maxNotional: DecimalString;
  maxLeverage: number;
  maintenanceMarginRate: DecimalString;
  maintenanceAmount: DecimalString;
};

export type MarketRules = {
  symbol: string;
  status: MarketStatus;
  reduceOnly: boolean;
  tickSize: DecimalString;
  minPrice: DecimalString;
  maxPrice: DecimalString;
  limitPriceBound: DecimalString;
  limitStepSize: DecimalString;
  limitMinSize: DecimalString;
  limitMaxSize: DecimalString;
  marketMinSize: DecimalString;
  minNotional: DecimalString;
  marginTiers: readonly MarginTier[];
};

export type BookLevel = readonly [price: DecimalString, size: DecimalString];

export type BookSnapshot = {
  symbol: string;
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
  exchangeTime: number;
  observedAt: number;
};

export type MarkSnapshot = {
  symbol: string;
  markPrice: DecimalString;
  indexPrice: DecimalString;
  hourlyFundingRate: DecimalString;
  nextFundingTime: number;
  exchangeTime: number;
  observedAt: number;
};

export type FeeSchedule = {
  takerRate: DecimalString;
  makerRate: DecimalString;
};
