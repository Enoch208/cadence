import { eq } from "drizzle-orm";
import { accountConnections, exchangeOrders } from "@cadence/db";
import {
  StrikeRejectedError,
  toStrategyOrder,
  type StrategyAck,
  type StrategyOrder,
  type StrikeClient,
} from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { errorData } from "./events";
import { loadIntentContext, type IntentContext } from "./intent-context";
import { strategyRows } from "./order-rows";
import { enqueue } from "./outbox";
import { recheckIntent, type Recheck, type Refusal } from "./recheck";
import { settle } from "./settle";
import { lockIntentState } from "./transition";

export type SubmitOutcome = "acknowledged" | "unknown" | "rejected" | "refused" | "not_reserved";

const reconcileSoon = (context: IntentContext, at: number) => ({
  kind: "reconcile" as const,
  intentId: context.intent.id,
  accountConnectionId: context.connection.id,
  at,
});

function refuseIntent(deps: WorkerDeps, context: IntentContext, refusal: Refusal) {
  return deps.db.transaction(async (tx) => {
    const state = await lockIntentState(tx, context.intent.id);
    if (state === "reserved") {
      await settle(tx, context, state, refusal, deps.now());
    }
  });
}

function persistBeforeSending(
  deps: WorkerDeps,
  context: IntentContext,
  order: StrategyOrder,
  { proposal, decision }: Extract<Recheck, { kind: "send" }>,
): Promise<"persisted" | "refused" | "not_reserved"> {
  return deps.db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ status: accountConnections.status })
      .from(accountConnections)
      .where(eq(accountConnections.id, context.connection.id))
      .for("share");
    const state = await lockIntentState(tx, context.intent.id);
    if (state !== "reserved") {
      return "not_reserved";
    }
    const at = deps.now();
    if (connection?.status !== "active") {
      const data = {
        refusal: "connection_not_active",
        connectionStatus: connection?.status ?? null,
      };
      await settle(tx, context, state, { event: "validation_failed", data }, at);
      return "refused";
    }
    const rows = strategyRows(context.intent.id, order);
    await tx.insert(exchangeOrders).values(rows);
    await settle(
      tx,
      context,
      state,
      {
        event: "submit_attempted",
        data: {
          strategyId: order.strategyId,
          clientOrderIds: rows.map((row) => row.clientOrderId),
          payloadDigest: rows[0]?.payloadDigest ?? null,
          outcome: decision.outcome,
          reasons: decision.reasons,
          quantity: proposal.quantity,
          limitPrice: proposal.limitPrice,
          plannedLoss: proposal.plannedLoss,
        },
      },
      at,
    );
    return "persisted";
  });
}

function recordAck(deps: WorkerDeps, context: IntentContext, ack: StrategyAck) {
  return deps.db.transaction(async (tx) => {
    const at = deps.now();
    await settle(
      tx,
      context,
      "submitted",
      {
        event: "acknowledged",
        data: { strategyId: ack.strategyId, accountId: ack.accountId, at: ack.acknowledgedAt },
      },
      at,
    );
    await enqueue(tx, reconcileSoon(context, at));
  });
}

async function recordSendFailure(
  deps: WorkerDeps,
  context: IntentContext,
  error: unknown,
): Promise<SubmitOutcome> {
  return deps.db.transaction(async (tx) => {
    const at = deps.now();
    if (error instanceof StrikeRejectedError) {
      const data = { status: error.status, code: error.code, detail: error.message };
      await settle(tx, context, "submitted", { event: "exchange_rejected", data }, at);
      return "rejected";
    }
    await settle(
      tx,
      context,
      "submitted",
      { event: "submit_timed_out", data: errorData(error) },
      at,
    );
    await enqueue(tx, reconcileSoon(context, at));
    return "unknown";
  });
}

async function send(
  deps: WorkerDeps,
  context: IntentContext,
  client: StrikeClient,
  order: StrategyOrder,
): Promise<SubmitOutcome> {
  let ack: StrategyAck;
  try {
    ack = await client.placeStrategy(order);
  } catch (error) {
    return recordSendFailure(deps, context, error);
  }
  await recordAck(deps, context, ack);
  return "acknowledged";
}

export async function submitIntent(deps: WorkerDeps, intentId: string): Promise<SubmitOutcome> {
  const context = await loadIntentContext(deps.db, intentId);
  const { state } = context.intent;
  if (state !== "reserved") {
    if (state === "submitted" || state === "unknown") {
      await enqueue(deps.db, reconcileSoon(context, deps.now()));
    }
    return "not_reserved";
  }
  const client = deps.strikeFor(context.connection);
  const recheck = await recheckIntent(deps, client, context);
  if (recheck.kind === "refuse") {
    await refuseIntent(deps, context, recheck.refusal);
    return "refused";
  }
  const order = toStrategyOrder({ intentId, plan: context.plan, proposal: recheck.proposal });
  const persisted = await persistBeforeSending(deps, context, order, recheck);
  if (persisted !== "persisted") {
    return persisted;
  }
  return send(deps, context, client, order);
}
