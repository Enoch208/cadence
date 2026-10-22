import { describe, expect, it } from "vitest";
import type { ExchangeFill, ExchangeOrderSnapshot } from "../src/account";
import type { IntentState, OrderSide } from "../src/contract";
import { decide } from "../src/decide";
import { planVersionDigest } from "../src/digest";
import { clientOrderIdFor } from "../src/identity";
import { buildReceipt, type ReceiptInput } from "../src/receipt";
import { fixtureNow, longPlan, shortPlan } from "./fixtures/btc-usd";
import { longInput, restingOrder } from "./fixtures/decision";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";
const readyDecision = decide(longInput());

const fill = (
  fillId: string,
  side: OrderSide,
  price: string,
  size: string,
  fee: string,
): ExchangeFill => ({
  fillId,
  orderId: `order-${fillId}`,
  clientOrderId: clientOrderIdFor(intentId, side === "buy" ? "entry" : "target"),
  symbol: "BTC-USD",
  side,
  price,
  size,
  fee,
  filledAt: fixtureNow,
});

const entryOrder: ExchangeOrderSnapshot = {
  ...restingOrder(clientOrderIdFor(intentId, "entry")),
  orderId: "order-entry",
};

const receiptFor = (
  finalState: IntentState,
  fills: readonly ExchangeFill[],
  overrides: Partial<ReceiptInput> = {},
) =>
  buildReceipt({
    intentId,
    planPublicId: "p-7Kq2",
    planVersion: 2,
    planDigest: planVersionDigest(longPlan),
    plan: longPlan,
    policyVersion: 3,
    decision: readyDecision,
    finalState,
    orders: [entryOrder],
    fills,
    reconciledAt: fixtureNow + 60_000,
    ...overrides,
  });

const boughtAtEntry = fill("1", "buy", "84212", "0.01666", "0.70148596");

describe("buildReceipt", () => {
  it("ties the receipt to the plan version, policy and approved proposal", () => {
    expect(receiptFor("closed", [boughtAtEntry])).toMatchObject({
      intentId,
      planPublicId: "p-7Kq2",
      planVersion: 2,
      planDigest: planVersionDigest(longPlan),
      policyVersion: 3,
      approved: readyDecision.outcome === "BLOCKED" ? null : readyDecision.proposal,
      state: "closed",
      reconciledAt: fixtureNow + 60_000,
    });
  });

  it("has no entry and names the missing entry fills when nothing filled", () => {
    const receipt = receiptFor("open_verifying", []);
    expect(receipt.entry).toBeNull();
    expect(receipt.exit).toBeNull();
    expect(receipt.realizedPnl).toBeNull();
    expect(receipt.feesPaid).toBe("0");
    expect(receipt.incomplete).toContain("entry fills");
  });

  it.each(["unfilled", "rejected", "blocked"] as const)(
    "is complete for a %s intent that never filled",
    (finalState) => {
      expect(receiptFor(finalState, []).incomplete).toEqual([]);
    },
  );

  it("leaves realized PnL empty while the position is open", () => {
    const receipt = receiptFor("open_verified", [boughtAtEntry]);
    expect(receipt.entry).toEqual({ size: "0.01666", averagePrice: "84212" });
    expect(receipt.exit).toBeNull();
    expect(receipt.realizedPnl).toBeNull();
    expect(receipt.incomplete).toEqual(["exit fills"]);
  });

  it("realizes a closed long from its fills, net of both fees", () => {
    const receipt = receiptFor("closed", [
      boughtAtEntry,
      fill("2", "sell", "86800", "0.01666", "0.723044"),
    ]);
    expect(receipt.exit).toEqual({ size: "0.01666", averagePrice: "86800" });
    expect(receipt.feesPaid).toBe("1.42452996");
    expect(receipt.realizedPnl).toBe("41.69155004");
    expect(receipt.incomplete).toEqual([]);
  });

  it("uses the fill at the stop, never the plan's target", () => {
    const receipt = receiptFor("closed", [
      boughtAtEntry,
      fill("2", "sell", "83190", "0.01666", "0.6929727"),
    ]);
    expect(receipt.realizedPnl).toBe("-18.42097866");
    expect(JSON.stringify(receipt)).not.toContain(longPlan.targetPrice);
  });

  it("does not realize a partial exit, even one at the target", () => {
    const receipt = receiptFor("open_verified", [
      boughtAtEntry,
      fill("2", "sell", "86800", "0.01", "0.434"),
    ]);
    expect(receipt.exit).toEqual({ size: "0.01", averagePrice: "86800" });
    expect(receipt.realizedPnl).toBeNull();
    expect(receipt.incomplete).toEqual(["exit fills"]);
  });

  it("averages several entry fills by size", () => {
    const receipt = receiptFor("open_verified", [
      fill("1", "buy", "84200", "0.01", "0.421"),
      fill("3", "buy", "84231", "0.00666", "0.28050"),
    ]);
    expect(receipt.entry).toEqual({ size: "0.01666", averagePrice: "84212.39255702" });
  });

  it("realizes a closed short from a sell entry and a buy exit", () => {
    const receipt = receiptFor(
      "closed",
      [fill("1", "sell", "84300", "0.01", "0.4215"), fill("2", "buy", "81600", "0.01", "0.408")],
      { plan: shortPlan, planDigest: planVersionDigest(shortPlan) },
    );
    expect(receipt.entry).toEqual({ size: "0.01", averagePrice: "84300" });
    expect(receipt.realizedPnl).toBe("26.1705");
  });

  it("flags fills that close more than the entry opened", () => {
    const receipt = receiptFor("closed", [
      boughtAtEntry,
      fill("2", "sell", "86800", "0.02", "0.868"),
    ]);
    expect(receipt.realizedPnl).toBeNull();
    expect(receipt.incomplete).toEqual(["exit fills exceed the entry"]);
  });

  it("flags a plan whose digest does not match the version it claims", () => {
    expect(receiptFor("unfilled", [], { planDigest: "0".repeat(64) }).incomplete).toEqual([
      "plan digest",
    ]);
  });

  it("lists every Strike order ID once, from the orders and the fills", () => {
    const receipt = receiptFor("closed", [
      boughtAtEntry,
      fill("2", "sell", "86800", "0.01666", "0.723044"),
    ]);
    expect(receipt.exchangeOrderIds).toEqual(["order-entry", "order-1", "order-2"]);
  });

  it("records no approved proposal for a blocked decision", () => {
    const blocked = decide({ ...longInput(), accountReconciled: false });
    expect(receiptFor("blocked", [], { decision: blocked }).approved).toBeNull();
  });
});
