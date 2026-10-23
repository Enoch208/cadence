import { and, eq, inArray } from "drizzle-orm";
import type { DecimalString, DecisionInput, RiskPolicy } from "@cadence/core";
import {
  builderApprovalOf,
  CredentialVaultError,
  executionIntents,
  loadExposure,
  type AccountConnectionRow,
  type Executor,
  type PlanRow,
  type PlanVersionRow,
} from "@cadence/db";
import { readDecisionSnapshot, type StrikeClient } from "@cadence/strike";
import type { AppDeps } from "../deps";
import { conflict } from "../http/errors";
import { askStrike } from "../http/strike";
import { liveQuantityCeiling } from "./live-ceiling";

const unresolvedStates = ["unknown", "recovery_required"] as const;

export async function accountReconciled(db: Executor, accountConnectionId: string) {
  const [unresolved] = await db
    .select({ id: executionIntents.id })
    .from(executionIntents)
    .where(
      and(
        eq(executionIntents.accountConnectionId, accountConnectionId),
        inArray(executionIntents.state, [...unresolvedStates]),
      ),
    )
    .limit(1);
  return unresolved === undefined;
}

function exchangeFor(deps: AppDeps, account: AccountConnectionRow): StrikeClient {
  try {
    return deps.strike.forConnection(account);
  } catch (error) {
    if (error instanceof CredentialVaultError) {
      throw conflict(
        "ACCOUNT_KEY_UNREADABLE",
        "Cadence can no longer open this account's key. Connect the account again.",
      );
    }
    throw error;
  }
}

export async function gatherDecisionInput(
  deps: AppDeps,
  args: {
    account: AccountConnectionRow;
    plan: PlanRow;
    version: PlanVersionRow;
    policy: RiskPolicy;
    quantityCeiling: DecimalString | null;
  },
): Promise<DecisionInput> {
  const { account, plan, version } = args;
  const snapshot = await askStrike("read your account and the market", () =>
    readDecisionSnapshot(exchangeFor(deps, account), version.payload.market),
  );
  const now = deps.now();
  return {
    plan: version.payload,
    admission: {
      status: plan.status === "revoked" ? "revoked" : "published",
      isCurrentVersion: plan.currentVersion === version.version,
    },
    policy: args.policy,
    quantityCeiling: liveQuantityCeiling({
      environment: account.environment,
      requested: args.quantityCeiling,
      entryMax: version.payload.entryMax,
      liveMaxNotional: deps.env.CADENCE_LIVE_MAX_NOTIONAL,
      step: snapshot.market.limitStepSize,
    }),
    accountState: snapshot.accountState,
    accountReconciled: await accountReconciled(deps.db, account.id),
    builderApproval: builderApprovalOf(account),
    exposure: await loadExposure(deps.db, account.id, now),
    market: snapshot.market,
    book: snapshot.book,
    mark: snapshot.mark,
    fees: snapshot.fees,
    now,
  };
}
