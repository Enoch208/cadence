import { Decimal } from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { clientOrderIdFor, type IntentState } from "@cadence/core";
import { events, exchangeOrders } from "@cadence/db";
import { StrikeRejectedError, type ReduceOnlyClose, type StrikeClient } from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { errorData, recordEvent, type EventData } from "./events";
import { heldPosition } from "./exits";
import { attributeFills, fillFacts } from "./fills";
import { loadIntentContext, type IntentContext } from "./intent-context";
import { milestones, observe } from "./observation";
import { closingRow, loadOrderRows, rowFor } from "./order-rows";
import { enqueue } from "./outbox";
import { lockIntentState } from "./transition";

export type CloseOutcome =
  "close_sent" | "close_unknown" | "close_rejected" | "already_closing" | "nothing_to_close";

export const closableStates: readonly IntentState[] = ["open_verifying", "open_verified"];

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

function persistClose(deps: WorkerDeps, context: IntentContext, close: ReduceOnlyClose) {
  return deps.db.transaction(async (tx) => {
    const state = await lockIntentState(tx, context.intent.id);
    if (state === null || !closableStates.includes(state)) {
      return false;
    }
    const inserted = await tx
      .insert(exchangeOrders)
      .values(closingRow(context.intent.id, "close", close))
      .onConflictDoNothing()
      .returning({ id: exchangeOrders.id });
    if (inserted.length === 0) {
      return false;
    }
    await recordEvent(tx, {
      at: deps.now(),
      correlationId: context.intent.id,
      environment: context.connection.environment,
      type: "close_attempted",
      data: { clientOrderId: close.clientOrderId, side: close.side, size: close.size },
    });
    return true;
  });
}

async function sizeToClose(client: StrikeClient, deps: WorkerDeps, context: IntentContext) {
  const rows = await loadOrderRows(deps.db, context.intent.id);
  const times = await milestones(deps.db, context.intent.id);
  const observation = await observe(client, context, rows);
  const openingSide = context.plan.direction === "long" ? "buy" : "sell";
  const signedSize =
    observation.account.positions.find((position) => position.symbol === context.intent.market)
      ?.signedSize ?? "0";
  const position = heldPosition(signedSize, openingSide === "buy");
  const ours = attributeFills(observation.fills, rows, {
    openingSide,
    submittedAt: times.submittedAt,
    quantity: context.intent.approved.quantity,
    closeAttemptedAt: times.closeAttemptedAt,
  });
  const { openSize } = fillFacts(observation.fills, ours, openingSide);
  return {
    size: position.opposite ? new Decimal(0) : Decimal.min(position.size, openSize),
    data: { positionSize: position.size, openSize },
  };
}

export async function closePosition(deps: WorkerDeps, intentId: string): Promise<CloseOutcome> {
  const context = await loadIntentContext(deps.db, intentId);
  if (!closableStates.includes(context.intent.state)) {
    return "nothing_to_close";
  }
  if (rowFor(await loadOrderRows(deps.db, intentId), "close") !== null) {
    return "already_closing";
  }
  const client = deps.strikeFor(context.connection);
  const { size, data } = await sizeToClose(client, deps, context);
  if (!size.greaterThan(0)) {
    await note(deps, context, "close_not_needed", data);
    return "nothing_to_close";
  }
  const close: ReduceOnlyClose = {
    clientOrderId: clientOrderIdFor(intentId, "close"),
    symbol: context.intent.market,
    side: context.plan.direction === "long" ? "sell" : "buy",
    size: size.toFixed(),
  };
  if (!(await persistClose(deps, context, close))) {
    return "already_closing";
  }
  try {
    await client.closeReduceOnly(close);
  } catch (error) {
    if (error instanceof StrikeRejectedError) {
      await note(deps, context, "close_rejected", errorData(error));
      return "close_rejected";
    }
    await note(deps, context, "close_unknown", errorData(error));
    return "close_unknown";
  }
  await note(deps, context, "close_acknowledged", { clientOrderId: close.clientOrderId });
  return "close_sent";
}

const leftoverCancelEvents = ["leftover_exit_cancel_sent", "leftover_exit_cancel_rejected"];

async function cancelsAlreadyTried(deps: WorkerDeps, intentId: string): Promise<Set<string>> {
  const rows = await deps.db
    .select({ data: events.data })
    .from(events)
    .where(and(eq(events.correlationId, intentId), inArray(events.type, leftoverCancelEvents)));
  return new Set(
    rows.flatMap(({ data }) => {
      const id = z.object({ clientOrderId: z.string() }).safeParse(data);
      return id.success ? [id.data.clientOrderId] : [];
    }),
  );
}

export async function cancelLeftoverExits(
  deps: WorkerDeps,
  client: StrikeClient,
  context: IntentContext,
  clientOrderIds: readonly string[],
): Promise<void> {
  const tried = await cancelsAlreadyTried(deps, context.intent.id);
  for (const clientOrderId of clientOrderIds.filter((id) => !tried.has(id))) {
    try {
      await client.cancel(context.intent.market, clientOrderId);
    } catch (error) {
      if (error instanceof StrikeRejectedError) {
        await note(deps, context, "leftover_exit_cancel_rejected", {
          clientOrderId,
          ...errorData(error),
        });
        continue;
      }
      throw error;
    }
    await note(deps, context, "leftover_exit_cancel_sent", { clientOrderId });
  }
}
