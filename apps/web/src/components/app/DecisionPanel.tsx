import type { Decision, PlanFields, Proposal } from "@cadence/core";
import { Cancel01Icon, MinusSignCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { StatusPill, TicketRows } from "@/components/ui/Ticket";
import { BlockedEvidence } from "./BlockedEvidence";
import { blockedReasonCopy, resizedReasonCopy } from "@/lib/copy/reasons";
import { curatorFeeNotApplied } from "@/lib/copy/curator-fee";
import { outcomeLabel } from "@/lib/copy/states";
import { formatPrice, formatUsd } from "@/lib/format";

const outcomeStyle = {
  READY: { tone: "mint", icon: Tick02Icon },
  RESIZED: { tone: "butter", icon: MinusSignCircleIcon },
  BLOCKED: { tone: "blush", icon: Cancel01Icon },
} as const;

function plannedRiskNote({ costs, curatorFee }: Proposal): string {
  const parts = [
    `fees of ${formatUsd(costs.entryFee)} in and ${formatUsd(costs.exitFee)} out`,
    `a stop slippage reserve of ${formatUsd(costs.stopSlippageReserve)}`,
    ...(curatorFee === null ? [] : [`a curator fee of ${formatUsd(costs.curatorFee)}`]),
  ];
  return `Planned risk is the modelled loss at the stop, including ${parts.join(", ")} and funding of ${formatUsd(costs.fundingReserve)}. It is not a maximum loss: a stop can fill worse than planned.`;
}

export function DecisionPanel({ decision, plan }: { decision: Decision; plan: PlanFields }) {
  const style = outcomeStyle[decision.outcome];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <span className="t-card">Your preview</span>
        <StatusPill label={outcomeLabel[decision.outcome]} tone={style.tone} icon={style.icon} />
      </div>
      {decision.outcome === "BLOCKED" ? (
        <ul className="flex flex-col gap-2">
          {decision.reasons.map((reason) => (
            <li key={reason} className="t-body">
              {blockedReasonCopy(reason, plan, decision.evidence)}
            </li>
          ))}
        </ul>
      ) : null}
      {decision.outcome === "BLOCKED" ? (
        <BlockedEvidence decision={decision} plan={plan} />
      ) : (
        <>
          {decision.reasons.map((reason) => (
            <p key={reason} className="t-body">
              {resizedReasonCopy(reason)}
            </p>
          ))}
          {plan.environment === "live" && decision.proposal.limitedBy === "ceiling" ? (
            <p className="t-body">Sized to the most Cadence sends in one live order.</p>
          ) : null}
          <TicketRows
            rows={[
              ["Size", `${decision.proposal.quantity} ${plan.market.split("-")[0] ?? ""}`],
              ["Limit price", formatPrice(decision.proposal.limitPrice)],
              ["Notional", formatUsd(decision.proposal.notional)],
              ["Planned risk", formatUsd(decision.proposal.plannedLoss)],
              ...(decision.proposal.curatorFee === null
                ? []
                : [["Curator fee", formatUsd(decision.proposal.costs.curatorFee)] as const]),
              ["Reward to risk after costs", decision.proposal.rewardRiskNet],
              [
                "Margin at your leverage",
                `${formatUsd(decision.proposal.initialMargin)} at ${String(decision.proposal.leverage)}x`,
              ],
              ["Estimated liquidation", formatPrice(decision.proposal.estimatedLiquidationPrice)],
            ]}
          />
          <p className="t-body">{plannedRiskNote(decision.proposal)}</p>
          {plan.curatorFee !== undefined && decision.proposal.curatorFee === null ? (
            <p className="t-body">{curatorFeeNotApplied(plan.curatorFee)}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
