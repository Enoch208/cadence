import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { toMarketRules } from "../src/normalize";
import { createReplayStrikeClient } from "../src/replay-client";
import { replayScenarioNames, replayScenarios } from "../src/replay-scenarios";
import { fixture } from "./support/fixtures";

const sourceOf = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

describe("replay scenarios", () => {
  it("run on the BTC-USD rules exactly as Strike published them", () => {
    const captured = toMarketRules(fixture("mainnet-get-v2-markets.json")).find(
      (market) => market.symbol === "BTC-USD",
    );
    for (const name of replayScenarioNames) {
      expect(replayScenarios[name].market).toEqual(captured);
      expect(replayScenarios[name].name).toBe(name);
    }
  });

  it("differ from the happy path only where their names say", () => {
    const { happy_path, late_entry, stale_data, ambiguous_response, exits_missing } =
      replayScenarios;
    expect(late_entry).toEqual({
      ...happy_path,
      name: "late_entry",
      bid: "85140",
      ask: "85150",
      markPrice: "85145",
    });
    expect(stale_data).toEqual({ ...happy_path, name: "stale_data", marketDataAgeMs: 10_000 });
    expect(ambiguous_response).toEqual({
      ...happy_path,
      name: "ambiguous_response",
      behaviour: { loseFirstStrategyResponse: true, omitExitLegs: false },
    });
    expect(exits_missing).toEqual({
      ...happy_path,
      name: "exits_missing",
      behaviour: { loseFirstStrategyResponse: false, omitExitLegs: true },
    });
  });
});

describe("the replay client cannot reach Strike", () => {
  it("accepts no credentials: only a scenario and a clock", () => {
    expect(createReplayStrikeClient.length).toBe(2);
  });

  it("never calls fetch through a whole lifecycle", async () => {
    const forbidden = vi.fn(() => Promise.reject(new Error("replay must not touch the network")));
    vi.stubGlobal("fetch", forbidden);
    try {
      const client = createReplayStrikeClient(replayScenarios.happy_path, () => 1);
      expect(client.environment).toBe("replay");
      await client.serverTime();
      await client.markets();
      await client.book("BTC-USD", 20);
      await client.mark("BTC-USD");
      await client.fees();
      await client.configureSymbol("BTC-USD", { marginMode: "isolated", leverage: 5 });
      await client.placeStrategy({
        strategyId: "cad-x",
        entryClientOrderId: "cad-x-e",
        stopClientOrderId: "cad-x-s",
        targetClientOrderId: "cad-x-t",
        symbol: "BTC-USD",
        side: "buy",
        size: "0.01",
        limitPrice: "84218",
        stopPrice: "83200",
        targetPrice: "86800",
        builderFeeBps: 5,
      });
      await client.order("BTC-USD", "cad-x-e");
      await client.openOrders(null);
      await client.fills("BTC-USD", 0);
      await client.accountState("BTC-USD");
      await client.cancel("BTC-USD", "cad-x-t");
      await client.closeReduceOnly({
        clientOrderId: "cad-x-r",
        symbol: "BTC-USD",
        side: "sell",
        size: "0.01",
      });
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "replay-client.ts",
    "replay-exchange.ts",
    "replay-ledger.ts",
    "replay-rules.ts",
    "replay-scenarios.ts",
  ])("has no path to a signer, a transport or fetch in %s", (file) => {
    const source = sourceOf(file);
    expect(source).not.toMatch(
      /from "\.\/(signer|transport|live-client|live-account|live-requests|clock|credentials)"/,
    );
    expect(source).not.toMatch(/\bfetch\b/);
    expect(source).not.toMatch(/node:(http|https|net|tls)/);
  });
});
