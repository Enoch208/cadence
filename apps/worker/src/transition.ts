import { and, eq, sql } from "drizzle-orm";
import {
  nextIntentState,
  terminalIntentStates,
  type Environment,
  type IntentEvent,
  type IntentState,
} from "@cadence/core";
import { executionIntents, type Tx } from "@cadence/db";
import { recordEvent, type EventData } from "./events";
import { queueNotification, worthAnnouncing } from "./notify-queue";

export class IllegalTransitionError extends Error {
  override readonly name = "IllegalTransitionError";

  constructor(intentId: string, state: IntentState, event: IntentEvent) {
    super(`Intent ${intentId} cannot take ${event} while ${state}`);
  }
}

export class StaleIntentError extends Error {
  override readonly name = "StaleIntentError";

  constructor(intentId: string, expected: IntentState) {
    super(`Intent ${intentId} left ${expected} while the worker was acting on it`);
  }
}

export type IntentRef = { id: string; state: IntentState; environment: Environment };

export type IntentCursor = {
  readonly state: IntentState;
  readonly finished: boolean;
  apply(event: IntentEvent, data?: EventData): Promise<IntentState>;
};

export function intentCursor(tx: Tx, intent: IntentRef, at: number): IntentCursor {
  let state = intent.state;
  return {
    get state() {
      return state;
    },
    get finished() {
      return terminalIntentStates.includes(state);
    },
    async apply(event, data = {}) {
      const next = nextIntentState(state, event);
      if (next === null) {
        throw new IllegalTransitionError(intent.id, state, event);
      }
      const moved = await tx
        .update(executionIntents)
        .set({ state: next, updatedAt: sql`greatest(${executionIntents.updatedAt}, ${at})` })
        .where(and(eq(executionIntents.id, intent.id), eq(executionIntents.state, state)))
        .returning({ id: executionIntents.id });
      if (moved.length === 0) {
        throw new StaleIntentError(intent.id, state);
      }
      await recordEvent(tx, {
        at,
        correlationId: intent.id,
        environment: intent.environment,
        type: event,
        data: { from: state, to: next, ...data },
      });
      if (worthAnnouncing(event, next)) {
        await queueNotification(tx, intent.id, next, at);
      }
      state = next;
      return next;
    },
  };
}

export async function lockIntentState(tx: Tx, intentId: string): Promise<IntentState | null> {
  const [row] = await tx
    .select({ state: executionIntents.state })
    .from(executionIntents)
    .where(eq(executionIntents.id, intentId))
    .for("update");
  return row?.state ?? null;
}
