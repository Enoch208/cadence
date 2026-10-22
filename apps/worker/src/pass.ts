import { and, asc, eq, gt, inArray, notExists } from "drizzle-orm";
import type { IntentState } from "@cadence/core";
import { executionIntents, outbox, type Db } from "@cadence/db";
import { cancelEntry } from "./cancel-entry";
import type { WorkerDeps } from "./deps";
import { logFailure, logLine } from "./log";
import {
  claimNext,
  completeItem,
  deferItem,
  leaseMs,
  reclaimExpiredClaims,
  type OutboxItem,
} from "./outbox";
import { reconcilableStates, reconcileIntent } from "./reconcile";
import { submitIntent } from "./submit";

const maxItemsPerPass = 50;

export type PassReport = {
  reclaimed: number;
  processed: number;
  reconciled: number;
  failed: number;
};

async function handle(deps: WorkerDeps, item: OutboxItem): Promise<string> {
  switch (item.kind) {
    case "submit":
      return submitIntent(deps, item.intentId);
    case "reconcile":
      return reconcileIntent(deps, item.intentId);
    case "cancel_entry":
      return cancelEntry(deps, item.intentId);
  }
}

async function drainOutbox(deps: WorkerDeps): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  while (processed + failed < maxItemsPerPass) {
    const item = await claimNext(deps.db, deps.now());
    if (item === null) {
      break;
    }
    try {
      const outcome = await handle(deps, item);
      await completeItem(deps.db, item);
      logLine(`${item.kind} ${item.intentId}: ${outcome}`);
      processed += 1;
    } catch (error) {
      logFailure(`${item.kind} ${item.intentId} (attempt ${String(item.attempts)})`, error);
      await deferItem(deps.db, item, deps.now());
      failed += 1;
    }
  }
  return { processed, failed };
}

export async function intentsToReconcile(db: Db, now: number) {
  const inFlight = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        eq(outbox.intentId, executionIntents.id),
        eq(outbox.status, "claimed"),
        gt(outbox.claimedAt, now - leaseMs),
      ),
    );
  return db
    .select({ id: executionIntents.id, state: executionIntents.state })
    .from(executionIntents)
    .where(and(inArray(executionIntents.state, [...reconcilableStates]), notExists(inFlight)))
    .orderBy(asc(executionIntents.updatedAt));
}

async function sweep(deps: WorkerDeps): Promise<{ reconciled: number; failed: number }> {
  let reconciled = 0;
  let failed = 0;
  for (const intent of await intentsToReconcile(deps.db, deps.now())) {
    try {
      const state: IntentState = await reconcileIntent(deps, intent.id);
      if (state !== intent.state) {
        logLine(`reconcile ${intent.id}: ${intent.state} -> ${state}`);
      }
      reconciled += 1;
    } catch (error) {
      logFailure(`reconcile ${intent.id}`, error);
      failed += 1;
    }
  }
  return { reconciled, failed };
}

export async function runPass(deps: WorkerDeps): Promise<PassReport> {
  const reclaimed = await reclaimExpiredClaims(deps.db, deps.now());
  if (reclaimed > 0) {
    logLine(`reclaimed ${String(reclaimed)} outbox item(s) whose lease ran out`);
  }
  const drained = await drainOutbox(deps);
  const swept = await sweep(deps);
  return {
    reclaimed,
    processed: drained.processed,
    reconciled: swept.reconciled,
    failed: drained.failed + swept.failed,
  };
}
