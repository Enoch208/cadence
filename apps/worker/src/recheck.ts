import { and, count, eq, inArray, ne } from "drizzle-orm";
import {
  decide,
  freshness,
  type Decision,
  type DecisionInput,
  type IntentState,
  type Proposal,
} from "@cadence/core";
import {
  builderApprovalOf,
  executionIntents,
  loadExposure,
  reservations,
  type Executor,
} from "@cadence/db";
import { readDecisionSnapshot, type StrikeClient } from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { envelopeBreach, exposureBesides } from "./envelope";
import type { EventData } from "./events";
import type { IntentContext } from "./intent-context";

export type Refusal = { event: "validation_failed" | "entry_window_closed"; data: EventData };

export type Recheck =
  | { kind: "send"; proposal: Proposal; decision: Exclude<Decision, { outcome: "BLOCKED" }> }
  | { kind: "refuse"; refusal: Refusal };

const unresolvedStates: IntentState[] = ["unknown", "recovery_required"];

const refuse = (data: EventData): Recheck => ({
  kind: "refuse",
  refusal: { event: "validation_failed", data },
});

async function reservedLoss(db: Executor, intentId: string): Promise<string> {
  const [held] = await db
    .select({ plannedLoss: reservations.plannedLoss })
    .from(reservations)
    .where(and(eq(reservations.intentId, intentId), eq(reservations.status, "active")));
  return held?.plannedLoss ?? "0";
}

async function siblingsUnresolved(db: Executor, context: IntentContext): Promise<boolean> {
  const [row] = await db
    .select({ unresolved: count() })
    .from(executionIntents)
    .where(
      and(
        eq(executionIntents.accountConnectionId, context.connection.id),
        ne(executionIntents.id, context.intent.id),
        inArray(executionIntents.state, unresolvedStates),
      ),
    );
  return (row?.unresolved ?? 0) > 0;
}

async function decisionInputFor(
  deps: WorkerDeps,
  client: StrikeClient,
  context: IntentContext,
): Promise<DecisionInput> {
  const { intent, connection, planRow, version } = context;
  const [snapshot, exposure, ownLoss, unresolved] = await Promise.all([
    readDecisionSnapshot(client, intent.market),
    loadExposure(deps.db, connection.id, deps.now()),
    reservedLoss(deps.db, intent.id),
    siblingsUnresolved(deps.db, context),
  ]);
  return {
    plan: context.plan,
    admission: {
      status: planRow.status === "revoked" ? "revoked" : "published",
      isCurrentVersion: planRow.currentVersion === version.version,
    },
    policy: context.policy,
    quantityCeiling: intent.approved.quantity,
    ...snapshot,
    accountReconciled: !unresolved,
    builderApproval: builderApprovalOf(connection),
    exposure: exposureBesides(exposure, { market: intent.market, reservedLoss: ownLoss }),
    now: deps.now(),
  };
}

const onlyExpired = (decision: Decision) =>
  decision.reasons.length === 1 && decision.reasons[0] === "PLAN_EXPIRED";

export async function recheckIntent(
  deps: WorkerDeps,
  client: StrikeClient,
  context: IntentContext,
): Promise<Recheck> {
  if (context.connection.status !== "active") {
    return refuse({
      refusal: "connection_not_active",
      connectionStatus: context.connection.status,
    });
  }
  if (deps.now() - context.intent.createdAt > freshness.previewValidityMs) {
    return refuse({ refusal: "approval_stale", approvedAt: context.intent.createdAt });
  }
  const input = await decisionInputFor(deps, client, context);
  const decision = decide(input);
  if (decision.outcome === "BLOCKED") {
    const data = { reasons: decision.reasons, evaluatedAt: input.now };
    return onlyExpired(decision)
      ? { kind: "refuse", refusal: { event: "entry_window_closed", data } }
      : refuse(data);
  }
  const breach = envelopeBreach({
    approved: context.intent.approved,
    proposal: decision.proposal,
    direction: context.plan.direction,
    environment: context.connection.environment,
    liveMaxNotional: deps.liveMaxNotional,
  });
  if (breach !== null) {
    return refuse({
      refusal: breach,
      approvedQuantity: context.intent.approved.quantity,
      approvedLimitPrice: context.intent.approved.limitPrice,
      quantity: decision.proposal.quantity,
      limitPrice: decision.proposal.limitPrice,
    });
  }
  return { kind: "send", proposal: decision.proposal, decision };
}
