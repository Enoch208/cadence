import { outbox } from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict } from "../http/errors";
import { ownedIntent } from "./read";

const closableStates: readonly string[] = ["open_verifying", "open_verified"];

export function requestClose(deps: AppDeps, userId: string, intentId: string) {
  return deps.db.transaction(async (tx) => {
    const intent = await ownedIntent(tx, userId, intentId, true);
    if (!closableStates.includes(intent.state)) {
      throw conflict("NOTHING_TO_CLOSE", "There is no open position from this order to close.");
    }
    const queued = await tx
      .insert(outbox)
      .values({
        kind: "close_position",
        intentId,
        accountConnectionId: intent.accountConnectionId,
        nextAttemptAt: deps.now(),
      })
      .onConflictDoNothing()
      .returning({ id: outbox.id });
    if (queued.length > 0) {
      await recordEvent(tx, {
        at: deps.now(),
        actor: userActor(userId),
        correlationId: intentId,
        environment: null,
        type: "close_requested",
        data: {},
      });
    }
    return { id: intentId };
  });
}
