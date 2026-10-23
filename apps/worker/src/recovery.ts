import { Decimal } from "decimal.js";
import { clientOrderIdFor, type DecimalString } from "@cadence/core";
import { exchangeOrders, type ExchangeOrderRow } from "@cadence/db";
import { StrikeRejectedError, type ReduceOnlyClose, type StrikeClient } from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { errorData, recordEvent, type EventData } from "./events";
import { isLive } from "./exits";
import type { IntentContext } from "./intent-context";
import { pauseConnection } from "./ledger";
import type { Observation } from "./observation";
import { closingRow, rowFor } from "./order-rows";
import { lockIntentState } from "./transition";

export type RecoveryInput = {
  context: IntentContext;
  rows: readonly ExchangeOrderRow[];
  observation: Observation;
  positionSize: DecimalString;
  openSize: DecimalString;
};

function journal(deps: WorkerDeps, context: IntentContext) {
  const note = (type: string, data: EventData) =>
    deps.db.transaction((tx) =>
      recordEvent(tx, {
        at: deps.now(),
        correlationId: context.intent.id,
        environment: context.connection.environment,
        type,
        data,
      }),
    );
  const pause = (cause: string) =>
    deps.db.transaction((tx) =>
      pauseConnection(tx, {
        connectionId: context.connection.id,
        intentId: context.intent.id,
        environment: context.connection.environment,
        at: deps.now(),
        cause,
      }),
    );
  return { note, pause };
}

function persistClose(deps: WorkerDeps, context: IntentContext, close: ReduceOnlyClose) {
  return deps.db.transaction(async (tx) => {
    if ((await lockIntentState(tx, context.intent.id)) !== "recovery_required") {
      return false;
    }
    const inserted = await tx
      .insert(exchangeOrders)
      .values(closingRow(context.intent.id, "recovery_close", close))
      .onConflictDoNothing()
      .returning({ id: exchangeOrders.id });
    if (inserted.length === 0) {
      return false;
    }
    await recordEvent(tx, {
      at: deps.now(),
      correlationId: context.intent.id,
      environment: context.connection.environment,
      type: "recovery_close_attempted",
      data: { clientOrderId: close.clientOrderId, side: close.side, size: close.size },
    });
    return true;
  });
}

export async function recover(
  deps: WorkerDeps,
  client: StrikeClient,
  input: RecoveryInput,
): Promise<void> {
  const { context, rows, observation } = input;
  const { market } = context.intent;
  const { note, pause } = journal(deps, context);
  const entry = observation.orders.get("entry") ?? null;
  if (entry !== null && isLive(entry)) {
    await client.cancel(market, entry.clientOrderId);
    await note("residual_entry_cancel_sent", { clientOrderId: entry.clientOrderId });
  }
  if (rowFor(rows, "recovery_close") !== null) {
    const close = observation.orders.get("recovery_close") ?? null;
    if (close !== null && !isLive(close) && new Decimal(close.filled).isZero()) {
      await pause("the reduce-only recovery close was not executed");
    }
    return;
  }
  const size = Decimal.min(input.positionSize, input.openSize);
  if (!size.greaterThan(0)) {
    await pause("the open position cannot be attributed to this plan's fills");
    return;
  }
  const close: ReduceOnlyClose = {
    clientOrderId: clientOrderIdFor(context.intent.id, "recovery_close"),
    symbol: market,
    side: context.plan.direction === "long" ? "sell" : "buy",
    size: size.toFixed(),
  };
  if (!(await persistClose(deps, context, close))) {
    return;
  }
  try {
    await client.closeReduceOnly(close);
  } catch (error) {
    if (error instanceof StrikeRejectedError) {
      await note("recovery_close_rejected", errorData(error));
      await pause("Strike rejected the reduce-only recovery close");
      return;
    }
    await note("recovery_close_unknown", errorData(error));
    return;
  }
  await note("recovery_close_acknowledged", { clientOrderId: close.clientOrderId });
}
