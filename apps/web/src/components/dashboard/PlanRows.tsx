import { Link } from "react-router";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import type { AuthoredPlan } from "@/lib/api/schemas";
import { formatInstant } from "@/lib/format";

function standing(plan: AuthoredPlan, now: number): string {
  if (plan.status === "draft") {
    return "Draft";
  }
  if (plan.status === "revoked") {
    return "Withdrawn";
  }
  if (plan.entryExpiresAt !== null && Date.parse(plan.entryExpiresAt) <= now) {
    return "Entry window closed";
  }
  return `Open until ${plan.entryExpiresAt === null ? "unknown" : formatInstant(plan.entryExpiresAt)}`;
}

export function PlanRows({ plans, now }: { plans: readonly AuthoredPlan[]; now: number }) {
  return (
    <ul className="flex flex-col">
      {plans.map((plan) => (
        <li key={plan.id} className="border-t border-ink first:border-t-0">
          <Link
            to={`/p/${plan.publicId}`}
            className="flex flex-wrap items-center justify-between gap-3 py-4 transition-colors hover:bg-hover"
          >
            <span className="flex flex-col gap-1">
              <span className="t-body font-medium">
                {plan.market} {plan.direction} · {plan.communityName}
              </span>
              <span className="t-body">
                {plan.currentVersion === null
                  ? "Not published"
                  : `Version ${String(plan.currentVersion)}`}{" "}
                · {standing(plan, now)}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <EnvironmentBadge environment={plan.environment} />
              <span className="t-meta">Plan →</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
