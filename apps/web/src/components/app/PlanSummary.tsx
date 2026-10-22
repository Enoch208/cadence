import type { PlanFields } from "@cadence/core";
import { TicketRows } from "@/components/ui/Ticket";
import { formatInstant, formatPrice } from "@/lib/format";
import { Countdown } from "./Countdown";

export function PlanSummary({ plan }: { plan: PlanFields }) {
  const closesAt = Date.parse(plan.entryExpiresAt);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="t-title">{plan.market}</h1>
        <span
          className={`inline-flex h-8 items-center rounded-pill border border-ink px-3 text-[15px] leading-none font-medium ${plan.direction === "long" ? "bg-mint" : "bg-blush"}`}
        >
          {plan.direction === "long" ? "Long" : "Short"}
        </span>
      </div>
      <TicketRows
        rows={[
          ["Entry range", `${formatPrice(plan.entryMin)} – ${formatPrice(plan.entryMax)}`],
          ["Stop", formatPrice(plan.stopPrice)],
          ["Target", formatPrice(plan.targetPrice)],
          ["Exits trigger on", "Mark price"],
          ["Entry closes", formatInstant(plan.entryExpiresAt)],
        ]}
      />
      <p className="t-meta">
        <Countdown until={closesAt} prefix="Entry window closes in" />
      </p>
      {plan.rationale.length > 0 ? <p className="t-body">{plan.rationale}</p> : null}
    </div>
  );
}
