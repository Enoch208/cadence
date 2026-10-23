export type CuratorFeeInput = { builderCode: string; curatorFeeBps: string };

export type CuratorFeeField = keyof CuratorFeeInput;

export const curatorFeeMessages: Record<CuratorFeeField, string> = {
  builderCode: "Use the code you registered on Strike: 1 to 64 letters, digits, - or _.",
  curatorFeeBps: "Enter a whole number of basis points from 1 to 20.",
};

export function curatorFeeCandidate(input: CuratorFeeInput) {
  const builderCode = input.builderCode.trim();
  const bps = input.curatorFeeBps.trim();
  if (builderCode === "" && bps === "") {
    return {};
  }
  const feeBps = /^\d{1,3}$/.test(bps) ? Number.parseInt(bps, 10) : Number.NaN;
  return { curatorFee: { builderCode, feeBps } };
}

export const curatorFeeField = (path: readonly PropertyKey[]): CuratorFeeField | null =>
  path[0] !== "curatorFee" ? null : path[1] === "feeBps" ? "curatorFeeBps" : "builderCode";
