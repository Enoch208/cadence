import { useId } from "react";
import { TelegramIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import phone from "@/assets/landing/problem-phone.webp";
import { CircleBadge } from "@/components/ui/CircleBadge";
import { ChatOverlay } from "./ChatOverlay";

const scallop =
  "M40 40 A200 200 0 0 1 280 40 A200 200 0 0 1 520 40 A100 100 0 0 1 520 200 A100 100 0 0 1 520 360 A100 100 0 0 1 520 520 A200 200 0 0 1 280 520 A200 200 0 0 1 40 520 A100 100 0 0 1 40 360 A100 100 0 0 1 40 200 A100 100 0 0 1 40 40 Z";

function Tape() {
  return (
    <svg
      viewBox="0 0 150 36"
      aria-hidden="true"
      className="absolute top-[18px] left-1/2 z-10 hidden w-[150px] -translate-x-1/2 -rotate-3 md:block"
    >
      <path
        d="M4 4 L146 2 L140 9 L147 16 L140 23 L146 31 L5 34 L11 27 L3 20 L10 13 Z"
        className="fill-sky stroke-ink"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {[24, 46, 68, 90, 112].map((x) => (
        <path key={x} d={`M${String(x)} 12 l5 9 l-10 0 Z`} className="fill-ink" />
      ))}
    </svg>
  );
}

export function ScallopPhoto() {
  const clipId = `scallop-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className="@container relative aspect-square w-full max-w-[560px]">
      <svg viewBox="0 0 560 560" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d={scallop} />
          </clipPath>
        </defs>
        <image
          href={phone}
          width="560"
          height="560"
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
        <path
          d={scallop}
          className="fill-none stroke-ink"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ChatOverlay />
      <Tape />
      <span className="absolute top-[13%] right-[9%] inline-flex h-8 items-center rounded-pill border border-ink bg-paper px-3 t-meta">
        Example
      </span>
      <CircleBadge
        text="OPEN · PREVIEW · APPROVE · OPEN · PREVIEW · APPROVE · "
        tone="sky"
        className="absolute bottom-[4%] left-[4%] hidden lg:flex"
      >
        <HugeiconsIcon icon={TelegramIcon} size={26} strokeWidth={1.5} />
      </CircleBadge>
    </div>
  );
}
