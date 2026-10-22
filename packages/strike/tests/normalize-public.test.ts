import type { MarketRules } from "@cadence/core";
import { describe, expect, it } from "vitest";
import { parseStrikeJson } from "../src/json";
import {
  toBookSnapshot,
  toFeeSchedule,
  toMarketRules,
  toMarkSnapshot,
  toServerTime,
} from "../src/normalize";
import { depthResponseSchema } from "../src/schemas/public";
import { capturedMarkPriceFor, fixture, fixtureText } from "./support/fixtures";

const capturedBtcUsd: MarketRules = {
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
    ["10000", 100, "0.004", "0"],
    ["50000", 75, "0.004", "0.000"],
    ["100000", 50, "0.004", "0.000"],
    ["250000", 40, "0.004", "0.000"],
    ["300000", 25, "0.004", "0.000"],
    ["800000", 25, "0.005", "300.000"],
    ["1000000", 25, "0.0065", "1500.0000"],
    ["2500000", 20, "0.0065", "1500.0000"],
    ["3000000", 10, "0.0065", "1500.0000"],
    ["10000000", 10, "0.01", "12000.0000"],
    ["12000000", 5, "0.01", "12000.0000"],
    ["25000000", 5, "0.02", "132000.0000"],
    ["70000000", 1, "0.02", "132000.0000"],
    ["100000000", 1, "0.025", "482000.0000"],
  ].map(([maxNotional, maxLeverage, maintenanceMarginRate, maintenanceAmount]) => ({
    maxNotional: String(maxNotional),
    maxLeverage: Number(maxLeverage),
    maintenanceMarginRate: String(maintenanceMarginRate),
    maintenanceAmount: String(maintenanceAmount),
  })),
};

const marketsText = fixtureText("mainnet-get-v2-markets.json");
function marketsWithBtc(change: Record<string, unknown>): unknown {
  const parsed = JSON.parse(marketsText) as { markets: Record<string, Record<string, unknown>> };
  parsed.markets["BTC-USD"] = { ...parsed.markets["BTC-USD"], ...change };
  return parseStrikeJson(JSON.stringify(parsed));
}

const ruleFor = (rules: readonly MarketRules[], symbol: string) =>
  rules.find((rule) => rule.symbol === symbol);

describe("toMarketRules", () => {
  const rules = toMarketRules(fixture("mainnet-get-v2-markets.json"));

  it("reads all 32 captured mainnet markets", () => {
    expect(rules).toHaveLength(32);
  });

  it("reads BTC-USD exactly as Strike published it", () => {
    expect(ruleFor(rules, "BTC-USD")).toEqual(capturedBtcUsd);
  });

  it("keeps the status of a market that is not trading yet", () => {
    expect(ruleFor(rules, "DOGE-USD")?.status).toBe("pre_trading");
    expect(rules.filter((rule) => rule.status === "trading")).toHaveLength(31);
  });

  it("accepts the captured BTC-USD entry when nothing is changed", () => {
    expect(() => toMarketRules(marketsWithBtc({}))).not.toThrow();
  });

  it("refuses a price sent as a JSON number", () => {
    expect(() => toMarketRules(marketsWithBtc({ order_tick_price: 1 }))).toThrow();
  });

  it("refuses a market filed under another symbol", () => {
    expect(() => toMarketRules(marketsWithBtc({ symbol: "ETH-USD" }))).toThrow();
  });

  it("refuses a zero tick size, which no price grid can use", () => {
    expect(() => toMarketRules(marketsWithBtc({ order_tick_price: "0" }))).toThrow();
  });
});

describe("toBookSnapshot", () => {
  const book = toBookSnapshot(fixture("mainnet-get-price-v2-depth-BTC-USD.json"), "BTC-USD", 42);

  it("keeps the best levels first, as captured", () => {
    expect(book.bids[0]).toEqual(["84481", "0.01775"]);
    expect(book.asks[0]).toEqual(["84482", "0.01775"]);
    expect(book.bids).toHaveLength(20);
    expect(book.asks).toHaveLength(20);
    expect(book.asks.at(-1)).toEqual(["84606", "0.13777"]);
  });

  it("stamps the snapshot time and the local observation time", () => {
    expect(book.symbol).toBe("BTC-USD");
    expect(book.exchangeTime).toBe(1792603883913);
    expect(book.observedAt).toBe(42);
  });

  it("parses lastUpdateId as a string, even beyond the safe integer range", () => {
    const compact = JSON.stringify(
      JSON.parse(fixtureText("mainnet-get-price-v2-depth-BTC-USD.json")),
    );
    const text = compact.replace(
      '"lastUpdateId":1604521123',
      '"lastUpdateId":18446744073709551615',
    );
    expect(text).not.toBe(compact);
    expect(depthResponseSchema.parse(parseStrikeJson(text)).lastUpdateId).toBe(
      "18446744073709551615",
    );
  });

  it("accepts the empty book Strike returns for an unknown symbol", () => {
    const empty = toBookSnapshot(
      parseStrikeJson('{"lastUpdateId":0,"E":1,"T":1,"bids":[],"asks":[]}'),
      "NOPE-USD",
      1,
    );
    expect(empty.bids).toEqual([]);
    expect(empty.asks).toEqual([]);
  });

  it.each([
    ["bids out of order", '"bids":[["84479","1"],["84481","1"]],"asks":[["84482","1"]]'],
    ["asks out of order", '"bids":[["84481","1"]],"asks":[["84484","1"],["84482","1"]]'],
    ["a crossed book", '"bids":[["84483","1"]],"asks":[["84482","1"]]'],
    ["a numeric size", '"bids":[["84481",1]],"asks":[["84482","1"]]'],
  ])("refuses %s", (_label, levels) => {
    const text = `{"lastUpdateId":1,"E":1,"T":1,${levels}}`;
    expect(() => toBookSnapshot(parseStrikeJson(text), "BTC-USD", 1)).toThrow();
  });
});

describe("toMarkSnapshot", () => {
  it("maps p, i, r, E and T from the captured BTC-USD update", () => {
    expect(toMarkSnapshot(capturedMarkPriceFor("BTC-USD"), 7)).toEqual({
      symbol: "BTC-USD",
      markPrice: "84491",
      indexPrice: "84505.51926278",
      hourlyFundingRate: "-0.0000429115734291358",
      nextFundingTime: 1792605600000,
      exchangeTime: 1792603883232,
      observedAt: 7,
    });
  });

  it("reads r as the same hourly funding rate premiumIndex and markets report", () => {
    const premium: unknown = JSON.parse(fixtureText("mainnet-get-price-v2-premiumIndex.json"));
    const markets: unknown = JSON.parse(marketsText);
    expect(premium).toContainEqual(
      expect.objectContaining({ symbol: "BTC-USD", fundingRate: "-0.0000429115734291358" }),
    );
    expect(markets).toMatchObject({
      markets: { "BTC-USD": { funding_rate: "-0.0000429115734291358" } },
    });
    expect(toMarkSnapshot(capturedMarkPriceFor("BTC-USD"), 0).hourlyFundingRate).toBe(
      "-0.0000429115734291358",
    );
  });
});

describe("toFeeSchedule", () => {
  const tiers = fixture("mainnet-get-v2-fee-tiers.json");

  it("reads tier 0 by default with the maker rebate as a negative rate", () => {
    expect(toFeeSchedule(tiers)).toEqual({ takerRate: "0.0005", makerRate: "-0.00005" });
  });

  it("reads another tier on request", () => {
    expect(toFeeSchedule(tiers, 6)).toEqual({ takerRate: "0.00028", makerRate: "-0.00005" });
  });

  it("refuses a tier Strike does not publish", () => {
    expect(() => toFeeSchedule(tiers, 7)).toThrow("Strike publishes no fee tier 7");
  });
});

describe("toServerTime", () => {
  it("reads the captured server time in milliseconds", () => {
    expect(toServerTime(fixture("mainnet-get-v2-time.json"))).toBe(1792603881365);
  });
});
