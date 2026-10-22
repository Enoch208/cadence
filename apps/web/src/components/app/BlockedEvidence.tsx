import type { Decision, PlanFields } from "@cadence/core";
import { rewardToRiskBeforeCosts } from "@cadence/core/reward-risk";
import { Decimal } from "decimal.js";
import { TicketRows } from "@/components/ui/Ticket";
import { formatPrice } from "@/lib/format";

type BlockedDecision = Extract<Decision, { outcome: "BLOCKED" }>;

export function BlockedEvidence({
  decision,
  plan,
}: {
  decision: BlockedDecision;
  plan: PlanFields;
}) {
  if (!decision.reasons.includes("OUTSIDE_ENTRY_RANGE")) {
    return null;
  }
  const long = plan.direction === "long";
  const price = long ? decision.evidence.bestAsk : decision.evidence.bestBid;
  if (price === null) {
    return null;
  }
  const above = new Decimal(price).greaterThan(plan.entryMax);
  const ratio = rewardToRiskBeforeCosts(
    {
      direction: plan.direction,
      entry: price,
      stopPrice: plan.stopPrice,
      targetPrice: plan.targetPrice,
    },
    2,
  );
  const atEntry = rewardToRiskBeforeCosts(
    {
      direction: plan.direction,
      entry: long ? plan.entryMax : plan.entryMin,
      stopPrice: plan.stopPrice,
      targetPrice: plan.targetPrice,
    },
    2,
  );
  return (
    <TicketRows
      rows={[
        [long ? "Current ask" : "Current bid", formatPrice(price)],
        [
          above ? "Plan’s highest entry" : "Plan’s lowest entry",
          formatPrice(above ? plan.entryMax : plan.entryMin),
        ],
        ["Reward to risk at this price", ratio ?? "none left"],
        ["Reward to risk inside the range", atEntry ?? "none"],
      ]}
    />
  );
}
