import { clientOrderIdFor } from "@cadence/core";
import { StrikeRejectedError } from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { errorData, recordEvent, type EventData } from "./events";
import { loadIntentContext, type IntentContext } from "./intent-context";
import { enqueue } from "./outbox";
import { settle } from "./settle";
import { lockIntentState } from "./transition";

export type CancelOutcome = "ended_before_submit" | "cancel_sent" | "nothing_to_cancel";

function note(deps: WorkerDeps, context: IntentContext, type: string, data: EventData) {
  return deps.db.transaction(async (tx) => {
    const at = deps.now();
    await recordEvent(tx, {
      at,
      correlationId: context.intent.id,
      environment: context.connection.environment,
      type,
      data,
    });
    await enqueue(tx, {
      kind: "reconcile",
      intentId: context.intent.id,
      accountConnectionId: context.connection.id,
      at,
    });
  });
}

export async function cancelEntry(deps: WorkerDeps, intentId: string): Promise<CancelOutcome> {
  const context = await loadIntentContext(deps.db, intentId);
  const { endedBeforeSubmit, state } = await deps.db.transaction(async (tx) => {
    const locked = await lockIntentState(tx, intentId);
    if (locked === "reserved") {
      const data = { cause: "the member canceled the entry before it was sent" };
      await settle(tx, context, locked, { event: "validation_failed", data }, deps.now());
    }
    return { endedBeforeSubmit: locked === "reserved", state: locked };
  });
  if (endedBeforeSubmit) {
    return "ended_before_submit";
  }
  if (state !== "submitted" && state !== "unknown") {
    return "nothing_to_cancel";
  }
  const clientOrderId = clientOrderIdFor(intentId, "entry");
  try {
    await deps.strikeFor(context.connection).cancel(context.intent.market, clientOrderId);
  } catch (error) {
    if (error instanceof StrikeRejectedError) {
      await note(deps, context, "entry_cancel_rejected", errorData(error));
      return "nothing_to_cancel";
    }
    throw error;
  }
  await note(deps, context, "entry_cancel_sent", { clientOrderId });
  return "cancel_sent";
}
