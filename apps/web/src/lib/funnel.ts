import type { AuthoredPlan } from "./api/schemas";

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
