import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  Calendar03Icon,
  Clock01Icon,
  PercentIcon,
  Refresh01Icon,
  RulerIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Appear } from "@/components/ui/Appear";
import { SectionHeader } from "@/components/ui/SectionHeader";

const checks: readonly { label: string; icon: IconSvgElement }[] = [
  { label: "Entry window", icon: Clock01Icon },
  { label: "Plan expiry", icon: Calendar03Icon },
  { label: "Your risk budget", icon: Wallet01Icon },
  { label: "Market minimum", icon: RulerIcon },
  { label: "Margin", icon: PercentIcon },
  { label: "Liquidation buffer", icon: Alert02Icon },
  { label: "Fresh prices", icon: Refresh01Icon },
];

const delays = [0.1, 0.35, 0.5, 0.65, 0.8, 0.95, 1.1];

export function Checks() {
  return (
    <div id="checks" className="flex scroll-mt-40 flex-col gap-10 lg:gap-[50px]">
      <SectionHeader
        width="medium"
        title="Checked before every order."
        intro={
          <>
            If any one of these fails, Cadence <strong>does not send the order</strong>, and it
            tells you which one failed.
          </>
        }
      />
      <ul className="mx-auto flex max-w-[1100px] flex-wrap justify-center gap-x-5 gap-y-[25px] md:gap-x-[25px] md:gap-y-[30px]">
        {checks.map((check, index) => (
          <li key={check.label}>
            <Appear variant="pop" delay={delays[index] ?? 0.1}>
              <span className="flex h-[62px] items-center gap-1.5 overflow-clip rounded-chip border border-ink bg-paper px-[25px] transition-transform duration-[250ms] ease-linear hover:-rotate-5">
                <HugeiconsIcon icon={check.icon} size={24} strokeWidth={1.5} />
                <span className="t-card">{check.label}</span>
              </span>
            </Appear>
          </li>
        ))}
      </ul>
    </div>
  );
}
