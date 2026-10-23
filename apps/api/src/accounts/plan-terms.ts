import type { CuratorFee } from "@cadence/core";
import type { Executor } from "@cadence/db";
import type { BuilderConnectClient, BuilderTerms } from "@cadence/strike";
import { unprocessable } from "../http/errors";
import { currentPlanVersion } from "../plan/public";

export async function curatorFeeOfPlan(db: Executor, planPublicId: string): Promise<CuratorFee> {
  const { version } = await currentPlanVersion(db, planPublicId);
  const fee = version.payload.curatorFee;
  if (fee === undefined) {
    throw unprocessable(
      "PLAN_HAS_NO_CURATOR_FEE",
      "This plan has no curator fee, so there is no curator code to connect under.",
    );
  }
  return fee;
}

export async function builderTermsFor(
  db: Executor,
  builder: BuilderConnectClient,
  planPublicId: string | null,
): Promise<BuilderTerms> {
  if (planPublicId === null) {
    return builder.ownTerms;
  }
  const fee = await curatorFeeOfPlan(db, planPublicId);
  return { builderCode: fee.builderCode, feeShareBps: fee.feeBps };
}
