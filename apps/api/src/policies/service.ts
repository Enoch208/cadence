import { desc, eq, max } from "drizzle-orm";
import { riskPolicySchema, type RiskPolicy } from "@cadence/core";
import { riskPolicies, users, type Executor, type RiskPolicyRow } from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { describeIssues } from "../http/body";
import { unprocessable } from "../http/errors";

export const houseAssumptions = {
  maxEntrySlippageBps: 20,
  stopSlippageReserveBps: 50,
  fundingHorizonHours: 24,
  liquidationBufferBps: 100,
  allowedMarkets: ["BTC-USD", "ETH-USD"],
};

export const defaultBudgets = {
  perTradeBudget: "20",
  aggregateBudget: "60",
  sessionBudget: "40",
  leverageCap: 5,
  minRewardRisk: "1.5",
};

export const defaultPolicy: RiskPolicy = riskPolicySchema.parse({
  version: 1,
  ...defaultBudgets,
  ...houseAssumptions,
});

export async function latestPolicy(db: Executor, userId: string): Promise<RiskPolicyRow | null> {
  const [row] = await db
    .select()
    .from(riskPolicies)
    .where(eq(riskPolicies.userId, userId))
    .orderBy(desc(riskPolicies.version))
    .limit(1);
  return row ?? null;
}

export const effectivePolicy = async (db: Executor, userId: string): Promise<RiskPolicy> =>
  (await latestPolicy(db, userId))?.policy ?? defaultPolicy;

async function lockUser(db: Executor, userId: string): Promise<void> {
  await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
}

async function insertPolicy(
  deps: AppDeps,
  db: Executor,
  userId: string,
  policy: (version: number) => unknown,
): Promise<RiskPolicyRow> {
  const [current] = await db
    .select({ version: max(riskPolicies.version) })
    .from(riskPolicies)
    .where(eq(riskPolicies.userId, userId));
  const version = (current?.version ?? 0) + 1;
  const parsed = riskPolicySchema.safeParse(policy(version));
  if (!parsed.success) {
    throw unprocessable("POLICY_INVALID", describeIssues(parsed.error));
  }
  const [row] = await db
    .insert(riskPolicies)
    .values({ userId, version, policy: parsed.data, createdAt: deps.now() })
    .returning();
  if (row === undefined) {
    throw new Error("Inserting a risk policy returned no row");
  }
  await recordEvent(db, {
    at: deps.now(),
    actor: userActor(userId),
    correlationId: row.id,
    environment: null,
    type: "policy_saved",
    data: { version },
  });
  return row;
}

export const savePolicy = (deps: AppDeps, userId: string, budgets: Record<string, unknown>) =>
  deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    return insertPolicy(deps, tx, userId, (version) => ({
      ...budgets,
      ...houseAssumptions,
      version,
    }));
  });

export async function ensurePolicy(deps: AppDeps, userId: string): Promise<RiskPolicyRow> {
  const saved = await latestPolicy(deps.db, userId);
  if (saved !== null) {
    return saved;
  }
  return deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const raced = await latestPolicy(tx, userId);
    return raced ?? insertPolicy(deps, tx, userId, (version) => ({ ...defaultPolicy, version }));
  });
}
