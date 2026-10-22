import type { PublishedPlan } from "@cadence/core";
import type { PlanCard } from "../telegram/publisher";

function utcLabel(iso: string): string {
  const [date = "", time = ""] = new Date(iso).toISOString().split("T");
  const [hours = "", minutes = "", seconds = "00.000"] = time.split(":");
  const wholeSeconds = seconds.slice(0, 2);
  const clock =
    wholeSeconds === "00" ? `${hours}:${minutes}` : `${hours}:${minutes}:${wholeSeconds}`;
  return `${date} ${clock} UTC`;
}

export function planCard(args: {
  plan: PublishedPlan;
  version: number;
  publicId: string;
  communityName: string;
  chatId: string;
  webOrigin: string;
}): PlanCard {
  const { plan, version } = args;
  const heading = [
    `${args.communityName} · ${plan.market} ${plan.direction}`,
    ...(version > 1 ? [`Version ${String(version)} replaces version ${String(version - 1)}.`] : []),
  ];
  const terms = [
    `Entry ${plan.entryMin} to ${plan.entryMax}`,
    `Stop ${plan.stopPrice}`,
    `Target ${plan.targetPrice}`,
    `New entries close ${utcLabel(plan.entryExpiresAt)}`,
  ];
  const rationale = plan.rationale.trim();
  const sections = [
    heading.join("\n"),
    terms.join("\n"),
    ...(rationale.length > 0 ? [rationale] : []),
    "Preview it against your own account and risk budget before you approve.",
  ];
  return {
    chatId: args.chatId,
    text: sections.join("\n\n"),
    button: { label: "Preview for me", url: `${args.webOrigin}/p/${args.publicId}` },
  };
}
