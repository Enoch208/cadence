import { curatorFeeCharge } from "@cadence/core";
import { describe, expect, it } from "vitest";
import type { StrategyOrder } from "../src/client";
import { StrikeAmbiguousError, StrikeRejectedError } from "../src/errors";
import { addDecimal, subtractDecimal } from "../src/exact";
import { createReplayStrikeClient } from "../src/replay-client";
import { replayScenarios, type ReplayScenario } from "../src/replay-scenarios";

const t0 = 1_792_603_881_365;

function replay(scenario: ReplayScenario = replayScenarios.happy_path) {
  let now = t0;
  const client = createReplayStrikeClient(scenario, () => now);
  return {
    client,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const entry = (intent: string, change: Partial<StrategyOrder> = {}): StrategyOrder => ({
  strategyId: `cad-${intent}`,
  entryClientOrderId: `cad-${intent}-e`,
  stopClientOrderId: `cad-${intent}-s`,
  targetClientOrderId: `cad-${intent}-t`,
  symbol: "BTC-USD",
  side: "buy",
  size: "0.01",
  limitPrice: "84218",
  stopPrice: "83200",
  targetPrice: "86800",
  builderFeeBps: null,
  ...change,
});

describe("a fillable FOK entry", () => {
  it("fills at the ask and arms both exits for the strategy", async () => {
    const { client } = replay();
    const ack = await client.placeStrategy(entry("a"));
    expect(ack).toMatchObject({ strategyId: "cad-a", entryClientOrderId: "cad-a-e" });
    expect(await client.order("BTC-USD", "cad-a-e")).toMatchObject({
      status: "filled",
      filled: "0.01",
      price: "84218",
      isStrategyPrimary: true,
      strategyId: "cad-a",
    });
    const legs = await client.openOrders("BTC-USD");
    expect(
      legs.map((leg) => [leg.clientOrderId, leg.type, leg.side, leg.size, leg.stopPrice]),
    ).toEqual([
      ["cad-a-s", "stop", "sell", "0.01", "83200"],
      ["cad-a-t", "take_profit", "sell", "0.01", "86800"],
    ]);
    expect(legs.every((leg) => leg.status === "untriggered" && leg.reduceOnly)).toBe(true);
    expect(legs.every((leg) => leg.strategyId === "cad-a" && !leg.isStrategyPrimary)).toBe(true);
  });

  it("charges a builder fee on the strategy's fills only when the order carries one", async () => {
    const free = replay();
    await free.client.placeStrategy(entry("a"));
    const charged = replay();
    await charged.client.placeStrategy(entry("a", { builderFeeBps: 5 }));
    const entryCharge = curatorFeeCharge("84050", "0.01", 5);
    expect(entryCharge).toBe("0.42");
    expect(free.client.builderFeesPaid()).toBe("0");
    expect(charged.client.builderFeesPaid()).toBe(entryCharge);
    const balanceOf = async (client: typeof free.client) =>
      (await client.accountState("BTC-USD")).account.availableBalance;
    expect(subtractDecimal(await balanceOf(free.client), await balanceOf(charged.client))).toBe(
      entryCharge,
    );
    expect((await charged.client.fills("BTC-USD", t0))[0]?.fee).toBe("0.42025");

    await charged.client.closeReduceOnly({
      clientOrderId: "cad-a-t",
      symbol: "BTC-USD",
      side: "sell",
      size: "0.01",
    });
    const exitCharge = curatorFeeCharge("84040", "0.01", 5);
    expect(charged.client.builderFeesPaid()).toBe(addDecimal(entryCharge, exitCharge));
  });

  it("opens the position and records the fill with its taker fee", async () => {
    const { client } = replay();
    await client.placeStrategy(entry("a"));
    const state = await client.accountState("BTC-USD");
    expect(state.positions).toEqual([
      {
        symbol: "BTC-USD",
        signedSize: "0.01",
        entryPrice: "84050",
        marginMode: "isolated",
        leverage: 5,
        liquidationPrice: null,
      },
    ]);
    expect(await client.fills("BTC-USD", t0)).toEqual([
      expect.objectContaining({
        clientOrderId: "cad-a-e",
        side: "buy",
        price: "84050",
        size: "0.01",
        fee: "0.42025",
      }),
    ]);
    expect(state.account.availableBalance).toBe("81.47975");
  });
});

describe("an FOK entry that cannot fill completely", () => {
  it.each([
    ["is larger than the depth", { size: "0.6" }],
    ["is limited below the ask", { limitPrice: "84049", stopPrice: "83200" }],
  ])("expires with its exits when it %s", async (_label, change) => {
    const { client } = replay();
    await client.placeStrategy(entry("b", change));
    expect(await client.order("BTC-USD", "cad-b-e")).toMatchObject({
      status: "expired",
      filled: "0",
    });
    expect(await client.order("BTC-USD", "cad-b-s")).toMatchObject({
      status: "expired",
      closeReason: "order_strategy_primary_closed",
    });
    expect(await client.openOrders(null)).toEqual([]);
    expect((await client.accountState("BTC-USD")).positions).toEqual([]);
    expect(await client.fills("BTC-USD", 0)).toEqual([]);
  });
});

describe("behaviours", () => {
  it("records the first strategy, then loses its response", async () => {
    const { client } = replay(replayScenarios.ambiguous_response);
    await expect(client.placeStrategy(entry("c"))).rejects.toBeInstanceOf(StrikeAmbiguousError);
    expect(await client.order("BTC-USD", "cad-c-e")).toMatchObject({ status: "filled" });
    expect(client.submittedStrategies()).toHaveLength(1);
    await expect(client.placeStrategy(entry("d"))).resolves.toMatchObject({ strategyId: "cad-d" });
  });

  it("fills with no exit legs when exits go missing", async () => {
    const { client } = replay(replayScenarios.exits_missing);
    await client.placeStrategy(entry("e"));
    expect(await client.order("BTC-USD", "cad-e-e")).toMatchObject({ status: "filled" });
    expect(await client.openOrders("BTC-USD")).toEqual([]);
    expect(await client.order("BTC-USD", "cad-e-s")).toBeNull();
    expect((await client.accountState("BTC-USD")).positions).toHaveLength(1);
  });

  it("dates market data by the scenario's age", async () => {
    const { client } = replay(replayScenarios.stale_data);
    expect((await client.book("BTC-USD", 50)).observedAt).toBe(t0 - 10_000);
    expect((await client.mark("BTC-USD")).observedAt).toBe(t0 - 10_000);
    expect((await client.accountState("BTC-USD")).account.observedAt).toBe(t0);
  });

  it("quotes a late market above the plan's range", async () => {
    const { client } = replay(replayScenarios.late_entry);
    expect((await client.book("BTC-USD", 50)).asks).toEqual([["85150", "0.5"]]);
  });

  it("gives identical results for two runs of the same scenario", async () => {
    const run = async () => {
      const { client, advance } = replay();
      await client.placeStrategy(entry("f"));
      advance(1_000);
      await client.closeReduceOnly({
        clientOrderId: "cad-f-r",
        symbol: "BTC-USD",
        side: "sell",
        size: "0.01",
      });
      return {
        orders: await Promise.all(
          ["e", "s", "t", "r"].map((role) => client.order("BTC-USD", `cad-f-${role}`)),
        ),
        fills: await client.fills("BTC-USD", 0),
        state: await client.accountState("BTC-USD"),
      };
    };
    expect(await run()).toEqual(await run());
  });
});

describe("closing", () => {
  it("closes the position at the bid and cancels the exits", async () => {
    const { client, advance } = replay();
    await client.placeStrategy(entry("g"));
    advance(1_000);
    const ack = await client.closeReduceOnly({
      clientOrderId: "cad-g-r",
      symbol: "BTC-USD",
      side: "sell",
      size: "0.02",
    });
    expect(ack.clientOrderId).toBe("cad-g-r");
    expect(await client.order("BTC-USD", "cad-g-r")).toMatchObject({
      status: "filled",
      filled: "0.01",
      reduceOnly: true,
    });
    expect(await client.order("BTC-USD", "cad-g-t")).toMatchObject({
      status: "canceled",
      closeReason: "position_closed",
    });
    const state = await client.accountState("BTC-USD");
    expect(state.positions).toEqual([]);
    expect(state.openOrders).toEqual([]);
    const fills = await client.fills("BTC-USD", t0 + 500);
    expect(fills).toEqual([
      expect.objectContaining({
        clientOrderId: "cad-g-r",
        side: "sell",
        price: "84040",
        fee: "0.4202",
      }),
    ]);
    expect(state.account.availableBalance).toBe("249.05955");
  });

  it("keeps the exits armed after a partial close", async () => {
    const { client } = replay();
    await client.placeStrategy(entry("p"));
    await client.closeReduceOnly({
      clientOrderId: "cad-p-r",
      symbol: "BTC-USD",
      side: "sell",
      size: "0.004",
    });
    const state = await client.accountState("BTC-USD");
    expect(state.positions[0]?.signedSize).toBe("0.006");
    expect(state.openOrders.map((order) => order.clientOrderId)).toEqual(["cad-p-s", "cad-p-t"]);
  });

  it("rejects a reduce-only close that would add to the position", async () => {
    const { client } = replay();
    await client.placeStrategy(entry("q"));
    await client.closeReduceOnly({
      clientOrderId: "cad-q-r",
      symbol: "BTC-USD",
      side: "buy",
      size: "0.01",
    });
    expect(await client.order("BTC-USD", "cad-q-r")).toMatchObject({
      status: "rejected",
      closeReason: "order_increase_position",
    });
    expect((await client.accountState("BTC-USD")).positions[0]?.signedSize).toBe("0.01");
  });

  it("rejects a reduce-only close when there is no position", async () => {
    const { client } = replay();
    await client.closeReduceOnly({
      clientOrderId: "cad-h-r",
      symbol: "BTC-USD",
      side: "sell",
      size: "0.01",
    });
    expect(await client.order("BTC-USD", "cad-h-r")).toMatchObject({
      status: "rejected",
      closeReason: "no_open_position",
    });
  });
});

describe("cancel", () => {
  it("cancels a live order and silently ignores an unknown one", async () => {
    const { client } = replay();
    await client.placeStrategy(entry("i"));
    await client.cancel("BTC-USD", "cad-i-t");
    await client.cancel("BTC-USD", "cad-nobody-e");
    expect(await client.order("BTC-USD", "cad-i-t")).toMatchObject({ status: "canceled" });
    expect((await client.openOrders("BTC-USD")).map((order) => order.clientOrderId)).toEqual([
      "cad-i-s",
    ]);
  });
});

describe("Strike's order rules", () => {
  it.each([
    ["a price off the tick grid", { limitPrice: "84218.5" }],
    ["a size off the lot grid", { size: "0.010001" }],
    ["a notional below the minimum", { size: "0.0001" }],
    ["a price beyond the limit bound from mark", { limitPrice: "88300", targetPrice: "89000" }],
    ["a market Strike does not list", { symbol: "DOGE-USD" }],
  ])("rejects %s", async (_label, change) => {
    const { client } = replay();
    await expect(client.placeStrategy(entry("j", change))).rejects.toBeInstanceOf(
      StrikeRejectedError,
    );
    expect(await client.order("BTC-USD", "cad-j-e")).toBeNull();
  });

  it("refuses exits on the wrong side of the entry, as the live client does", async () => {
    const { client } = replay();
    await expect(client.placeStrategy(entry("k", { stopPrice: "85000" }))).rejects.toThrow(
      "The exits are on the wrong side of the entry",
    );
  });
});

describe("symbol settings", () => {
  it("starts isolated at the scenario's leverage and applies a new leverage", async () => {
    const { client } = replay();
    expect((await client.accountState("BTC-USD")).symbolSettings).toEqual({
      symbol: "BTC-USD",
      marginMode: "isolated",
      leverage: 5,
    });
    await client.configureSymbol("BTC-USD", { marginMode: "isolated", leverage: 3 });
    expect((await client.accountState("BTC-USD")).symbolSettings.leverage).toBe(3);
  });

  it.each([
    ["BTC-USD", 0],
    ["BTC-USD", 101],
    ["DOGE-USD", 5],
  ])("refuses %s at leverage %s, as Strike would", async (symbol, leverage) => {
    const { client } = replay();
    await expect(
      client.configureSymbol(symbol, { marginMode: "isolated", leverage }),
    ).rejects.toBeInstanceOf(StrikeRejectedError);
  });
});

describe("replay order identities", () => {
  it("never repeats an order or fill ID across separate replay exchanges", async () => {
    const first = replay();
    const second = replay();
    await first.client.placeStrategy(entry("intent-one"));
    await second.client.placeStrategy(entry("intent-two"));
    const ids = [
      ...(await first.client.openOrders(null)).map((order) => order.orderId),
      ...(await second.client.openOrders(null)).map((order) => order.orderId),
      ...(await first.client.fills("BTC-USD", 0)).map((fill) => fill.fillId),
      ...(await second.client.fills("BTC-USD", 0)).map((fill) => fill.fillId),
    ];
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives the same order the same ID in a restarted replay exchange", async () => {
    const before = replay();
    const after = replay();
    await before.client.placeStrategy(entry("intent-one"));
    await after.client.placeStrategy(entry("intent-one"));
    expect(await after.client.order("BTC-USD", "cad-intent-one-e")).toMatchObject({
      orderId: (await before.client.order("BTC-USD", "cad-intent-one-e"))?.orderId,
    });
  });
});
