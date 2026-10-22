import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import type { DecisionInput } from "../src/decision";
import { decide } from "../src/decide";
import type { MarginTier } from "../src/market";
import { publishedPlanSchema } from "../src/plan";
import { riskPolicySchema } from "../src/policy";
import {
  accountWith,
  btcUsdRules,
  defaultPolicy,
  fixtureNow,
  isolatedSettings,
  longPlan,
} from "./fixtures/btc-usd";
import { longInput, outcomeOf, withLongQuote } from "./fixtures/decision";

const base = longInput();

const proposalOf = (input: DecisionInput) => {
  const decision = decide(input);
  if (decision.outcome === "BLOCKED") {
    throw new Error(`Expected a proposal, got ${decision.reasons.join(", ")}`);
  }
  return { outcome: decision.outcome, reasons: decision.reasons, ...decision.proposal };
};

const withBalance = (balance: string): DecisionInput => ({
  ...base,
  accountState: accountWith(balance, fixtureNow),
});

const withTiers = (marginTiers: readonly MarginTier[]): DecisionInput => ({
  ...base,
  market: { ...btcUsdRules, marginTiers },
});

const tier = (maxNotional: string, maxLeverage: number): MarginTier => ({
  maxNotional,
  maxLeverage,
  maintenanceMarginRate: "0.004",
  maintenanceAmount: "0",
});

const withBudget = (perTradeBudget: string): DecisionInput => ({
  ...base,
  policy: riskPolicySchema.parse({ ...defaultPolicy, perTradeBudget }),
});

describe("stage 8: the quantity", () => {
  it("sizes on the 0.00001 lot and keeps the planned loss within the $20 budget", () => {
    const perUnitTotal = "1554.3667514972040483456";
    const quantity = new Decimal(proposalOf(base).quantity);
    expect(quantity.modulo("0.00001").isZero()).toBe(true);
    expect(new Decimal(proposalOf(base).plannedLoss).lessThanOrEqualTo("20")).toBe(true);
    expect(quantity.times(perUnitTotal).lessThanOrEqualTo("20")).toBe(true);
    expect(quantity.plus("0.00002").times(perUnitTotal).greaterThan("20")).toBe(true);
  });

  it("finds the largest lot whose cent-rounded reserve fits, among millions of lots", () => {
    const tightStop = publishedPlanSchema.parse({ ...longPlan, stopPrice: "83999" });
    const proposal = proposalOf({
      ...withLongQuote("84000", "100"),
      plan: tightStop,
      policy: riskPolicySchema.parse({
        ...defaultPolicy,
        maxEntrySlippageBps: 0,
        stopSlippageReserveBps: 0,
      }),
      accountState: accountWith("100000000", fixtureNow),
      fees: { takerRate: "0", makerRate: "0" },
      mark: { ...withLongQuote("84000").mark, hourlyFundingRate: "0.0000001" },
    });
    expect(proposal).toMatchObject({
      quantity: "16.64000",
      plannedLoss: "20.00",
      limitedBy: "budget",
    });
  });

  it("is READY at the member's own quantity ceiling", () => {
    expect(proposalOf({ ...base, quantityCeiling: "0.005" })).toMatchObject({
      outcome: "READY",
      reasons: [],
      quantity: "0.00500",
      limitedBy: "ceiling",
    });
  });

  it("credits the budget when the ceiling ties it", () => {
    expect(proposalOf({ ...base, quantityCeiling: "0.012859" })).toMatchObject({
      quantity: "0.01285",
      limitedBy: "budget",
    });
  });
});

describe("stage 10: a smaller size than the budget allows", () => {
  it("resizes to the depth resting within the limit", () => {
    expect(proposalOf(withLongQuote("84000", "0.005"))).toMatchObject({
      outcome: "RESIZED",
      reasons: ["INSUFFICIENT_DEPTH"],
      quantity: "0.00500",
      plannedLoss: "7.79",
      limitedBy: "depth",
    });
  });

  it("resizes to what the available balance can margin", () => {
    expect(proposalOf(withBalance("100"))).toMatchObject({
      outcome: "RESIZED",
      reasons: ["INSUFFICIENT_MARGIN"],
      quantity: "0.00592",
      initialMargin: "99.66",
      limitedBy: "margin",
    });
  });

  it("resizes to the widest margin tier that allows the leverage", () => {
    expect(proposalOf(withTiers([tier("500", 5), tier("100000", 2)]))).toMatchObject({
      outcome: "RESIZED",
      reasons: ["INSUFFICIENT_MARGIN"],
      quantity: "0.00594",
      limitedBy: "leverage_tier",
    });
  });

  it("resizes to the market's largest limit order", () => {
    expect(
      proposalOf({ ...base, market: { ...btcUsdRules, limitMaxSize: "0.002" } }),
    ).toMatchObject({
      outcome: "RESIZED",
      reasons: ["UNSUPPORTED_CAPABILITY"],
      quantity: "0.00200",
      limitedBy: "max_order_size",
    });
  });
});

describe("stage 9: a size Strike or the policy cannot accept", () => {
  it("never rounds up to the $10 minimum notional when the budget is too small", () => {
    expect(outcomeOf(withBudget("0.1"))).toEqual({
      outcome: "BLOCKED",
      reasons: ["BELOW_MARKET_MINIMUM"],
    });
  });

  it("blocks a ceiling below the smallest lot", () => {
    expect(outcomeOf({ ...base, quantityCeiling: "0.000001" })).toEqual({
      outcome: "BLOCKED",
      reasons: ["BELOW_MARKET_MINIMUM"],
    });
  });

  it("blocks for depth when the book is too thin for the minimum", () => {
    expect(outcomeOf(withLongQuote("84000", "0.0001"))).toEqual({
      outcome: "BLOCKED",
      reasons: ["INSUFFICIENT_DEPTH"],
    });
  });

  it("blocks for margin when the balance cannot carry the minimum", () => {
    expect(outcomeOf(withBalance("1"))).toEqual({
      outcome: "BLOCKED",
      reasons: ["INSUFFICIENT_MARGIN"],
    });
    expect(outcomeOf(withTiers([tier("5", 5)]))).toEqual({
      outcome: "BLOCKED",
      reasons: ["INSUFFICIENT_MARGIN"],
    });
  });

  it("blocks when liquidation would come before the stop", () => {
    const wideStop = publishedPlanSchema.parse({
      ...longPlan,
      stopPrice: "80000",
      targetPrice: "95000",
    });
    const at = (leverage: number): DecisionInput => ({
      ...base,
      plan: wideStop,
      policy: riskPolicySchema.parse({ ...defaultPolicy, leverageCap: 20 }),
      accountState: { ...base.accountState, symbolSettings: isolatedSettings(leverage) },
    });
    expect(outcomeOf(at(20))).toEqual({
      outcome: "BLOCKED",
      reasons: ["LIQUIDATION_BUFFER_FAILED"],
    });
    expect(outcomeOf(at(5))).toEqual({ outcome: "READY", reasons: [] });
  });

  it("blocks a late entry whose reward to risk after costs falls below policy", () => {
    expect(outcomeOf(withLongQuote("84300"))).toEqual({
      outcome: "BLOCKED",
      reasons: ["RR_BELOW_POLICY"],
    });
  });

  it("reports every sizing problem at once, in reason-code order", () => {
    expect(
      outcomeOf({
        ...withLongQuote("84300"),
        policy: riskPolicySchema.parse({ ...defaultPolicy, perTradeBudget: "0.1" }),
      }),
    ).toEqual({ outcome: "BLOCKED", reasons: ["BELOW_MARKET_MINIMUM", "RR_BELOW_POLICY"] });
  });
});
