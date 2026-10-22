import { and, desc, eq } from "drizzle-orm";
import { communities, planVersions, plans, type Executor, type PlanVersionRow } from "@cadence/db";
import { notFound } from "../http/errors";

const unpublished = () => notFound("This plan does not exist or has not been published yet.");

const versionSummary = (row: PlanVersionRow) => ({
  version: row.version,
  digest: row.digest,
  publishedAt: row.publishedAt,
});

const versionView = (row: PlanVersionRow) => ({ ...versionSummary(row), plan: row.payload });

async function publishedPlan(db: Executor, publicId: string) {
  const [row] = await db
    .select({
      id: plans.id,
      publicId: plans.publicId,
      status: plans.status,
      currentVersion: plans.currentVersion,
      communityName: communities.name,
    })
    .from(plans)
    .innerJoin(communities, eq(communities.id, plans.communityId))
    .where(eq(plans.publicId, publicId));
  if (row === undefined || row.currentVersion === 0) {
    throw unpublished();
  }
  return row;
}

export async function readPublicPlan(db: Executor, publicId: string) {
  const plan = await publishedPlan(db, publicId);
  const versions = await db
    .select()
    .from(planVersions)
    .where(eq(planVersions.planId, plan.id))
    .orderBy(desc(planVersions.version));
  const current = versions.find((row) => row.version === plan.currentVersion);
  if (current === undefined) {
    throw new Error(`Plan ${plan.publicId} has no row for its current version`);
  }
  return {
    publicId: plan.publicId,
    status: plan.status,
    communityName: plan.communityName,
    current: versionView(current),
    versions: versions.map(versionSummary),
  };
}

export async function readPublicPlanVersion(db: Executor, publicId: string, version: number) {
  const plan = await publishedPlan(db, publicId);
  const [row] = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.planId, plan.id), eq(planVersions.version, version)));
  if (row === undefined) {
    throw notFound(`This plan has no version ${String(version)}.`);
  }
  return versionView(row);
}
