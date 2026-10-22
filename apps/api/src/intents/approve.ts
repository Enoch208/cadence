import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import {
  canonicalJson,
  nextIntentState,
  sha256Hex,
  strategyIdFor,
  type CadenceExposure,
  type Proposal,
  type RiskPolicy,
} from "@cadence/core";
import {
  accountConnections,
  executionIntents,
  loadExposure,
  outbox,
  planVersions,
  plans,
  previews,
  reservations,
  riskPolicies,
  type Tx,
} from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict, notFound } from "../http/errors";

const missingPreview = () => notFound("That preview does not exist.");

async function lockedContext(tx: Tx, userId: string, previewId: string) {
  const [preview] = await tx
    .select()
    .from(previews)
    .where(and(eq(previews.id, previewId), eq(previews.userId, userId)));
  if (preview === undefined) {
    throw missingPreview();
  }
  const [account] = await tx
    .select()
    .from(accountConnections)
    .where(eq(accountConnections.id, preview.accountConnectionId))
    .for("update");
  const [planned] = await tx
    .select({ plan: plans, version: planVersions })
    .from(planVersions)
    .innerJoin(plans, eq(plans.id, planVersions.planId))
    .where(eq(planVersions.id, preview.planVersionId));
  const [policy] = await tx
    .select()
    .from(riskPolicies)
    .where(eq(riskPolicies.id, preview.policyId));
  if (account === undefined || planned === undefined || policy === undefined) {
    throw new Error(`Preview ${previewId} refers to rows that do not exist`);
  }
  return { preview, account, ...planned, policy };
}

type Context = Awaited<ReturnType<typeof lockedContext>>;

function requireAdmissible(context: Context, now: number) {
  const { preview, account, plan, version } = context;
  if (now >= preview.expiresAt) {
    throw conflict("PREVIEW_EXPIRED", "This preview is more than 15 seconds old. Preview again.");
  }
  if (preview.decision.outcome === "BLOCKED") {
    throw conflict("PREVIEW_BLOCKED", "This preview cannot be executed. Preview again to see why.");
  }
  if (account.status !== "active") {
    throw conflict(
      account.status === "paused" ? "ACCOUNT_PAUSED" : "ACCOUNT_DISCONNECTED",
      `This account is ${account.status}, so it cannot take new entries.`,
    );
  }
  if (plan.status === "revoked") {
    throw conflict("PLAN_REVOKED", "The curator revoked this plan.");
  }
  if (plan.currentVersion !== version.version) {
    throw conflict("PLAN_SUPERSEDED", "The curator published a newer version. Preview it again.");
  }
  return preview.decision.proposal;
}

function requireBudget(exposure: CadenceExposure, policy: RiskPolicy, proposal: Proposal) {
  const committed = new Decimal(exposure.committedRisk).plus(proposal.plannedLoss);
  const sessionUsed = committed.plus(exposure.realizedSessionLoss);
  if (
    committed.greaterThan(policy.aggregateBudget) ||
    sessionUsed.greaterThan(policy.sessionBudget)
  ) {
    throw conflict(
      "RISK_BUDGET_EXHAUSTED",
      "Approving this would take your planned risk past your budget. Wait for an open plan to finish.",
    );
  }
}

const consentDigest = (context: Context, proposal: Proposal) =>
  sha256Hex(
    canonicalJson({
      previewId: context.preview.id,
      accountConnectionId: context.account.id,
      planVersionId: context.version.id,
      planDigest: context.version.digest,
      policyId: context.policy.id,
      policyVersion: context.policy.version,
      quantityCeiling: context.preview.quantityCeiling,
      proposal,
    }),
  );

async function reserve(deps: AppDeps, tx: Tx, context: Context, proposal: Proposal) {
  const state = nextIntentState("prepared", "approved");
  if (state === null) {
    throw new Error("The lifecycle no longer allows approving a prepared intent");
  }
  const id = randomUUID();
  const now = deps.now();
  const { preview, version } = context;
  const { accountConnectionId } = preview;
  await tx.insert(executionIntents).values({
    id,
    userId: preview.userId,
    accountConnectionId,
    planVersionId: version.id,
    previewId: preview.id,
    policyId: preview.policyId,
    market: version.payload.market,
    approved: proposal,
    approvedDigest: consentDigest(context, proposal),
    state,
    strategyId: strategyIdFor(id),
    createdAt: now,
    updatedAt: now,
  });
  const { plannedLoss, initialMargin } = proposal;
  await tx
    .insert(reservations)
    .values({ intentId: id, accountConnectionId, plannedLoss, initialMargin });
  await tx
    .insert(outbox)
    .values({ kind: "submit", intentId: id, accountConnectionId, nextAttemptAt: now });
  return id;
}

export function approvePreview(deps: AppDeps, userId: string, previewId: string) {
  return deps.db.transaction(async (tx) => {
    const context = await lockedContext(tx, userId, previewId);
    const [existing] = await tx
      .select({ id: executionIntents.id })
      .from(executionIntents)
      .where(
        and(
          eq(executionIntents.accountConnectionId, context.account.id),
          eq(executionIntents.planVersionId, context.version.id),
        ),
      );
    if (existing !== undefined) {
      return { id: existing.id, created: false };
    }
    const now = deps.now();
    const proposal = requireAdmissible(context, now);
    const exposure = await loadExposure(tx, context.account.id, now);
    if (exposure.busySymbols.includes(context.version.payload.market)) {
      throw conflict(
        "SYMBOL_BUSY",
        "This account already has an open Cadence plan on this market.",
      );
    }
    requireBudget(exposure, context.policy.policy, proposal);
    const id = await reserve(deps, tx, context, proposal);
    await recordEvent(tx, {
      at: now,
      actor: userActor(userId),
      correlationId: id,
      environment: context.account.environment,
      type: "intent_reserved",
      data: {
        previewId,
        quantity: proposal.quantity,
        limitPrice: proposal.limitPrice,
        plannedLoss: proposal.plannedLoss,
      },
    });
    return { id, created: true };
  });
}
