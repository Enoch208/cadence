import type { DecimalString, FeeSchedule, MarginTier, MarketRules } from "@cadence/core";

export const replayScenarioNames = [
  "happy_path",
  "late_entry",
  "stale_data",
  "ambiguous_response",
  "exits_missing",
] as const;
export type ReplayScenarioName = (typeof replayScenarioNames)[number];

export type ReplayBehaviour = {
  loseFirstStrategyResponse: boolean;
  omitExitLegs: boolean;
};

export type ReplayScenario = {
  name: ReplayScenarioName;
  market: MarketRules;
  bid: DecimalString;
  ask: DecimalString;
  depthSize: DecimalString;
  markPrice: DecimalString;
  hourlyFundingRate: DecimalString;
  marketDataAgeMs: number;
  availableBalance: DecimalString;
  leverage: number;
  behaviour: ReplayBehaviour;
};

const tier = (
  maxNotional: string,
  maxLeverage: number,
  maintenanceMarginRate: string,
  maintenanceAmount: string,
): MarginTier => ({ maxNotional, maxLeverage, maintenanceMarginRate, maintenanceAmount });

export const capturedBtcUsdRules: MarketRules = {
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
    tier("10000", 100, "0.004", "0"),
    tier("50000", 75, "0.004", "0.000"),
    tier("100000", 50, "0.004", "0.000"),
    tier("250000", 40, "0.004", "0.000"),
    tier("300000", 25, "0.004", "0.000"),
    tier("800000", 25, "0.005", "300.000"),
    tier("1000000", 25, "0.0065", "1500.0000"),
    tier("2500000", 20, "0.0065", "1500.0000"),
    tier("3000000", 10, "0.0065", "1500.0000"),
    tier("10000000", 10, "0.01", "12000.0000"),
    tier("12000000", 5, "0.01", "12000.0000"),
    tier("25000000", 5, "0.02", "132000.0000"),
    tier("70000000", 1, "0.02", "132000.0000"),
    tier("100000000", 1, "0.025", "482000.0000"),
  ],
};

export const capturedTierZeroFees: FeeSchedule = { takerRate: "0.0005", makerRate: "-0.00005" };

const happyPath: ReplayScenario = {
  name: "happy_path",
  market: capturedBtcUsdRules,
  bid: "84040",
  ask: "84050",
  depthSize: "0.5",
  markPrice: "84045",
  hourlyFundingRate: "-0.0000429115734291358",
  marketDataAgeMs: 250,
  availableBalance: "250",
  leverage: 5,
  behaviour: { loseFirstStrategyResponse: false, omitExitLegs: false },
};

export const replayScenarios: Record<ReplayScenarioName, ReplayScenario> = {
  happy_path: happyPath,
  late_entry: { ...happyPath, name: "late_entry", bid: "85140", ask: "85150", markPrice: "85145" },
  stale_data: { ...happyPath, name: "stale_data", marketDataAgeMs: 10_000 },
  ambiguous_response: {
    ...happyPath,
    name: "ambiguous_response",
    behaviour: { loseFirstStrategyResponse: true, omitExitLegs: false },
  },
  exits_missing: {
    ...happyPath,
    name: "exits_missing",
    behaviour: { loseFirstStrategyResponse: false, omitExitLegs: true },
  },
};
