import { describe, expect, it } from "vitest";
import type { DecisionInput } from "../src/decision";
import { decide } from "../src/decide";
import { publishedPlanSchema } from "../src/plan";
import {
  bookAround,
  btcUsdRules,
  capturedHourlyFundingRate,
  fixtureNow,
  longPlan,
  markAt,
} from "./fixtures/btc-usd";
import {
  blocked,
  longInput,
  openPosition,
  outcomeOf,
  ready,
  restingOrder,
  shortInput,
  withLongQuote,
} from "./fixtures/decision";

const base = longInput();

describe("stage 4: the entry range", () => {
  it.each(["84401", "83999"])("blocks a long whose ask is %s", (ask) => {
    expect(outcomeOf(withLongQuote(ask))).toEqual(blocked("OUTSIDE_ENTRY_RANGE"));
  });

  it("blocks a long when nobody is offering", () => {
    expect(outcomeOf({ ...base, book: { ...base.book, asks: [] } })).toEqual(
      blocked("OUTSIDE_ENTRY_RANGE"),
    );
  });

  it("blocks a short whose bid has fallen below the range", () => {
    const short = shortInput();
    expect(outcomeOf({ ...short, book: bookAround("83999", "84000", "0.5", fixtureNow) })).toEqual(
      blocked("OUTSIDE_ENTRY_RANGE"),
    );
  });

  it("declines the same plan in plain stages as a member arrives later", () => {
    expect(outcomeOf(withLongQuote("84000"))).toEqual(ready);
    expect(outcomeOf(withLongQuote("84300"))).toEqual(blocked("RR_BELOW_POLICY"));
    expect(outcomeOf(withLongQuote("84401"))).toEqual(blocked("OUTSIDE_ENTRY_RANGE"));
  });
});

describe("stage 5: exposure Cadence does not recognize", () => {
  const exposureWith = (busySymbols: string[], knownClientOrderIds: string[] = []) => ({
    ...base.exposure,
    busySymbols,
    knownClientOrderIds,
  });
  const holding = (positions: DecisionInput["accountState"]["positions"]) => ({
    ...base,
    accountState: { ...base.accountState, positions },
  });

  it("blocks a market Cadence already has a plan open on", () => {
    expect(outcomeOf({ ...base, exposure: exposureWith(["BTC-USD"]) })).toEqual(
      blocked("SYMBOL_BUSY"),
    );
  });

  it.each(["0.001", "-0.001"])("blocks an unrecognized position of %s", (size) => {
    expect(outcomeOf(holding([openPosition("BTC-USD", size)]))).toEqual(
      blocked("UNKNOWN_EXPOSURE"),
    );
  });

  it("blocks an unrecognized position on another market", () => {
    expect(outcomeOf(holding([openPosition("ETH-USD", "0.5")]))).toEqual(
      blocked("UNKNOWN_EXPOSURE"),
    );
  });

  it("ignores a flat position and a position Cadence holds on another market", () => {
    expect(outcomeOf(holding([openPosition("BTC-USD", "0.00000")]))).toEqual(ready);
    expect(
      outcomeOf({
        ...holding([openPosition("ETH-USD", "0.5")]),
        exposure: exposureWith(["ETH-USD"]),
      }),
    ).toEqual(ready);
  });

  it("blocks an open order Cadence did not place, but not one it did", () => {
    const withOrder = (known: string[]) => ({
      ...base,
      accountState: { ...base.accountState, openOrders: [restingOrder("manual-1")] },
      exposure: exposureWith([], known),
    });
    expect(outcomeOf(withOrder([]))).toEqual(blocked("UNKNOWN_EXPOSURE"));
    expect(outcomeOf(withOrder(["manual-1"]))).toEqual(ready);
  });

  it("reports a busy market and a stray order together", () => {
    expect(
      outcomeOf({
        ...base,
        accountState: { ...base.accountState, openOrders: [restingOrder("manual-1")] },
        exposure: exposureWith(["BTC-USD"]),
      }),
    ).toEqual(blocked("SYMBOL_BUSY", "UNKNOWN_EXPOSURE"));
  });
});

describe("stage 6: the risk budget", () => {
  it.each([
    ["the aggregate budget is committed", "60", "0"],
    ["the session budget is spent", "0", "40"],
    ["less than a cent remains", "39.999", "0"],
  ])("blocks when %s", (_, committedRisk, realizedSessionLoss) => {
    expect(
      outcomeOf({ ...base, exposure: { ...base.exposure, committedRisk, realizedSessionLoss } }),
    ).toEqual(blocked("RISK_BUDGET_EXHAUSTED"));
  });
});

describe("stage 7: price bounds Strike enforces", () => {
  const planAt = (overrides: Record<string, string>) =>
    publishedPlanSchema.parse({ ...longPlan, ...overrides });

  it("blocks a BTC plan above order_max_price 100000 before it reaches the exchange", () => {
    const decision = decide({
      ...base,
      plan: planAt({
        entryMin: "100100",
        entryMax: "100200",
        stopPrice: "99000",
        targetPrice: "104000",
      }),
      book: bookAround("100149", "100150", "0.5", fixtureNow),
      mark: markAt("100150", fixtureNow, capturedHourlyFundingRate),
    });
    expect(decision.outcome).toBe("BLOCKED");
    expect(decision.reasons).toEqual(["UNSUPPORTED_CAPABILITY"]);
    expect(decision.evidence.bestAsk).toBe("100150");
    expect("proposal" in decision).toBe(false);
  });

  it("blocks a limit more than 5% from the mark", () => {
    expect(
      outcomeOf({ ...base, mark: markAt("80000", fixtureNow, capturedHourlyFundingRate) }),
    ).toEqual(blocked("UNSUPPORTED_CAPABILITY"));
  });

  it("blocks a target Strike could not accept as a trigger price", () => {
    expect(
      outcomeOf({
        ...base,
        plan: planAt({
          entryMin: "99000",
          entryMax: "99500",
          stopPrice: "98000",
          targetPrice: "100500",
        }),
        book: bookAround("99099", "99100", "0.5", fixtureNow),
        mark: markAt("99100", fixtureNow, capturedHourlyFundingRate),
      }),
    ).toEqual(blocked("UNSUPPORTED_CAPABILITY"));
  });

  it("blocks a stop off the tick grid", () => {
    expect(outcomeOf({ ...base, plan: planAt({ stopPrice: "83200.5" }) })).toEqual(
      blocked("UNSUPPORTED_CAPABILITY"),
    );
  });

  it("blocks when no tick inside the range sits at or above the ask", () => {
    expect(
      outcomeOf({
        ...base,
        plan: planAt({ entryMin: "84000.2", entryMax: "84000.8" }),
        book: bookAround("84000.4", "84000.5", "0.5", fixtureNow),
      }),
    ).toEqual(blocked("OUTSIDE_ENTRY_RANGE"));
  });
});

describe("stage order", () => {
  it("reports only the first failing stage", () => {
    const stale = { ...base, book: { ...base.book, observedAt: fixtureNow - 10_000 } };
    expect(
      outcomeOf({ ...stale, admission: { status: "revoked", isCurrentVersion: true } }),
    ).toEqual(blocked("PLAN_REVOKED"));
    expect(outcomeOf({ ...stale, market: { ...btcUsdRules, reduceOnly: true } })).toEqual(
      blocked("UNSUPPORTED_CAPABILITY"),
    );
    expect(
      outcomeOf({
        ...withLongQuote("84401"),
        exposure: { ...base.exposure, busySymbols: ["BTC-USD"] },
      }),
    ).toEqual(blocked("OUTSIDE_ENTRY_RANGE"));
    expect(
      outcomeOf({
        ...base,
        mark: markAt("80000", fixtureNow, capturedHourlyFundingRate),
        exposure: { ...base.exposure, committedRisk: "60" },
      }),
    ).toEqual(blocked("RISK_BUDGET_EXHAUSTED"));
  });
});
