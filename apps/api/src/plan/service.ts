import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { planVersionDigest, type PublishedPlan } from "@cadence/core";
import { planVersions, plans, type PlanRow } from "@cadence/db";
import { requirePublisher } from "../communities/service";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict, notFound } from "../http/errors";
import { postPlanCard } from "./announce";
import { admissiblePlan } from "./fields";

const publicIdAlphabet = "0123456789abcdefghjkmnpqrstvwxyz";
export const publicIdShape = /^[0-9a-hjkmnp-tv-z]{12}$/;

const newPublicId = () =>
  Array.from(randomBytes(12), (byte) => publicIdAlphabet.charAt(byte & 31)).join("");

const missingPlan = () => notFound("That plan does not exist.");
const revokedPlan = () =>
  conflict("PLAN_REVOKED", "This plan was revoked and cannot be published.");

const draftView = (plan: PlanRow) => ({
  id: plan.id,
  publicId: plan.publicId,
  status: plan.status,
  currentVersion: plan.currentVersion,
  draft: plan.draft,
});

async function findPlan(deps: AppDeps, planId: string): Promise<PlanRow> {
  const [plan] = await deps.db.select().from(plans).where(eq(plans.id, planId));
  if (plan === undefined) {
    throw missingPlan();
  }
  return plan;
}

export async function createDraft(
  deps: AppDeps,
  userId: string,
  input: { communityId: string; fields: Record<string, unknown> },
) {
  await requirePublisher(deps.db, input.communityId, userId);
  const draft = await admissiblePlan(deps, input.fields, null);
  return deps.db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({
        publicId: newPublicId(),
        communityId: input.communityId,
        authorUserId: userId,
        draft,
        createdAt: deps.now(),
      })
      .returning();
    if (plan === undefined) {
      throw new Error("Inserting a plan returned no row");
    }
    await recordEvent(tx, {
      at: deps.now(),
      actor: userActor(userId),
      correlationId: plan.id,
      environment: draft.environment,
      type: "plan_drafted",
      data: { publicId: plan.publicId },
    });
    return draftView(plan);
  });
}

async function insertNextVersion(
  deps: AppDeps,
  userId: string,
  planId: string,
  payload: PublishedPlan,
) {
  const digest = planVersionDigest(payload);
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(plans).where(eq(plans.id, planId)).for("update");
    if (locked === undefined) {
      throw missingPlan();
    }
    if (locked.status === "revoked") {
      throw revokedPlan();
    }
    const [current] = await tx
      .select({ digest: planVersions.digest })
      .from(planVersions)
      .where(and(eq(planVersions.planId, planId), eq(planVersions.version, locked.currentVersion)));
    if (current?.digest === digest) {
      throw conflict(
        "PLAN_UNCHANGED",
        `Version ${String(locked.currentVersion)} already has exactly these terms.`,
      );
    }
    const version = locked.currentVersion + 1;
    await tx.insert(planVersions).values({
      planId,
      version,
      payload,
      digest,
      publishedAt: deps.now(),
      entryExpiresAt: Date.parse(payload.entryExpiresAt),
    });
    await tx
      .update(plans)
      .set({ status: "published", currentVersion: version, draft: payload })
      .where(eq(plans.id, planId));
    await recordEvent(tx, {
      at: deps.now(),
      actor: userActor(userId),
      correlationId: planId,
      environment: payload.environment,
      type: "plan_published",
      data: { version, digest },
    });
    return { version, digest };
  });
}

export async function publishPlan(
  deps: AppDeps,
  userId: string,
  planId: string,
  fields: Record<string, unknown> | undefined,
) {
  const plan = await findPlan(deps, planId);
  const community = await requirePublisher(deps.db, plan.communityId, userId);
  if (plan.status === "revoked") {
    throw revokedPlan();
  }
  const payload = await admissiblePlan(deps, fields ?? plan.draft, plan.draft.environment);
  const { version, digest } = await insertNextVersion(deps, userId, planId, payload);
  const posted = await postPlanCard(deps, { plan, community, payload, version, userId });
  return { publicId: plan.publicId, version, digest, card: { posted } };
}

export async function revokePlan(deps: AppDeps, userId: string, planId: string) {
  const plan = await findPlan(deps, planId);
  await requirePublisher(deps.db, plan.communityId, userId);
  await deps.db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(plans)
      .set({ status: "revoked" })
      .where(and(eq(plans.id, planId), ne(plans.status, "revoked")))
      .returning({ id: plans.id });
    if (revoked !== undefined) {
      await recordEvent(tx, {
        at: deps.now(),
        actor: userActor(userId),
        correlationId: planId,
        environment: plan.draft.environment,
        type: "plan_revoked",
        data: { version: plan.currentVersion },
      });
    }
  });
  return { publicId: plan.publicId, status: "revoked" as const };
}
