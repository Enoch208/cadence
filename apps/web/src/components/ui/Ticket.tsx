import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { toneFill, type Tone } from "@/components/ui/tones";

export function Ticket({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex w-[372px] flex-col gap-5 rounded-card border border-ink bg-paper p-6 text-left ${className}`}
    >
      {children}
    </div>
  );
}

export function TicketHeader({ title, aside }: { title: string; aside: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="t-card whitespace-nowrap">{title}</span>
      {aside}
    </div>
  );
}

type StatusPillProps = {
  label: string;
  tone: Tone;
  icon: IconSvgElement;
};

export function StatusPill({ label, tone, icon }: StatusPillProps) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-pill border border-ink px-3 text-[15px] leading-none font-medium ${toneFill[tone]}`}
    >
      <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
      {label}
    </span>
  );
}

export function TicketRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-4 border-t border-ink py-2.5"
        >
          <dt className="t-body">{label}</dt>
          <dd className="t-body font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TicketAction({ children }: { children: string }) {
  return (
    <span className="flex h-12 items-center justify-center rounded-btn border border-ink bg-paper pb-[3px] t-button shadow-key">
      {children}
    </span>
  );
}
