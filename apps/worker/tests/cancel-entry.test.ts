import { clientOrderIdFor } from "@cadence/core";
import type { ReplayStrikeClient } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { cancelEntry } from "../src/cancel-entry";
import { reconcileIntent } from "../src/reconcile";
import { submitIntent } from "../src/submit";
import { resetDatabaseBetweenTests } from "./support/database";
import { approved } from "./support/flows";
import { intentState, lastEventData, outboxOf, receiptOf, reservationStatus } from "./support/read";

resetDatabaseBetweenTests();

function recordingCancels() {
  const cancels: [string, string][] = [];
  const wrap = (replay: ReplayStrikeClient): ReplayStrikeClient => ({
    ...replay,
    placeStrategy: (order) =>
      Promise.resolve({
        strategyId: order.strategyId,
        entryClientOrderId: order.entryClientOrderId,
        accountId: "replay:happy_path",
        acknowledgedAt: 0,
      }),
    cancel: (symbol, clientOrderId) => {
      cancels.push([symbol, clientOrderId]);
      return replay.cancel(symbol, clientOrderId);
    },
  });
  return { cancels, wrap };
}

describe("canceling an entry the member no longer wants", () => {
  it("ends an intent that was not sent yet and releases its reservation", async () => {
    const { intent, deps, replay } = await approved();

    await expect(cancelEntry(deps, intent.id)).resolves.toBe("ended_before_submit");

    expect(await intentState(intent.id)).toBe("blocked");
    expect(await lastEventData(intent.id, "validation_failed")).toMatchObject({
      cause: "the member canceled the entry before it was sent",
    });
    expect(await reservationStatus(intent.id)).toBe("released");
    expect(await receiptOf(intent.id)).toMatchObject({ state: "blocked" });
    await expect(submitIntent(deps, intent.id)).resolves.toBe("not_reserved");
    expect(replay.submittedStrategies()).toEqual([]);
  });

  it("cancels a sent entry by its client ID and queues a reconcile to record the outcome", async () => {
    const { cancels, wrap } = recordingCancels();
    const { intent, deps } = await approved({ client: wrap });
    await submitIntent(deps, intent.id);

    await expect(cancelEntry(deps, intent.id)).resolves.toBe("cancel_sent");

    expect(cancels).toEqual([["BTC-USD", clientOrderIdFor(intent.id, "entry")]]);
    expect(await lastEventData(intent.id, "entry_cancel_sent")).toEqual({
      clientOrderId: clientOrderIdFor(intent.id, "entry"),
    });
    expect(await outboxOf(intent.id)).toContainEqual({ kind: "reconcile", status: "pending" });
  });

  it("leaves a filled entry alone", async () => {
    const { intent, deps, client } = await approved();
    await submitIntent(deps, intent.id);
    await reconcileIntent(deps, intent.id);

    await expect(cancelEntry(deps, intent.id)).resolves.toBe("nothing_to_cancel");
    expect(await intentState(intent.id)).toBe("open_verified");
    expect(await client.openOrders("BTC-USD")).toHaveLength(2);
  });
});
