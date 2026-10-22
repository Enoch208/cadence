import type { ExchangeOrderSnapshot, IntentEvent, IntentState } from "@cadence/core";
import type { Tx } from "@cadence/db";
import type { EventData } from "./events";
import type { IntentContext } from "./intent-context";
import { intentRef } from "./intent-context";
import { releaseReservation } from "./ledger";
import { storeReceipt } from "./receipts";
import { intentCursor, type IntentCursor } from "./transition";

export type Step = { event: IntentEvent; data?: EventData };

export async function applySteps(
  tx: Tx,
  args: {
    context: IntentContext;
    cursor: IntentCursor;
    steps: readonly Step[];
    orders: readonly ExchangeOrderSnapshot[];
    at: number;
  },
): Promise<IntentState> {
  const { context, cursor, at } = args;
  for (const step of args.steps) {
    await cursor.apply(step.event, step.data);
    if (cursor.finished) {
      await releaseReservation(tx, context.intent.id, at);
      await storeReceipt(tx, { context, state: cursor.state, orders: args.orders, at });
    }
  }
  return cursor.state;
}

export const settle = (
  tx: Tx,
  context: IntentContext,
  state: IntentState,
  step: Step,
  at: number,
): Promise<IntentState> =>
  applySteps(tx, {
    context,
    cursor: intentCursor(tx, { ...intentRef(context), state }, at),
    steps: [step],
    orders: [],
    at,
  });
