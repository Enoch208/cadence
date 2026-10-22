import { useId, type ReactNode } from "react";
import { toneFill, type Tone } from "./tones";

type CircleBadgeProps = {
  text: string;
  tone: Tone;
  children: ReactNode;
  className: string;
};

const radius = 40;
const circumference = 2 * Math.PI * radius;

export function CircleBadge({ text, tone, children, className }: CircleBadgeProps) {
  const pathId = `badge-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div
      aria-hidden="true"
      className={`flex size-[104px] items-center justify-center rounded-full border border-ink md:size-[130px] ${toneFill[tone]} ${className}`}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-3 animate-badge-spin md:inset-[15px]">
        <defs>
          <path
            id={pathId}
            d={`M50,50 m-${String(radius)},0 a${String(radius)},${String(radius)} 0 1,1 ${String(radius * 2)},0 a${String(radius)},${String(radius)} 0 1,1 -${String(radius * 2)},0`}
          />
        </defs>
        <text className="fill-ink" fontSize="9.5" fontWeight="600">
          <textPath href={`#${pathId}`} textLength={circumference} lengthAdjust="spacing">
            {text}
          </textPath>
        </text>
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}
