import { canonicalJson, decide, freshness, sha256Hex, type DecimalString } from "@cadence/core";
import { previews } from "@cadence/db";
import { ownedAccount } from "../accounts/service";
import type { AppDeps } from "../deps";
import { conflict } from "../http/errors";
import { currentPlanVersion } from "../plan/public";
import { ensurePolicy } from "../policies/service";
import { gatherDecisionInput } from "./gather";

export async function createPreview(
  deps: AppDeps,
  userId: string,
  request: { planPublicId: string; accountId: string; quantityCeiling: DecimalString | null },
) {
  const account = await ownedAccount(deps.db, userId, request.accountId);
  if (account.status !== "active") {
    throw conflict(
      account.status === "paused" ? "ACCOUNT_PAUSED" : "ACCOUNT_DISCONNECTED",
      account.status === "paused"
        ? "This account is paused. Resume it to preview new entries."
        : "This account is disconnected. Connect it again to preview new entries.",
    );
  }
  const { plan, version } = await currentPlanVersion(deps.db, request.planPublicId);
  const policy = await ensurePolicy(deps, userId);
  const input = await gatherDecisionInput(deps, {
    account,
    plan,
    version,
    policy: policy.policy,
    quantityCeiling: request.quantityCeiling,
  });
  const decision = decide(input);
  const expiresAt = input.now + freshness.previewValidityMs;
  const [stored] = await deps.db
    .insert(previews)
    .values({
      userId,
      accountConnectionId: account.id,
      planVersionId: version.id,
      policyId: policy.id,
      quantityCeiling: request.quantityCeiling,
      decision,
      inputDigest: sha256Hex(canonicalJson(input)),
      createdAt: input.now,
      expiresAt,
    })
    .returning({ id: previews.id });
  if (stored === undefined) {
    throw new Error("Inserting a preview returned no row");
  }
  return { previewId: stored.id, expiresAt, decision };
}
