import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  examplePlan,
  exampleLateAsk,
  examplePreview,
  exampleRewardRisk,
  formatPrice,
  formatUsd,
} from "./example-plan";
import { StatusPill, Ticket, TicketAction, TicketHeader, TicketRows } from "./Ticket";

const planRows = [
  ["Entry range", `${formatPrice(examplePlan.entryMin)} – ${formatPrice(examplePlan.entryMax)}`],
  ["Stop", formatPrice(examplePlan.stopPrice)],
  ["Target", formatPrice(examplePlan.targetPrice)],
  ["Entry closes", "23 Oct, 18:00 UTC"],
] as const;

export function PlanPanel() {
  return (
    <div className="relative">
      <Ticket className="absolute -top-[50px] left-5 -rotate-3">
        <TicketHeader
          title={examplePlan.market}
          aside={<span className="t-meta">V1 · Superseded</span>}
        />
      </Ticket>
      <Ticket className="relative">
        <TicketHeader
          title={examplePlan.market}
          aside={
            <span className="flex items-center gap-2.5">
              <span className="t-meta">V2</span>
              <span className="inline-flex h-8 items-center rounded-pill border border-ink bg-mint px-3 text-[15px] leading-none font-medium">
                Long
              </span>
            </span>
          }
        />
        <TicketRows rows={planRows} />
        <TicketAction>Preview for me</TicketAction>
      </Ticket>
    </div>
  );
}

export function PreviewPanel() {
  return (
    <Ticket>
      <TicketHeader
        title="Your preview"
        aside={<StatusPill label="Ready" tone="mint" icon={Tick02Icon} />}
      />
      <TicketRows
        rows={[
          ["Size", `${examplePreview.size} BTC`],
          ["Notional", formatUsd(examplePreview.notional)],
          ["Planned risk", formatUsd(examplePreview.plannedRisk)],
          ["Reward to risk", exampleRewardRisk.atEntry ?? "n/a"],
        ]}
      />
      <span className="t-meta">Before costs</span>
      <TicketAction>Approve this plan</TicketAction>
    </Ticket>
  );
}

export function DeclinedPanel() {
  return (
    <Ticket>
      <TicketHeader
        title="Your preview"
        aside={<StatusPill label="Cannot execute" tone="blush" icon={Cancel01Icon} />}
      />
      <p className="t-body">The current ask is above this plan’s highest entry price.</p>
      <TicketRows
        rows={[
          ["Highest entry", formatPrice(examplePlan.entryMax)],
          ["Current ask", formatPrice(exampleLateAsk)],
          ["Reward to risk now", exampleRewardRisk.atLateAsk ?? "n/a"],
        ]}
      />
    </Ticket>
  );
}

export function ExitsPanel() {
  return (
    <Ticket>
      <TicketHeader
        title="Your order"
        aside={<StatusPill label="Exits verified" tone="sky" icon={Tick02Icon} />}
      />
      <TicketRows
        rows={[
          ["Filled", `${examplePreview.size} BTC at ${formatPrice(examplePreview.fillPrice)}`],
          ["Stop", `${formatPrice(examplePlan.stopPrice)} on Strike`],
          ["Target", `${formatPrice(examplePlan.targetPrice)} on Strike`],
        ]}
      />
      <span className="t-meta">Reconciled with Strike</span>
    </Ticket>
  );
}
