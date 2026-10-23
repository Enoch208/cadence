import type { PublishedPlan } from "@cadence/core";
import type { PlanCard } from "../telegram/publisher";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function price(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function utcLabel(iso: string): string {
  const at = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  const seconds = at.getUTCSeconds();
  const clock = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}${seconds === 0 ? "" : `:${two(seconds)}`}`;
  return `${String(at.getUTCDate())} ${months[at.getUTCMonth()] ?? ""}, ${clock} UTC`;
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
  const title = `${plan.environment === "replay" ? "Replay: " : ""}${args.communityName} · ${plan.market} ${plan.direction}`;
  const heading = [
    title,
    ...(version > 1 ? [`Version ${String(version)} replaces version ${String(version - 1)}.`] : []),
  ];
  const terms = [
    `Entry ${price(plan.entryMin)} – ${price(plan.entryMax)}`,
    `Stop ${price(plan.stopPrice)} · Target ${price(plan.targetPrice)}`,
    `Entry closes ${utcLabel(plan.entryExpiresAt)}`,
  ];
  const rationale = plan.rationale.trim();
  const sections = [
    heading.join("\n"),
    terms.join("\n"),
    ...(rationale.length > 0 ? [rationale] : []),
    "Each member gets a size that fits their own account. Nothing is placed until they approve.",
  ];
  return {
    chatId: args.chatId,
    text: sections.join("\n\n"),
    boldLength: title.length,
    button: { label: "Preview for me", url: `${args.webOrigin}/p/${args.publicId}` },
  };
}
