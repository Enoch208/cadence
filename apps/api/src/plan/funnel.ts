import { countDistinct, eq, inArray, sql } from "drizzle-orm";
import { executionIntents, fills, planVersions, previews, type Executor } from "@cadence/db";

export type PlanFunnel = { previewed: number; couldTake: number; approved: number; filled: number };

export const quietFunnel: PlanFunnel = { previewed: 0, couldTake: 0, approved: 0, filled: 0 };

async function previewCounts(db: Executor, planIds: string[]) {
  return db
    .select({
      planId: planVersions.planId,
      previewed: countDistinct(previews.userId),
      couldTake:
        sql<number>`count(distinct ${previews.userId}) filter (where ${previews.decision}->>'outcome' <> 'BLOCKED')`.mapWith(
          Number,
        ),
    })
    .from(previews)
    .innerJoin(planVersions, eq(planVersions.id, previews.planVersionId))
    .where(inArray(planVersions.planId, planIds))
    .groupBy(planVersions.planId);
}

async function orderCounts(db: Executor, planIds: string[]) {
  return db
    .select({
      planId: planVersions.planId,
      approved: countDistinct(executionIntents.userId),
      filled:
        sql<number>`count(distinct ${executionIntents.userId}) filter (where exists (select 1 from ${fills} where ${fills.intentId} = ${executionIntents.id} and ${fills.role} = 'entry'))`.mapWith(
          Number,
        ),
    })
    .from(executionIntents)
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .where(inArray(planVersions.planId, planIds))
    .groupBy(planVersions.planId);
}

export async function planFunnels(
  db: Executor,
  planIds: string[],
): Promise<ReadonlyMap<string, PlanFunnel>> {
  if (planIds.length === 0) {
    return new Map();
  }
  const [previewed, ordered] = await Promise.all([
    previewCounts(db, planIds),
    orderCounts(db, planIds),
  ]);
  const funnels = new Map<string, PlanFunnel>();
  for (const row of previewed) {
    funnels.set(row.planId, { ...quietFunnel, previewed: row.previewed, couldTake: row.couldTake });
  }
  for (const row of ordered) {
    const known = funnels.get(row.planId) ?? quietFunnel;
    funnels.set(row.planId, { ...known, approved: row.approved, filled: row.filled });
  }
  return funnels;
}
