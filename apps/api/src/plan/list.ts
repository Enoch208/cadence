import { and, desc, eq } from "drizzle-orm";
import { communities, planVersions, plans, type Executor } from "@cadence/db";
import { listLimit } from "../intents/list";
import { curatorFeesEarned, noCuratorFees } from "./curator-fees";
import { planFunnels, quietFunnel } from "./funnel";

export async function listAuthoredPlans(db: Executor, userId: string) {
  const rows = await db
    .select({ plan: plans, communityName: communities.name, current: planVersions.payload })
    .from(plans)
    .innerJoin(communities, eq(communities.id, plans.communityId))
    .leftJoin(
      planVersions,
      and(eq(planVersions.planId, plans.id), eq(planVersions.version, plans.currentVersion)),
    )
    .where(eq(plans.authorUserId, userId))
    .orderBy(desc(plans.createdAt), desc(plans.id))
    .limit(listLimit);
  const planIds = rows.map(({ plan }) => plan.id);
  const [funnels, earned] = await Promise.all([
    planFunnels(db, planIds),
    curatorFeesEarned(db, planIds),
  ]);
  return rows.map(({ plan, communityName, current }) => {
    const terms = current ?? plan.draft;
    return {
      id: plan.id,
      publicId: plan.publicId,
      status: plan.status,
      environment: terms.environment,
      market: terms.market,
      direction: terms.direction,
      currentVersion: plan.currentVersion === 0 ? null : plan.currentVersion,
      entryExpiresAt: terms.entryExpiresAt,
      communityName,
      funnel: funnels.get(plan.id) ?? quietFunnel,
      curatorFee: terms.curatorFee ?? null,
      curatorFeesEarned: earned.get(plan.id) ?? noCuratorFees,
    };
  });
}
