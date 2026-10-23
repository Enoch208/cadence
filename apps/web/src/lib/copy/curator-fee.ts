import type { CuratorFee, Environment } from "@cadence/core";

export const builderCodesUrl = "https://app.strikefinance.org/builder-codes";

export const curatorFeeNotYetLive = "Curator fees have not run on Strike mainnet yet.";

export const curatorFeeRate = (fee: Pick<CuratorFee, "feeBps">) =>
  `${(fee.feeBps / 100).toFixed(2)}%`;

export const curatorFeeTerms = (fee: CuratorFee) =>
  `${curatorFeeRate(fee)} of each fill, to builder code ${fee.builderCode}`;

export const curatorFeeNotApplied = (fee: CuratorFee) =>
  `The curator’s fee does not apply to this account: it was not connected under builder code ${fee.builderCode} at ${curatorFeeRate(fee)} or more, so the order goes out without it.`;

export const curatorFeeConsent = (fee: CuratorFee, planned: string) =>
  `It includes the curator’s fee of ${curatorFeeRate(fee)} on each fill, ${planned} on the entry and the stop, paid to builder code ${fee.builderCode}.`;

export const computedFrom: Record<Environment, string> = {
  live: "computed from the fills; Strike does not report it on a fill",
  replay: "computed from the fills on the replay exchange",
};
