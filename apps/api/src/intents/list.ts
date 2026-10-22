import { desc, eq } from "drizzle-orm";
import {
  accountConnections,
  executionIntents,
  planVersions,
  plans,
  receipts,
  type Executor,
} from "@cadence/db";

export const listLimit = 50;

export async function listIntents(db: Executor, userId: string) {
  const rows = await db
    .select({
      intent: executionIntents,
      environment: accountConnections.environment,
      terms: planVersions.payload,
      planVersion: planVersions.version,
      planPublicId: plans.publicId,
      receiptId: receipts.id,
    })
    .from(executionIntents)
    .innerJoin(accountConnections, eq(accountConnections.id, executionIntents.accountConnectionId))
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .innerJoin(plans, eq(plans.id, planVersions.planId))
    .leftJoin(receipts, eq(receipts.intentId, executionIntents.id))
    .where(eq(executionIntents.userId, userId))
    .orderBy(desc(executionIntents.createdAt), desc(executionIntents.id))
    .limit(listLimit);
  return rows.map(({ intent, environment, terms, planVersion, planPublicId, receiptId }) => ({
    id: intent.id,
    state: intent.state,
    environment,
    market: intent.market,
    direction: terms.direction,
    planPublicId,
    planVersion,
    quantity: intent.approved.quantity,
    limitPrice: intent.approved.limitPrice,
    plannedLoss: intent.approved.plannedLoss,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    receiptReady: receiptId !== null,
  }));
}
