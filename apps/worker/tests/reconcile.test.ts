import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { clientOrderIdFor } from "@cadence/core";
import { accountConnections } from "@cadence/db";
import { replayScenarios, type ReplayStrikeClient } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { reconcileIntent } from "../src/reconcile";
import { submitIntent } from "../src/submit";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { approved } from "./support/flows";
import {
  connectionStatus,
  eventTypes,
  fillsOf,
  lastEventData,
  orderRowsOf,
  receiptOf,
  reservationStatus,
} from "./support/read";

resetDatabaseBetweenTests();

const silentlyDropping = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
  ...replay,
  placeStrategy: (order) =>
    Promise.resolve({
      strategyId: order.strategyId,
      entryClientOrderId: order.entryClientOrderId,
      accountId: "replay:happy_path",
      acknowledgedAt: 0,
    }),
});

const hidingTheEntry = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
  ...replay,
  order: (symbol, clientOrderId) =>
    clientOrderId.endsWith("-e") ? Promise.resolve(null) : replay.order(symbol, clientOrderId),
});

const forgettingTheEntry = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
  ...hidingTheEntry(replay),
  fills: async (symbol, sinceMs) =>
    (await replay.fills(symbol, sinceMs)).map((fill) =>
      fill.clientOrderId?.endsWith("-e") === true ? { ...fill, clientOrderId: null } : fill,
    ),
});

const hidingEverythingButThePosition = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
  ...hidingTheEntry(replay),
  fills: () => Promise.resolve([]),
});

const deepBook =
  (thin: ReplayStrikeClient): ReplayStrikeClient["book"] =>
  async (symbol, depth) => {
    const book = await thin.book(symbol, depth);
    return {
      ...book,
      asks: book.asks.map(([price]) => [price, "0.5"] as const),
      bids: book.bids.map(([price]) => [price, "0.5"] as const),
    };
  };

async function openVerified() {
  const setup = await approved();
  await submitIntent(setup.deps, setup.intent.id);
  expect(await reconcileIntent(setup.deps, setup.intent.id)).toBe("open_verified");
  return setup;
}

describe("reconciling a filled entry", () => {
  it("records the fill and verifies both exits against the actual position", async () => {
    const { intent, deps } = await openVerified();
    const { quantity } = intent.approved;

    expect(await eventTypes(intent.id)).toEqual([
      "intent_reserved",
      "submit_attempted",
      "acknowledged",
      "fill_observed",
      "exits_verified",
    ]);
    const rows = await orderRowsOf(intent.id);
    expect(
      rows.map((row) => [row.role, row.lastStatus, new Decimal(row.filledSize).toFixed()]),
    ).toEqual([
      ["entry", "filled", quantity],
      ["stop", "untriggered", "0"],
      ["target", "untriggered", "0"],
    ]);
    expect(rows.every((row) => row.exchangeOrderId !== null)).toBe(true);
    expect(
      (await fillsOf(intent.id)).map((fill) => [fill.role, fill.side, fill.price, fill.size]),
    ).toEqual([["entry", "buy", "84050", quantity]]);
    expect(await lastEventData(intent.id, "exits_verified")).toEqual({
      from: "open_verifying",
      to: "open_verified",
      positionSize: quantity,
    });
    expect(await reservationStatus(intent.id)).toBe("active");

    expect(await reconcileIntent(deps, intent.id)).toBe("open_verified");
    expect(await eventTypes(intent.id)).toHaveLength(5);
  });

  it("keeps reconciling a paused account and closes once the exits are gone and the fills net out", async () => {
    const { intent, deps, member, replay, clock } = await openVerified();
    await db
      .update(accountConnections)
      .set({ status: "paused" })
      .where(eq(accountConnections.id, member.connection.id));
    const { quantity } = intent.approved;
    clock.advance(60_000);
    await replay.closeReduceOnly({
      clientOrderId: clientOrderIdFor(intent.id, "target"),
      symbol: "BTC-USD",
      side: "sell",
      size: quantity,
    });

    expect(await reconcileIntent(deps, intent.id)).toBe("closed");

    const q = new Decimal(quantity);
    const fees = q.times(84050).plus(q.times(84040)).times("0.0005");
    expect(await receiptOf(intent.id)).toMatchObject({
      state: "closed",
      entry: { size: quantity, averagePrice: "84050" },
      exit: { size: quantity, averagePrice: "84040" },
      feesPaid: fees.toFixed(),
      realizedPnl: q.times(-10).minus(fees).toFixed(),
      incomplete: [],
    });
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await connectionStatus(member.connection.id)).toBe("paused");
  });

  it("closes after a manual close on Strike but says the receipt lacks Cadence's exit fills", async () => {
    const { intent, deps, replay } = await openVerified();
    await replay.closeReduceOnly({
      clientOrderId: "closed-by-hand",
      symbol: "BTC-USD",
      side: "sell",
      size: intent.approved.quantity,
    });

    expect(await reconcileIntent(deps, intent.id)).toBe("closed");
    expect(await receiptOf(intent.id)).toMatchObject({
      exit: null,
      realizedPnl: null,
      incomplete: ["exit fills"],
    });
  });
});

describe("recovering missing exits", () => {
  it("waits 10 s, closes the reconciled size once with a reduce-only order, then closes the intent", async () => {
    const { intent, deps, replay, clock } = await approved({
      spec: { environment: "replay", scenario: "exits_missing" },
    });
    await submitIntent(deps, intent.id);
    expect(await reconcileIntent(deps, intent.id)).toBe("open_verifying");
    clock.advance(9_000);
    expect(await reconcileIntent(deps, intent.id)).toBe("open_verifying");
    clock.advance(1_000);

    expect(await reconcileIntent(deps, intent.id)).toBe("recovery_required");
    const recoveryId = clientOrderIdFor(intent.id, "recovery_close");
    expect(await replay.order("BTC-USD", recoveryId)).toMatchObject({
      status: "filled",
      side: "sell",
      reduceOnly: true,
      filled: intent.approved.quantity,
    });
    const recoveryRow = (await orderRowsOf(intent.id)).find((row) => row.role === "recovery_close");
    expect(recoveryRow).toMatchObject({ clientOrderId: recoveryId });
    expect(recoveryRow?.payload).toMatchObject({
      reduce_only: true,
      size: intent.approved.quantity,
    });

    expect(await reconcileIntent(deps, intent.id)).toBe("closed");
    expect(await eventTypes(intent.id)).toEqual([
      "intent_reserved",
      "submit_attempted",
      "acknowledged",
      "fill_observed",
      "exits_missing",
      "recovery_close_attempted",
      "recovery_close_acknowledged",
      "recovery_confirmed",
    ]);
    expect(await receiptOf(intent.id)).toMatchObject({
      state: "closed",
      exit: { size: intent.approved.quantity, averagePrice: "84040" },
      incomplete: [],
    });
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await reconcileIntent(deps, intent.id)).toBe("closed");
  });
});

describe("reconciling an entry that did not open a position", () => {
  it("marks an FOK entry the book could not fill unfilled and releases the reservation", async () => {
    const { intent, deps, client } = await approved({
      exchange: { ...replayScenarios.happy_path, depthSize: "0.00001" },
      client: (thin) => ({ ...thin, book: deepBook(thin) }),
    });
    await submitIntent(deps, intent.id);

    expect(await reconcileIntent(deps, intent.id)).toBe("unfilled");
    expect(await lastEventData(intent.id, "entry_unfilled")).toMatchObject({ status: "expired" });
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await receiptOf(intent.id)).toMatchObject({ state: "unfilled", incomplete: [] });
    expect(await client.openOrders("BTC-USD")).toEqual([]);
  });

  it("rejects a silently dropped order only after 30 s with no order, position or fill", async () => {
    const { intent, deps, clock } = await approved({ client: silentlyDropping });
    await expect(submitIntent(deps, intent.id)).resolves.toBe("acknowledged");

    for (const wait of [0, 10_000, 19_999]) {
      clock.advance(wait);
      expect(await reconcileIntent(deps, intent.id)).toBe("submitted");
    }
    clock.advance(1);
    expect(await reconcileIntent(deps, intent.id)).toBe("rejected");
    expect(await lastEventData(intent.id, "exchange_rejected")).toMatchObject({
      evidence: "no order, position or fill",
    });
    expect(await reservationStatus(intent.id)).toBe("released");
  });

  it.each([
    ["by its client ID", hidingTheEntry],
    ["when Strike no longer links the fill to a client ID", forgettingTheEntry],
  ])(
    "verifies a fill-or-kill entry Strike no longer serves from its fills, %s",
    async (_, client) => {
      const { intent, deps, clock } = await approved({ client });
      await submitIntent(deps, intent.id);
      clock.advance(1_000);
      expect(await reconcileIntent(deps, intent.id)).toBe("open_verified");
      const rows = await orderRowsOf(intent.id);
      const entry = rows.find((row) => row.role === "entry");
      expect(entry?.lastStatus).toBe("filled");
      expect(entry?.exchangeOrderId).not.toBeNull();
      expect(new Decimal(entry?.filledSize ?? "0").toFixed()).toBe(intent.approved.quantity);
      expect((await fillsOf(intent.id)).map((fill) => fill.role)).toEqual(["entry"]);
      expect(await eventTypes(intent.id)).toContain("exits_verified");
    },
  );

  it("never rejects an entry it cannot find while the account holds a position, and pauses the account", async () => {
    const { intent, deps, clock, member } = await approved({
      client: hidingEverythingButThePosition,
    });
    await submitIntent(deps, intent.id);
    clock.advance(10_000);

    expect(await reconcileIntent(deps, intent.id)).toBe("unknown");
    expect(await connectionStatus(member.connection.id)).toBe("paused");
    clock.advance(600_000);
    expect(await reconcileIntent(deps, intent.id)).toBe("unknown");
    expect(await reservationStatus(intent.id)).toBe("active");
    expect(
      (await eventTypes(intent.id)).filter((type) => type === "connection_paused"),
    ).toHaveLength(1);
  });

  it("resolves a lost response by finding the order by its client ID, having sent it once", async () => {
    const { intent, deps, replay } = await approved({
      spec: { environment: "replay", scenario: "ambiguous_response" },
    });
    await expect(submitIntent(deps, intent.id)).resolves.toBe("unknown");

    expect(await reconcileIntent(deps, intent.id)).toBe("open_verified");
    expect(await eventTypes(intent.id)).toEqual([
      "intent_reserved",
      "submit_attempted",
      "submit_timed_out",
      "acknowledged",
      "fill_observed",
      "exits_verified",
    ]);
    expect(replay.submittedStrategies()).toHaveLength(1);
  });
});
