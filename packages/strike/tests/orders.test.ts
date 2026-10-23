import { publishedPlanSchema, type Proposal } from "@cadence/core";
import { describe, expect, it } from "vitest";
import type { StrategyOrder } from "../src/client";
import { reduceOnlyCloseBody, strategyRequestBody, toStrategyOrder } from "../src/orders";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";

const longPlan = publishedPlanSchema.parse({
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "",
  environment: "live",
});

const proposal: Proposal = {
  quantity: "0.01403",
  limitPrice: "84268",
  notional: "1182.28",
  priceLoss: "16.08",
  costs: {
    entryFee: "0.59",
    exitFee: "0.58",
    stopSlippageReserve: "0.58",
    fundingReserve: "1.22",
    curatorFee: "0",
  },
  plannedLoss: "19.05",
  rewardRiskNet: "1.98",
  leverage: 5,
  initialMargin: "236.46",
  estimatedLiquidationPrice: "67749",
  admissibleBudget: "20",
  limitedBy: "budget",
  curatorFee: null,
};

const longOrder: StrategyOrder = toStrategyOrder({ intentId, plan: longPlan, proposal });

describe("toStrategyOrder", () => {
  it("derives every identifier from the intent and its role", () => {
    expect(longOrder).toEqual({
      strategyId: `cad-${intentId}`,
      entryClientOrderId: `cad-${intentId}-e`,
      stopClientOrderId: `cad-${intentId}-s`,
      targetClientOrderId: `cad-${intentId}-t`,
      symbol: "BTC-USD",
      side: "buy",
      size: "0.01403",
      limitPrice: "84268",
      stopPrice: "83200",
      targetPrice: "86800",
    });
  });

  it("sells to enter a short", () => {
    const shortPlan = publishedPlanSchema.parse({
      ...longPlan,
      direction: "short",
      stopPrice: "85200",
      targetPrice: "81600",
    });
    expect(toStrategyOrder({ intentId, plan: shortPlan, proposal }).side).toBe("sell");
  });
});

describe("strategyRequestBody", () => {
  it("builds a bounded FOK limit entry with native mark-price exits sized to the entry", () => {
    expect(strategyRequestBody(longOrder)).toEqual({
      strategy_id: `cad-${intentId}`,
      client_order_id: `cad-${intentId}-e`,
      symbol: "BTC-USD",
      side: "buy",
      type: "limit",
      size: "0.01403",
      price: "84268",
      time_in_force: "FOK",
      tp_order: {
        client_order_id: `cad-${intentId}-t`,
        type: "take_profit",
        size: "0.01403",
        stop_price: "86800",
        working_type: "mark_price",
      },
      sl_order: {
        client_order_id: `cad-${intentId}-s`,
        type: "stop",
        size: "0.01403",
        stop_price: "83200",
        working_type: "mark_price",
      },
    });
  });

  it("never names a sub-account, so a sub-account key acts only on its own account", () => {
    expect(JSON.stringify(strategyRequestBody(longOrder))).not.toContain("sub_account_id");
  });

  it.each([
    ["a buy whose stop is not below the entry", { stopPrice: "84268" }],
    ["a buy whose target is not above the entry", { targetPrice: "84000" }],
    ["a sell whose stop is not above the entry", { side: "sell" as const }],
  ])("refuses %s before anything is sent", (_label, change) => {
    expect(() => strategyRequestBody({ ...longOrder, ...change })).toThrow(
      "The exits are on the wrong side of the entry",
    );
  });

  it("accepts a correctly shaped short", () => {
    const shortOrder: StrategyOrder = {
      ...longOrder,
      side: "sell",
      stopPrice: "85200",
      targetPrice: "81600",
    };
    expect(strategyRequestBody(shortOrder)).toMatchObject({
      side: "sell",
      sl_order: { stop_price: "85200" },
      tp_order: { stop_price: "81600" },
    });
  });
});

describe("reduceOnlyCloseBody", () => {
  it("closes with a reduce-only market order that can never add exposure", () => {
    expect(
      reduceOnlyCloseBody({
        clientOrderId: `cad-${intentId}-r`,
        symbol: "BTC-USD",
        side: "sell",
        size: "0.01403",
      }),
    ).toEqual({
      client_order_id: `cad-${intentId}-r`,
      symbol: "BTC-USD",
      side: "sell",
      type: "market",
      size: "0.01403",
      reduce_only: true,
    });
  });
});
