import { describe, expect, it } from "vitest";
import type { DecisionInput } from "../src/decision";
import { decide } from "../src/decide";
import { riskPolicySchema } from "../src/policy";
import {
  bookAround,
  btcUsdRules,
  capturedHourlyFundingRate,
  defaultPolicy,
  fixtureNow,
  isolatedSettings,
  longPlan,
  markAt,
} from "./fixtures/btc-usd";
import {
  blocked,
  longInput,
  outcomeOf,
  ready,
  shortInput,
  withLongQuote,
} from "./fixtures/decision";

const base = longInput();
const settingsWith = (overrides: Partial<DecisionInput["accountState"]["symbolSettings"]>) => ({
  ...base,
  accountState: {
    ...base.accountState,
    symbolSettings: { ...base.accountState.symbolSettings, ...overrides },
  },
});

describe("a plan that fits the account and the book", () => {
  it("is READY with every value of the proposal derived from the inputs", () => {
    expect(decide(longInput())).toEqual({
      outcome: "READY",
      reasons: [],
      proposal: {
        quantity: "0.01285",
        limitPrice: "84168",
        notional: "1081.56",
        priceLoss: "12.44",
        costs: {
          entryFee: "0.55",
          exitFee: "0.54",
          stopSlippageReserve: "5.35",
          fundingReserve: "1.12",
          curatorFee: "0.00",
        },
        plannedLoss: "20.00",
        rewardRiskNet: "1.63",
        leverage: 5,
        initialMargin: "216.32",
        estimatedLiquidationPrice: "67605",
        admissibleBudget: "20.00",
        limitedBy: "budget",
        curatorFee: null,
      },
      evidence: {
        bestBid: "83999",
        bestAsk: "84000",
        markPrice: "84000",
        accountObservedAt: fixtureNow,
        bookObservedAt: fixtureNow,
        markObservedAt: fixtureNow,
        evaluatedAt: fixtureNow,
      },
    });
  });

  it("is READY for the mirrored short, entered from the bid", () => {
    const decision = decide(shortInput());
    expect(decision).toMatchObject({
      outcome: "READY",
      proposal: {
        quantity: "0.01276",
        limitPrice: "84232",
        plannedLoss: "20.00",
        rewardRiskNet: "1.62",
        estimatedLiquidationPrice: "100675",
        limitedBy: "budget",
      },
    });
  });
});

describe("stage 1: the plan itself", () => {
  it("blocks a revoked plan", () => {
    expect(
      outcomeOf({ ...base, admission: { status: "revoked", isCurrentVersion: true } }),
    ).toEqual(blocked("PLAN_REVOKED"));
  });

  it("blocks a version the curator has replaced", () => {
    expect(
      outcomeOf({ ...base, admission: { status: "published", isCurrentVersion: false } }),
    ).toEqual(blocked("PLAN_SUPERSEDED"));
  });

  it("blocks from the instant the entry window closes, not a millisecond later", () => {
    const expiry = Date.parse(longPlan.entryExpiresAt);
    const at = (now: number) => ({
      ...withLongQuote("84000"),
      now,
      accountState: {
        ...base.accountState,
        account: { ...base.accountState.account, observedAt: now },
      },
      book: bookAround("83999", "84000", "0.5", now),
      mark: markAt("84000", now, capturedHourlyFundingRate),
    });
    expect(outcomeOf(at(expiry - 1))).toEqual(ready);
    expect(outcomeOf(at(expiry))).toEqual(blocked("PLAN_EXPIRED"));
  });

  it("reports every plan problem at once, in reason-code order", () => {
    expect(
      outcomeOf({
        ...base,
        admission: { status: "revoked", isCurrentVersion: false },
        now: Date.parse(longPlan.entryExpiresAt),
      }),
    ).toEqual(blocked("PLAN_EXPIRED", "PLAN_REVOKED", "PLAN_SUPERSEDED"));
  });
});

describe("stage 2: what Cadence and Strike support", () => {
  const replayAccount = {
    ...base.accountState,
    account: { ...base.accountState.account, environment: "replay" as const },
  };

  it.each<[string, DecisionInput]>([
    ["a replay account for a live plan", { ...base, accountState: replayAccount }],
    [
      "a market the member did not allow",
      {
        ...base,
        policy: riskPolicySchema.parse({ ...defaultPolicy, allowedMarkets: ["ETH-USD"] }),
      },
    ],
    ["a market not open yet", { ...base, market: { ...btcUsdRules, status: "pre_trading" } }],
    ["a market on a break", { ...base, market: { ...btcUsdRules, status: "break" } }],
    ["a market in reduce-only mode", { ...base, market: { ...btcUsdRules, reduceOnly: true } }],
    ["cross margin on the symbol", settingsWith({ marginMode: "cross" })],
    ["leverage above the member's cap", settingsWith({ leverage: 10 })],
    ["no usable leverage", settingsWith({ leverage: 0 })],
    ["rules for another market", { ...base, market: { ...btcUsdRules, symbol: "ETH-USD" } }],
    ["a book for another market", { ...base, book: { ...base.book, symbol: "ETH-USD" } }],
    ["a mark for another market", { ...base, mark: { ...base.mark, symbol: "ETH-USD" } }],
    ["settings for another market", settingsWith({ symbol: "ETH-USD" })],
  ])("blocks %s as unsupported", (_, input) => {
    expect(outcomeOf(input)).toEqual(blocked("UNSUPPORTED_CAPABILITY"));
  });

  it.each([3, 5])("accepts %sx, within the member's cap of 5x", (leverage) => {
    expect(
      outcomeOf({
        ...base,
        accountState: { ...base.accountState, symbolSettings: isolatedSettings(leverage) },
      }),
    ).toEqual(ready);
  });
});

describe("stage 3: freshness and reconciliation", () => {
  const aged = (accountAge: number, bookAge: number, markAge: number): DecisionInput => ({
    ...base,
    accountState: {
      ...base.accountState,
      account: { ...base.accountState.account, observedAt: fixtureNow - accountAge },
    },
    book: { ...base.book, observedAt: fixtureNow - bookAge },
    mark: { ...base.mark, observedAt: fixtureNow - markAge },
  });

  it("accepts an account and book 3 s old and a mark 6 s old", () => {
    expect(outcomeOf(aged(3000, 3000, 6000))).toEqual(ready);
  });

  it.each([
    ["the account", 3001, 0, 0],
    ["the book", 0, 3001, 0],
    ["the mark", 0, 0, 6001],
  ])("blocks when %s is older than allowed", (_, accountAge, bookAge, markAge) => {
    expect(outcomeOf(aged(accountAge, bookAge, markAge))).toEqual(blocked("STALE_DATA"));
  });

  it("blocks an account with unreconciled state, alongside stale data", () => {
    expect(outcomeOf({ ...base, accountReconciled: false })).toEqual(
      blocked("ACCOUNT_UNRECONCILED"),
    );
    expect(outcomeOf({ ...aged(0, 3001, 0), accountReconciled: false })).toEqual(
      blocked("STALE_DATA", "ACCOUNT_UNRECONCILED"),
    );
  });
});
