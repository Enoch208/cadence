import { Decimal } from "decimal.js";
import { clientOrderIdFor, type ExchangeOrderSnapshot, type IntentState } from "@cadence/core";
import type { ExchangeOrderRow, Tx } from "@cadence/db";
import type { WorkerDeps } from "./deps";
import { entryVerdict } from "./entry-verdict";
import { cancelLeftoverExits } from "./close-position";
import { closeView } from "./close-view";
import { heldPosition, isLive, summarizeExits, type LegExpectation } from "./exits";
import { attributeFills, fillFacts, storeFills, type AttributedFill } from "./fills";
import { intentRef, loadIntentContext, type IntentContext } from "./intent-context";
import { pauseConnection } from "./ledger";
import { milestones, observe, type Milestones, type Observation } from "./observation";
import { openVerdict, type OpenState } from "./open-verdict";
import { loadOrderRows, recordSnapshot, rowFor } from "./order-rows";
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

type Judgment = {
  state: IntentState;
  recovery: RecoveryInput | null;
  leftoverExits: readonly string[];
};

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

function entryFromFills(pass: Pass): ExchangeOrderSnapshot | null {
  const entryFills = pass.ours.filter(({ row }) => row.role === "entry");
  const [first] = entryFills;
  if (first === undefined) {
    return null;
  }
  const { intent, plan } = pass.context;
  const filled = entryFills.reduce((total, { fill }) => total.plus(fill.size), new Decimal(0));
  return {
    orderId: first.fill.orderId,
    clientOrderId: first.row.clientOrderId,
    symbol: intent.market,
    side: plan.direction === "long" ? "buy" : "sell",
    type: "limit",
    status: filled.greaterThanOrEqualTo(intent.approved.quantity) ? "filled" : "open",
    size: intent.approved.quantity,
    filled: filled.toFixed(),
    price: intent.approved.limitPrice,
    stopPrice: null,
    reduceOnly: false,
    strategyId: intent.strategyId,
    isStrategyPrimary: true,
    closeReason: null,
  };
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
    return { state: locked ?? context.intent.state, recovery: null, leftoverExits: [] };
  }
  const entry = observation.orders.get("entry") ?? entryFromFills(pass);
  for (const row of pass.rows) {
    const snapshot = row.role === "entry" ? entry : observation.orders.get(row.role);
    if (snapshot !== undefined && snapshot !== null) {
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
      entry,
      sinceSubmitMs: at - pass.times.submittedAt,
      traced: traced(pass),
    });
    await apply(verdict.steps);
    if (verdict.pause) {
      await pause("the entry cannot be found by its client ID, yet the account shows activity");
    }
  }
  if (!isOpenState(cursor.state)) {
    return { state: cursor.state, recovery: null, leftoverExits: [] };
  }
  const buying = context.plan.direction === "long";
  const signedSize =
    observation.account.positions.find((position) => position.symbol === context.intent.market)
      ?.signedSize ?? "0";
  const position = heldPosition(signedSize, buying);
  const facts = fillFacts(observation.fills, pass.ours, buying ? "buy" : "sell");
  const closing = rowFor(pass.rows, "close") !== null;
  const legs = legsOf(pass);
  const verdict = openVerdict({
    state: cursor.state,
    positionSize: position.size,
    oppositePosition: position.opposite,
    exits: summarizeExits(legs, position.size),
    flatByFills: facts.flatByFills,
    closing,
    openSize: facts.openSize,
    sinceFillMs: at - (pass.times.filledAt ?? at),
  });
  await apply(verdict.steps);
  if (verdict.pause) {
    await pause("the account holds a position opposite to this plan");
  }
  const recovering = verdict.recover && cursor.state === "recovery_required";
  const flat = new Decimal(position.size).isZero() && !position.opposite;
  return {
    leftoverExits:
      closing && flat
        ? legs.flatMap(({ leg }) => (leg !== null && isLive(leg) ? [leg.clientOrderId] : []))
        : [],
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
  const observed = await observe(client, context, rows);
  const ours = attributeFills(observed.fills, rows, {
    openingSide: context.plan.direction === "long" ? "buy" : "sell",
    submittedAt: times.submittedAt,
    quantity: context.intent.approved.quantity,
    closeAttemptedAt: times.closeAttemptedAt,
  });
  const observation = closeView(observed, { rows, ours, context });
  const pass: Pass = { context, rows, times, observation, ours, at: deps.now() };
  const judgment = await deps.db.transaction((tx) => judge(tx, pass));
  if (judgment.recovery !== null) {
    await recover(deps, client, judgment.recovery);
  }
  if (judgment.leftoverExits.length > 0) {
    await cancelLeftoverExits(deps, client, context, judgment.leftoverExits);
  }
  return judgment.state;
}
