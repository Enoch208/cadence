import { Decimal } from "decimal.js";
import { clientOrderIdFor, type IntentState } from "@cadence/core";
import type { ExchangeOrderRow, Tx } from "@cadence/db";
import type { WorkerDeps } from "./deps";
import { entryVerdict } from "./entry-verdict";
import { heldPosition, summarizeExits, type LegExpectation } from "./exits";
import { attributeFills, fillFacts, storeFills, type AttributedFill } from "./fills";
import { intentRef, loadIntentContext, type IntentContext } from "./intent-context";
import { pauseConnection } from "./ledger";
import { milestones, observe, type Milestones, type Observation } from "./observation";
import { openVerdict, type OpenState } from "./open-verdict";
import { loadOrderRows, recordSnapshot } from "./order-rows";
import { recover, type RecoveryInput } from "./recovery";
import { applySteps, type Step } from "./settle";
import { intentCursor, lockIntentState } from "./transition";

export const reconcilableStates: readonly IntentState[] = [
  "submitted",
  "unknown",
  "open_verifying",
  "open_verified",
  "recovery_required",
];

const isOpenState = (state: IntentState): state is OpenState =>
  state === "open_verifying" || state === "open_verified" || state === "recovery_required";

type Pass = {
  context: IntentContext;
  rows: readonly ExchangeOrderRow[];
  times: Milestones;
  observation: Observation;
  ours: readonly AttributedFill[];
  at: number;
};

type Judgment = { state: IntentState; recovery: RecoveryInput | null };

function traced(pass: Pass): boolean {
  const { account } = pass.observation;
  const ids = new Set(pass.rows.map((row) => row.clientOrderId));
  return (
    pass.ours.length > 0 ||
    account.positions.some((position) => !new Decimal(position.signedSize).isZero()) ||
    account.openOrders.some(
      (order) =>
        ids.has(order.clientOrderId) || order.strategyId === pass.context.intent.strategyId,
    )
  );
}

function legsOf(pass: Pass) {
  const { intent, plan } = pass.context;
  const side = plan.direction === "long" ? "sell" : "buy";
  const leg = (role: "stop" | "target", triggerPrice: string) => {
    const expected: LegExpectation = {
      clientOrderId: clientOrderIdFor(intent.id, role),
      strategyId: intent.strategyId,
      side,
      triggerPrice,
    };
    return { leg: pass.observation.orders.get(role) ?? null, expected };
  };
  return [leg("stop", plan.stopPrice), leg("target", plan.targetPrice)];
}

async function judge(tx: Tx, pass: Pass): Promise<Judgment> {
  const { context, observation, at } = pass;
  const locked = await lockIntentState(tx, context.intent.id);
  if (locked !== context.intent.state) {
    return { state: locked ?? context.intent.state, recovery: null };
  }
  for (const row of pass.rows) {
    const snapshot = observation.orders.get(row.role);
    if (snapshot !== undefined) {
      await recordSnapshot(tx, row, snapshot);
    }
  }
  await storeFills(tx, context.intent.id, pass.ours);
  const cursor = intentCursor(tx, intentRef(context), at);
  const orders = [...observation.orders.values()];
  const apply = (steps: readonly Step[]) => applySteps(tx, { context, cursor, steps, orders, at });
  const pause = (cause: string) =>
    pauseConnection(tx, {
      connectionId: context.connection.id,
      intentId: context.intent.id,
      environment: context.connection.environment,
      at,
      cause,
    });

  if (cursor.state === "submitted" || cursor.state === "unknown") {
    const verdict = entryVerdict({
      state: cursor.state,
      entry: observation.orders.get("entry") ?? null,
      sinceSubmitMs: at - pass.times.submittedAt,
      traced: traced(pass),
    });
    await apply(verdict.steps);
    if (verdict.pause) {
      await pause("the entry cannot be found by its client ID, yet the account shows activity");
    }
  }
  if (!isOpenState(cursor.state)) {
    return { state: cursor.state, recovery: null };
  }
  const buying = context.plan.direction === "long";
  const signedSize =
    observation.account.positions.find((position) => position.symbol === context.intent.market)
      ?.signedSize ?? "0";
  const position = heldPosition(signedSize, buying);
  const facts = fillFacts(observation.fills, pass.ours, buying ? "buy" : "sell");
  const verdict = openVerdict({
    state: cursor.state,
    positionSize: position.size,
    oppositePosition: position.opposite,
    exits: summarizeExits(legsOf(pass), position.size),
    flatByFills: facts.flatByFills,
    sinceFillMs: at - (pass.times.filledAt ?? at),
  });
  await apply(verdict.steps);
  if (verdict.pause) {
    await pause("the account holds a position opposite to this plan");
  }
  const recovering = verdict.recover && cursor.state === "recovery_required";
  return {
    state: cursor.state,
    recovery: recovering
      ? {
          context,
          rows: pass.rows,
          observation,
          positionSize: position.size,
          openSize: facts.openSize,
        }
      : null,
  };
}

export async function reconcileIntent(deps: WorkerDeps, intentId: string): Promise<IntentState> {
  const context = await loadIntentContext(deps.db, intentId);
  if (!reconcilableStates.includes(context.intent.state)) {
    return context.intent.state;
  }
  const client = deps.strikeFor(context.connection);
  const [rows, times] = await Promise.all([
    loadOrderRows(deps.db, intentId),
    milestones(deps.db, intentId),
  ]);
  const observation = await observe(client, context, rows);
  const pass: Pass = {
    context,
    rows,
    times,
    observation,
    ours: attributeFills(observation.fills, rows),
    at: deps.now(),
  };
  const judgment = await deps.db.transaction((tx) => judge(tx, pass));
  if (judgment.recovery !== null) {
    await recover(deps, client, judgment.recovery);
  }
  return judgment.state;
}
