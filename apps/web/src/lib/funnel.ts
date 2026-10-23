import type { AuthoredPlan } from "./api/schemas";
import { curatorFeeNotYetLive, curatorFeeRate } from "./copy/curator-fee";
import { formatUsd } from "./format";

const members = (count: number) => `${String(count)} member${count === 1 ? "" : "s"}`;

const filledWhere: Record<AuthoredPlan["environment"], string> = {
  live: "filled on Strike",
  replay: "filled in replay",
};

export function funnelLine({ funnel, environment }: Pick<AuthoredPlan, "funnel" | "environment">) {
  if (funnel.previewed === 0) {
    return "No member has previewed it yet.";
  }
  return `${members(funnel.previewed)} previewed · ${String(funnel.couldTake)} could take it · ${String(funnel.approved)} approved · ${String(funnel.filled)} ${filledWhere[environment]}`;
}

const fillCount = (count: number) => `${String(count)} fill${count === 1 ? "" : "s"}`;

export function curatorFeesLine({
  curatorFee,
  curatorFeesEarned,
  environment,
}: Pick<AuthoredPlan, "curatorFee" | "curatorFeesEarned" | "environment">): string {
  if (curatorFee === null) {
    return "No curator fee.";
  }
  const earned = `Curator fee ${curatorFeeRate(curatorFee)}: ${formatUsd(curatorFeesEarned.computed)} earned from ${fillCount(curatorFeesEarned.fills)}, computed from the fills`;
  return environment === "live" ? `${earned}. ${curatorFeeNotYetLive}` : `${earned} in replay.`;
}
