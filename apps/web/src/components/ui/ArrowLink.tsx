import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { pressableFill, type PressableTone } from "./tones";

type ArrowLinkProps = {
  href: string;
  label: string;
  tone: PressableTone;
};

export function ArrowLink({ href, label, tone }: ArrowLinkProps) {
  return (
    <a
      href={href}
      aria-label={label}
      className={`flex h-10 w-[52px] items-center justify-center rounded-pill border border-ink text-ink transition-colors duration-700 ease-settle ${pressableFill[tone]}`}
    >
      <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={1.5} />
    </a>
  );
}
