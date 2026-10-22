import { eq } from "drizzle-orm";
import {
  publishedPlanSchema,
  riskPolicySchema,
  type PublishedPlan,
  type RiskPolicy,
} from "@cadence/core";
import {
  accountConnections,
  executionIntents,
  planVersions,
  plans,
  previews,
  riskPolicies,
  type AccountConnectionRow,
  type ExecutionIntentRow,
  type Executor,
  type PlanRow,
  type PlanVersionRow,
  type PreviewRow,
} from "@cadence/db";
import type { IntentRef } from "./transition";

export type IntentContext = {
  intent: ExecutionIntentRow;
  connection: AccountConnectionRow;
  plan: PublishedPlan;
  planRow: Pick<PlanRow, "publicId" | "status" | "currentVersion">;
  version: Pick<PlanVersionRow, "version" | "digest">;
  policy: RiskPolicy;
  policyVersion: number;
  preview: Pick<PreviewRow, "decision" | "expiresAt">;
};

export class MissingIntentError extends Error {
  override readonly name = "MissingIntentError";

  constructor(intentId: string) {
    super(`There is no execution intent ${intentId}`);
  }
}

export async function loadIntentContext(db: Executor, intentId: string): Promise<IntentContext> {
  const [row] = await db
    .select({
      intent: executionIntents,
      connection: accountConnections,
      payload: planVersions.payload,
      version: { version: planVersions.version, digest: planVersions.digest },
      planRow: {
        publicId: plans.publicId,
        status: plans.status,
        currentVersion: plans.currentVersion,
      },
      policy: riskPolicies.policy,
      policyVersion: riskPolicies.version,
      preview: { decision: previews.decision, expiresAt: previews.expiresAt },
    })
    .from(executionIntents)
    .innerJoin(accountConnections, eq(accountConnections.id, executionIntents.accountConnectionId))
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .innerJoin(plans, eq(plans.id, planVersions.planId))
    .innerJoin(riskPolicies, eq(riskPolicies.id, executionIntents.policyId))
    .innerJoin(previews, eq(previews.id, executionIntents.previewId))
    .where(eq(executionIntents.id, intentId));
  if (row === undefined) {
    throw new MissingIntentError(intentId);
  }
  const { payload, policy, ...rest } = row;
  return {
    ...rest,
    plan: publishedPlanSchema.parse(payload),
    policy: riskPolicySchema.parse(policy),
  };
}

export const intentRef = (context: IntentContext): IntentRef => ({
  id: context.intent.id,
  state: context.intent.state,
  environment: context.connection.environment,
});
