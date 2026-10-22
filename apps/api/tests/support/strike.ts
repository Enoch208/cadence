import type { MarketRules } from "@cadence/core";
import type { StrikeClient } from "@cadence/strike";

const marginTiers = [
  {
    maxNotional: "10000",
    maxLeverage: 100,
    maintenanceMarginRate: "0.004",
    maintenanceAmount: "0",
  },
  { maxNotional: "50000", maxLeverage: 75, maintenanceMarginRate: "0.004", maintenanceAmount: "0" },
];

export const btcUsd: MarketRules = {
  symbol: "BTC-USD",
  status: "trading",
  reduceOnly: false,
  tickSize: "1",
  minPrice: "10",
  maxPrice: "100000",
  limitPriceBound: "0.05",
  limitStepSize: "0.00001",
  limitMinSize: "0.00001",
  limitMaxSize: "1000",
  marketMinSize: "0.00001",
  minNotional: "10",
  marginTiers,
};

export const dogeUsdPreTrading: MarketRules = {
  ...btcUsd,
  symbol: "DOGE-USD",
  status: "pre_trading",
  tickSize: "0.00001",
  minPrice: "0.00001",
  maxPrice: "100",
};

const unused = (operation: string) => () =>
  Promise.reject(new Error(`The test Strike client does not serve ${operation}`));

export function stubStrikeClient(markets: readonly MarketRules[]): StrikeClient {
  return {
    environment: "live",
    serverTime: unused("serverTime"),
    markets: () => Promise.resolve(markets),
    book: unused("book"),
    mark: unused("mark"),
    fees: unused("fees"),
    accountState: unused("accountState"),
    order: unused("order"),
    openOrders: unused("openOrders"),
    fills: unused("fills"),
    placeStrategy: unused("placeStrategy"),
    cancel: unused("cancel"),
    closeReduceOnly: unused("closeReduceOnly"),
    configureSymbol: unused("configureSymbol"),
  };
}
