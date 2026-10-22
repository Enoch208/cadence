import { m, useReducedMotion } from "motion/react";
import { rewardToRiskBeforeCosts } from "@cadence/core/reward-risk";
import { toneFill, type Tone } from "@/components/ui/tones";

const illustration = { direction: "long", stopPrice: "98", targetPrice: "106" } as const;
const entries = ["100", "101", "102", "103", "104", "105"] as const;
const tones: readonly Tone[] = ["sky", "lime", "blush", "lavender", "mint", "butter"];

const rows = entries.map((entry, index) => {
  const ratio = rewardToRiskBeforeCosts({ ...illustration, entry }, 2) ?? "0.00";
  const best = rewardToRiskBeforeCosts({ ...illustration, entry: entries[0] }, 2) ?? "1";
  return {
    entry,
    ratio,
    share: `${String((Number(ratio) / Number(best)) * 100)}%`,
    tone: tones[index] ?? "sky",
  };
});

export function RewardBars() {
  const reduceMotion = useReducedMotion();
  return (
    <figure className="flex flex-col gap-5">
      <ul className="grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2 lg:grid-cols-[260px_260px]">
        {rows.map((row) => (
          <li key={row.entry} className="flex flex-col gap-2.5">
            <span className="t-body flex justify-between tabular-nums">
              <span>Entered at {row.entry}</span>
              <span>{row.ratio}</span>
            </span>
            <span className="block h-2.5 overflow-hidden rounded-full border border-ink">
              <m.span
                className={`block h-full border-r border-ink ${toneFill[row.tone]}`}
                initial={reduceMotion ? false : { width: 0 }}
                whileInView={{ width: row.share }}
                viewport={{ once: true, amount: 0 }}
                transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
              />
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="t-meta">
        Reward to risk · long, stop 98, target 106 · before costs
      </figcaption>
    </figure>
  );
}
