import type { AccountState, SymbolSettings } from "../../src/account";
import type { BookSnapshot, FeeSchedule, MarketRules, MarkSnapshot } from "../../src/market";
import { publishedPlanSchema, type PublishedPlan } from "../../src/plan";
import { riskPolicySchema, type RiskPolicy } from "../../src/policy";

export const btcUsdRules: MarketRules = {
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
  marginTiers: [
    {
      maxNotional: "10000",
      maxLeverage: 100,
      maintenanceMarginRate: "0.004",
      maintenanceAmount: "0",
    },
    {
      maxNotional: "50000",
      maxLeverage: 75,
      maintenanceMarginRate: "0.004",
      maintenanceAmount: "0.000",
    },
    {
      maxNotional: "100000",
      maxLeverage: 50,
      maintenanceMarginRate: "0.004",
      maintenanceAmount: "0.000",
    },
    {
      maxNotional: "250000",
      maxLeverage: 40,
      maintenanceMarginRate: "0.004",
      maintenanceAmount: "0.000",
    },
    {
      maxNotional: "300000",
      maxLeverage: 25,
      maintenanceMarginRate: "0.004",
      maintenanceAmount: "0.000",
    },
    {
      maxNotional: "800000",
      maxLeverage: 25,
      maintenanceMarginRate: "0.005",
      maintenanceAmount: "300.000",
    },
    {
      maxNotional: "1000000",
      maxLeverage: 25,
      maintenanceMarginRate: "0.0065",
      maintenanceAmount: "1500.0000",
    },
    {
      maxNotional: "2500000",
      maxLeverage: 20,
      maintenanceMarginRate: "0.0065",
      maintenanceAmount: "1500.0000",
    },
    {
      maxNotional: "3000000",
      maxLeverage: 10,
      maintenanceMarginRate: "0.0065",
      maintenanceAmount: "1500.0000",
    },
    {
      maxNotional: "10000000",
      maxLeverage: 10,
      maintenanceMarginRate: "0.01",
      maintenanceAmount: "12000.0000",
    },
    {
      maxNotional: "12000000",
      maxLeverage: 5,
      maintenanceMarginRate: "0.01",
      maintenanceAmount: "12000.0000",
    },
    {
      maxNotional: "25000000",
      maxLeverage: 5,
      maintenanceMarginRate: "0.02",
      maintenanceAmount: "132000.0000",
    },
    {
      maxNotional: "70000000",
      maxLeverage: 1,
      maintenanceMarginRate: "0.02",
      maintenanceAmount: "132000.0000",
    },
    {
      maxNotional: "100000000",
      maxLeverage: 1,
      maintenanceMarginRate: "0.025",
      maintenanceAmount: "482000.0000",
    },
  ],
};

export const capturedHourlyFundingRate = "-0.0000429115734291358";

export const fixtureNow = Date.parse("2026-10-23T12:00:00Z");

const hourMs = 3_600_000;

export const bookAround = (
  bid: string,
  ask: string,
  size: string,
  observedAt: number,
): BookSnapshot => ({
  symbol: "BTC-USD",
  bids: [[bid, size]],
  asks: [[ask, size]],
  exchangeTime: observedAt,
  observedAt,
});

export const markAt = (
  price: string,
  observedAt: number,
  hourlyFundingRate: string,
): MarkSnapshot => ({
  symbol: "BTC-USD",
  markPrice: price,
  indexPrice: price,
  hourlyFundingRate,
  nextFundingTime: (Math.floor(observedAt / hourMs) + 1) * hourMs,
  exchangeTime: observedAt,
  observedAt,
});

export const isolatedSettings = (leverage: number): SymbolSettings => ({
  symbol: "BTC-USD",
  marginMode: "isolated",
  leverage,
});

export const accountWith = (balance: string, observedAt: number): AccountState => ({
  account: {
    accountId: "fixture-subaccount",
    environment: "live",
    availableBalance: balance,
    observedAt,
  },
  positions: [],
  openOrders: [],
  symbolSettings: isolatedSettings(5),
});

export const defaultPolicy: RiskPolicy = riskPolicySchema.parse({
  version: 1,
  perTradeBudget: "20",
  aggregateBudget: "60",
  sessionBudget: "40",
  leverageCap: 5,
  maxEntrySlippageBps: 20,
  stopSlippageReserveBps: 50,
  fundingHorizonHours: 24,
  minRewardRisk: "1.5",
  liquidationBufferBps: 100,
  allowedMarkets: ["BTC-USD"],
});

export const takerFees: FeeSchedule = { takerRate: "0.0005", makerRate: "-0.00005" };

export const longPlan: PublishedPlan = publishedPlanSchema.parse({
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "Reclaim of the weekly open.",
  environment: "live",
});

export const shortPlan: PublishedPlan = publishedPlanSchema.parse({
  ...longPlan,
  direction: "short",
  stopPrice: "85200",
  targetPrice: "81600",
});
