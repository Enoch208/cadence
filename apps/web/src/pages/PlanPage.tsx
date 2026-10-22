import { useParams } from "react-router";
import { AppShell, Panel } from "@/components/app/AppShell";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import { Loading, Problem } from "@/components/app/Notice";
import { PlanSummary } from "@/components/app/PlanSummary";
import { RouteButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { publicPlanSchema, type PublicPlan } from "@/lib/api/schemas";
import { formatInstant, shortDigest } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useResource } from "@/lib/use-resource";

function Availability({ plan, now }: { plan: PublicPlan; now: number }) {
  if (plan.status === "revoked") {
    return <Problem title="Withdrawn by the curator">This plan takes no new entries.</Problem>;
  }
  if (Date.parse(plan.current.plan.entryExpiresAt) <= now) {
    return <Problem title="Entry window closed">This plan takes no new entries.</Problem>;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <RouteButton to={`/p/${plan.publicId}/preview`}>Preview for me</RouteButton>
      <p className="t-body">Nothing is placed until you see your size and approve it.</p>
    </div>
  );
}

function VersionHistory({ plan }: { plan: PublicPlan }) {
  return (
    <ol className="flex flex-col gap-2">
      {plan.versions.map((version) => (
        <li
          key={version.version}
          className="t-body flex flex-wrap justify-between gap-2 tabular-nums"
        >
          <span>
            Version {version.version}
            {version.version === plan.current.version ? " · current" : " · superseded"}
          </span>
          <span>
            {formatInstant(version.publishedAt)} · {shortDigest(version.digest)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PlanPage() {
  const { publicId = "" } = useParams();
  const now = useNow(1000);
  const plan = useResource(publicId, (signal) =>
    apiRequest(publicPlanSchema, `/api/plans/${encodeURIComponent(publicId)}`, { signal }),
  );

  return (
    <AppShell
      aside={
        plan.status === "ready" ? (
          <EnvironmentBadge environment={plan.data.current.plan.environment} />
        ) : null
      }
    >
      {plan.status === "ready" ? (
        <>
          <Panel>
            <span className="t-meta">
              {plan.data.communityName} · version {plan.data.current.version}
            </span>
            <PlanSummary plan={plan.data.current.plan} />
            <Availability plan={plan.data} now={now} />
          </Panel>
          <Panel>
            <h2 className="t-card">Plan history</h2>
            <p className="t-body">
              Every version is fixed once published. A correction becomes a new version; approvals
              stay tied to the version they were given for.
            </p>
            <VersionHistory plan={plan.data} />
          </Panel>
        </>
      ) : plan.status === "failed" ? (
        <Problem title="This plan could not be opened" onRetry={plan.reload}>
          {plan.error.message}
        </Problem>
      ) : (
        <Loading label="Opening the plan" />
      )}
    </AppShell>
  );
}
