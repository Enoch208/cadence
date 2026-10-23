import {
  decide,
  publishedPlanSchema,
  riskPolicySchema,
  type Decision,
  type ReasonCode,
} from "@cadence/core";
import { describe, expect, it } from "vitest";
import { toStrategyOrder } from "../src/orders";
import { createReplayStrikeClient } from "../src/replay-client";
import { replayScenarios, type ReplayScenarioName } from "../src/replay-scenarios";

const t0 = 1_792_603_881_365;

const replayPlan = publishedPlanSchema.parse({
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
  environment: "replay",
});

const policy = riskPolicySchema.parse({
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

async function preview(name: ReplayScenarioName) {
  const client = createReplayStrikeClient(replayScenarios[name], () => t0);
  const [accountState, book, mark, markets, fees] = await Promise.all([
    client.accountState("BTC-USD"),
    client.book("BTC-USD", 50),
    client.mark("BTC-USD"),
    client.markets(),
    client.fees(),
  ]);
  const market = markets.find((rules) => rules.symbol === "BTC-USD");
  if (market === undefined) {
    throw new Error("The replay exchange lists no BTC-USD");
  }
  const decision = decide({
    plan: replayPlan,
    admission: { status: "published", isCurrentVersion: true },
    policy,
    quantityCeiling: null,
    accountState,
    accountReconciled: true,
    builderApproval: null,
    exposure: {
      busySymbols: [],
      knownClientOrderIds: [],
      committedRisk: "0",
      realizedSessionLoss: "0",
    },
    market,
    book,
    mark,
    fees,
    now: t0,
  });
  return { client, decision };
}

const reasonsOf = (decision: Decision): readonly ReasonCode[] => decision.reasons;

describe("each replay scenario leads the real engine to the outcome it is named for", () => {
  it.each<ReplayScenarioName>(["happy_path", "ambiguous_response", "exits_missing"])(
    "%s admits the plan, and the proposal fills on the replay exchange",
    async (name) => {
      const { client, decision } = await preview(name);
      expect(decision.outcome).toBe("READY");
      if (decision.outcome === "BLOCKED") {
        throw new Error("Expected a proposal");
      }
      const order = toStrategyOrder({
        intentId: "i-1",
        plan: replayPlan,
        proposal: decision.proposal,
      });
      await client.placeStrategy(order).catch(() => null);
      expect(await client.order("BTC-USD", order.entryClientOrderId)).toMatchObject({
        status: "filled",
        filled: decision.proposal.quantity,
      });
    },
  );

  it("late_entry is declined because the market left the entry range", async () => {
    const { decision } = await preview("late_entry");
    expect(decision.outcome).toBe("BLOCKED");
    expect(reasonsOf(decision)).toEqual(["OUTSIDE_ENTRY_RANGE"]);
  });

  it("stale_data is declined because the market data is too old", async () => {
    const { decision } = await preview("stale_data");
    expect(decision.outcome).toBe("BLOCKED");
    expect(reasonsOf(decision)).toEqual(["STALE_DATA"]);
  });
});
