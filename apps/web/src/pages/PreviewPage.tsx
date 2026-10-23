import type { Environment } from "@cadence/core";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AccountPicker } from "@/components/app/AccountPicker";
import { AppShell, Panel } from "@/components/app/AppShell";
import { Countdown } from "@/components/app/Countdown";
import { DecisionPanel } from "@/components/app/DecisionPanel";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { PlanSummary } from "@/components/app/PlanSummary";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import {
  accountsSchema,
  createdIntentSchema,
  previewSchema,
  publicPlanSchema,
  type PreviewResult,
  type PublicPlan,
} from "@/lib/api/schemas";
import { venueName } from "@/lib/copy/states";
import { curatorFeeConsent, curatorFeeNotYetLive } from "@/lib/copy/curator-fee";
import { formatPrice, formatUsd } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useResource } from "@/lib/use-resource";

function Consent({
  preview,
  environment,
  onApprove,
  busy,
}: {
  preview: PreviewResult;
  environment: Environment;
  onApprove: () => void;
  busy: boolean;
}) {
  const venue = venueName[environment];
  const now = useNow(500);
  if (preview.decision.outcome === "BLOCKED") {
    return null;
  }
  const expired = now >= preview.expiresAt;
  const { quantity, limitPrice, curatorFee, costs } = preview.decision.proposal;
  return (
    <div className="flex flex-col items-start gap-4 border-t border-ink pt-5">
      <p className="t-body">
        Approving sends <strong>one order for this plan version</strong>: at most {quantity} at a
        limit of {formatPrice(limitPrice)}, filled in full or not at all, with the stop and target
        attached on {venue}. Cadence checks again just before sending. If anything changed, nothing
        is sent. This is not permission for future plans.
      </p>
      {curatorFee === null ? null : (
        <p className="t-body">{curatorFeeConsent(curatorFee, formatUsd(costs.curatorFee))}</p>
      )}
      {curatorFee !== null && environment === "live" ? (
        <p className="t-body rounded-card border border-ink bg-butter p-4">
          {curatorFeeNotYetLive}
        </p>
      ) : null}
      <ActionButton onClick={onApprove} disabled={expired || busy}>
        {busy ? "Approving…" : "Approve this plan"}
      </ActionButton>
      <p className="t-meta">
        {expired ? (
          "Preview expired. Check again."
        ) : (
          <Countdown until={preview.expiresAt} prefix="Preview valid for" />
        )}
      </p>
    </div>
  );
}

const offersReplayConnect = (plan: PublicPlan, preview: PreviewResult) =>
  plan.current.plan.environment === "replay" &&
  plan.current.plan.curatorFee !== undefined &&
  (preview.decision.outcome === "BLOCKED" || preview.decision.proposal.curatorFee === null);

function PreviewFlow({ plan }: { plan: PublicPlan }) {
  const navigate = useNavigate();
  const accounts = useResource("accounts", (signal) =>
    apiRequest(accountsSchema, "/api/accounts", { signal }),
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const check = () =>
    run(async () => {
      setPreview(
        await apiRequest(previewSchema, "/api/previews", {
          method: "POST",
          body: { planPublicId: plan.publicId, accountId },
        }),
      );
    });

  const approve = (previewId: string) =>
    run(async () => {
      const intent = await apiRequest(createdIntentSchema, "/api/intents", {
        method: "POST",
        body: { previewId },
      });
      await navigate(`/intents/${intent.id}`);
    });

  if (accounts.status !== "ready") {
    return accounts.status === "failed" ? (
      <Problem title="Your accounts could not be loaded" onRetry={accounts.reload}>
        {accounts.error.message}
      </Problem>
    ) : (
      <Loading label="Loading your accounts" />
    );
  }

  return (
    <Panel>
      <AccountPicker
        accounts={accounts.data.accounts}
        selected={accountId}
        onSelect={setAccountId}
      />
      <div>
        <ActionButton onClick={() => void check()} disabled={accountId === null || busy}>
          {preview === null ? "Check my size" : "Check again"}
        </ActionButton>
      </div>
      {problem !== null ? <Problem title="That did not go through">{problem}</Problem> : null}
      {preview !== null ? (
        <>
          <DecisionPanel decision={preview.decision} plan={plan.current.plan} />
          {offersReplayConnect(plan, preview) ? (
            <Link
              to={`/account?plan=${encodeURIComponent(plan.publicId)}`}
              className="t-body underline underline-offset-4"
            >
              Add a replay account under the curator’s builder code
            </Link>
          ) : null}
          <Consent
            preview={preview}
            environment={plan.current.plan.environment}
            busy={busy}
            onApprove={() => void approve(preview.previewId)}
          />
        </>
      ) : null}
    </Panel>
  );
}

export function PreviewPage() {
  const { publicId = "" } = useParams();
  const plan = useResource(publicId, (signal) =>
    apiRequest(publicPlanSchema, `/api/plans/${encodeURIComponent(publicId)}`, { signal }),
  );
  return (
    <AppShell>
      {plan.status === "ready" ? (
        <>
          <Panel>
            <span className="t-meta">
              {plan.data.communityName} · version {plan.data.current.version}
            </span>
            <PlanSummary plan={plan.data.current.plan} />
          </Panel>
          <LoginGate>{() => <PreviewFlow plan={plan.data} />}</LoginGate>
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
