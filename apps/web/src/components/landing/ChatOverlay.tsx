import { examplePlan, formatPrice } from "./example-plan";

export function ChatOverlay() {
  return (
    <div
      aria-label="Example of a Cadence plan card posted in a Telegram group"
      role="img"
      className="absolute top-[8.39%] left-[33.93%] flex h-[67.32%] w-[31.79%] flex-col overflow-hidden rounded-[3.6cqw] bg-lavender"
    >
      <div className="flex items-center gap-[1.4cqw] border-b border-ink bg-paper px-[2cqw] pt-[5cqw] pb-[1.6cqw]">
        <span className="size-[4.6cqw] shrink-0 rounded-full border border-ink bg-butter" />
        <span className="flex flex-col">
          <span className="text-[1.9cqw] leading-tight font-medium">Swing setups</span>
          <span className="text-[1.5cqw] leading-tight">Example group</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-[1.4cqw] p-[2cqw]">
        <div className="flex flex-col gap-[0.8cqw] rounded-[2.4cqw] border border-ink bg-paper p-[2cqw]">
          <span className="text-[1.5cqw] font-medium uppercase">Cadence plan · V2</span>
          <span className="text-[2.2cqw] leading-tight font-medium tracking-[-0.02em]">
            {examplePlan.market} long
          </span>
          <span className="text-[1.6cqw] leading-snug tabular-nums">
            Entry {formatPrice(examplePlan.entryMin)}–{formatPrice(examplePlan.entryMax)}
            <br />
            Stop {formatPrice(examplePlan.stopPrice)} · Target{" "}
            {formatPrice(examplePlan.targetPrice)}
            <br />
            Closes 23 Oct, 18:00 UTC
          </span>
        </div>
        <span className="flex h-[6cqw] items-center justify-center rounded-[1.6cqw] border border-ink bg-paper text-[1.7cqw] font-medium">
          Preview for me
        </span>
      </div>
    </div>
  );
}
