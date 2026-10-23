import { clientOrderIdFor, type ExchangeOrderSnapshot } from "@cadence/core";
import { StrikeRejectedError, type ReplayStrikeClient } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { closePosition } from "../src/close-position";
import { reconcileIntent } from "../src/reconcile";
import { submitIntent } from "../src/submit";
import { resetDatabaseBetweenTests } from "./support/database";
import { approved } from "./support/flows";
import { eventTypes, intentState, lastEventData, orderRowsOf, receiptOf } from "./support/read";

resetDatabaseBetweenTests();

type Exchange = "fresh" | "resting" | "resting_cancel_fails" | "lagging";

const isLeg = (clientOrderId: string) => /-[st]$/.test(clientOrderId);
const isClose = (clientOrderId: string) => clientOrderId.endsWith("-c");
const notFound = () =>
  new StrikeRejectedError({
    operation: "cancel",
    status: 404,
    code: null,
    message: "order not found",
  });

function recording(exchange: Exchange) {
  const closes: string[] = [];
  const cancels: string[] = [];
  const resting = exchange === "resting" || exchange === "resting_cancel_fails";
  const stillResting = (clientOrderId: string) =>
    exchange === "resting_cancel_fails" || !cancels.includes(clientOrderId);
  const wrap = (replay: ReplayStrikeClient): ReplayStrikeClient => {
    const legIds = () =>
      replay
        .submittedStrategies()
        .flatMap((order) => [order.stopClientOrderId, order.targetClientOrderId]);
    const untriggered = (order: ExchangeOrderSnapshot): ExchangeOrderSnapshot => ({
      ...order,
      status: "untriggered",
      closeReason: null,
    });
    return {
      ...replay,
      closeReduceOnly: (order) => {
        closes.push(order.clientOrderId);
        return replay.closeReduceOnly(order);
      },
      cancel: (symbol, clientOrderId) => {
        cancels.push(clientOrderId);
        return exchange === "resting_cancel_fails"
          ? Promise.reject(notFound())
          : replay.cancel(symbol, clientOrderId);
      },
      order: async (symbol, clientOrderId) => {
        const order = await replay.order(symbol, clientOrderId);
        if (order === null || exchange === "fresh") {
          return order;
        }
        if (exchange === "lagging" && isClose(clientOrderId)) {
          return null;
        }
        const stale = exchange === "lagging" || (resting && stillResting(clientOrderId));
        return isLeg(clientOrderId) && stale ? untriggered(order) : order;
      },
      accountState: async (symbol) => {
        const state = await replay.accountState(symbol);
        if (!resting) {
          return state;
        }
        const shown = new Set(state.openOrders.map((order) => order.clientOrderId));
        const legs = await Promise.all(legIds().map((id) => replay.order(symbol, id)));
        const left = legs.flatMap((order) =>
          order !== null && !shown.has(order.clientOrderId) && stillResting(order.clientOrderId)
            ? [untriggered(order)]
            : [],
        );
        return { ...state, openOrders: [...state.openOrders, ...left] };
      },
      fills: async (symbol, sinceMs) => {
        const fills = await replay.fills(symbol, sinceMs);
        return exchange === "lagging"
          ? fills.map((fill) =>
              fill.clientOrderId !== null && isClose(fill.clientOrderId)
                ? { ...fill, clientOrderId: null }
                : fill,
            )
          : fills;
      },
    };
  };
  return { closes, cancels, wrap };
}

async function openPosition(exchange: Exchange = "fresh") {
  const { closes, cancels, wrap } = recording(exchange);
  const setup = await approved({ client: wrap });
  await submitIntent(setup.deps, setup.intent.id);
  await reconcileIntent(setup.deps, setup.intent.id);
  expect(await intentState(setup.intent.id)).toBe("open_verified");
  return { ...setup, closes, cancels };
}

describe("closing a position the member wants out of", () => {
  it("sends one reduce-only close under its own ID and reconciles it into a complete receipt", async () => {
    const { intent, deps, closes } = await openPosition();
    const closeId = clientOrderIdFor(intent.id, "close");

    await expect(closePosition(deps, intent.id)).resolves.toBe("close_sent");
    await expect(closePosition(deps, intent.id)).resolves.toBe("already_closing");

    expect(closes).toEqual([closeId]);
    expect(await lastEventData(intent.id, "close_attempted")).toEqual({
      clientOrderId: closeId,
      side: "sell",
      size: intent.approved.quantity,
    });
    await reconcileIntent(deps, intent.id);
    expect(await intentState(intent.id)).toBe("closed");
    expect((await orderRowsOf(intent.id)).map((row) => [row.role, row.lastStatus])).toEqual([
      ["entry", "filled"],
      ["stop", "canceled"],
      ["target", "canceled"],
      ["close", "filled"],
    ]);
    expect(await receiptOf(intent.id)).toMatchObject({
      state: "closed",
      incomplete: [],
      entry: { size: intent.approved.quantity, averagePrice: "84050" },
      exit: { size: intent.approved.quantity, averagePrice: "84040" },
    });
    expect((await eventTypes(intent.id)).slice(-4)).toEqual([
      "exits_verified",
      "close_attempted",
      "close_acknowledged",
      "close_reconciled",
    ]);
  });

  it("cancels a stop and target the exchange left live after the close, then reconciles", async () => {
    const { intent, deps, cancels } = await openPosition("resting");

    await closePosition(deps, intent.id);
    await reconcileIntent(deps, intent.id);

    expect(cancels).toEqual([
      clientOrderIdFor(intent.id, "stop"),
      clientOrderIdFor(intent.id, "target"),
    ]);
    expect(await intentState(intent.id)).toBe("open_verified");
    await reconcileIntent(deps, intent.id);
    expect(await intentState(intent.id)).toBe("closed");
    expect(await receiptOf(intent.id)).toMatchObject({ state: "closed", incomplete: [] });
  });

  it("tries each leftover cancel once when the exchange keeps refusing it", async () => {
    const { intent, deps, cancels } = await openPosition("resting_cancel_fails");

    await closePosition(deps, intent.id);
    for (let pass = 0; pass < 3; pass += 1) {
      await reconcileIntent(deps, intent.id);
    }

    expect(cancels).toEqual([
      clientOrderIdFor(intent.id, "stop"),
      clientOrderIdFor(intent.id, "target"),
    ]);
    expect(await intentState(intent.id)).toBe("open_verified");
  });

  it("reconciles the close while Strike's order lookup lags behind its fills", async () => {
    const { intent, deps, cancels } = await openPosition("lagging");

    await closePosition(deps, intent.id);
    await reconcileIntent(deps, intent.id);

    expect(cancels).toEqual([]);
    expect(await intentState(intent.id)).toBe("closed");
    expect((await orderRowsOf(intent.id)).map((row) => [row.role, row.lastStatus])).toEqual([
      ["entry", "filled"],
      ["stop", "canceled"],
      ["target", "canceled"],
      ["close", "filled"],
    ]);
    expect(await receiptOf(intent.id)).toMatchObject({
      state: "closed",
      incomplete: [],
      exit: { size: intent.approved.quantity, averagePrice: "84040" },
    });
  });

  it("sends nothing for an intent with no open position", async () => {
    const { intent, deps, closes } = await openPosition();
    await closePosition(deps, intent.id);
    await reconcileIntent(deps, intent.id);

    await expect(closePosition(deps, intent.id)).resolves.toBe("nothing_to_close");
    expect(closes).toHaveLength(1);
  });

  it("never resends a close whose answer was lost", async () => {
    const closes: string[] = [];
    const losing = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
      ...replay,
      closeReduceOnly: (order) => {
        closes.push(order.clientOrderId);
        return Promise.reject(new Error("socket hang up"));
      },
    });
    const { intent, deps } = await approved({ client: losing });
    await submitIntent(deps, intent.id);
    await reconcileIntent(deps, intent.id);

    await expect(closePosition(deps, intent.id)).resolves.toBe("close_unknown");
    await expect(closePosition(deps, intent.id)).resolves.toBe("already_closing");

    expect(closes).toHaveLength(1);
    expect(await intentState(intent.id)).toBe("open_verified");
  });
});
