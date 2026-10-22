import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { terminalIntentStates, type IntentState } from "@cadence/core";
import { AppShell, Panel } from "@/components/app/AppShell";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import { IntentTimeline } from "@/components/app/IntentTimeline";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { OrdersPanel } from "@/components/app/OrdersPanel";
import { TicketRows } from "@/components/ui/Ticket";
import { apiRequest } from "@/lib/api/client";
import { intentSchema, type IntentView } from "@/lib/api/schemas";
import { formatPrice, formatUsd } from "@/lib/format";

const settled: ReadonlySet<IntentState> = new Set(terminalIntentStates);

function useIntent(intentId: string) {
  const [intent, setIntent] = useState<IntentView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const finished = intent !== null && settled.has(intent.state);

  useEffect(() => {
    if (finished) {
      return;
    }
    const controller = new AbortController();
    const refresh = () => {
      apiRequest(intentSchema, `/api/intents/${encodeURIComponent(intentId)}`, {
        signal: controller.signal,
      }).then(
        (next) => {
          setIntent(next);
          setProblem(null);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setProblem(error instanceof Error ? error.message : "Status could not be refreshed.");
          }
        },
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [intentId, finished]);

  return { intent, problem };
}

function IntentDetail({ intentId }: { intentId: string }) {
  const { intent, problem } = useIntent(intentId);
  if (intent === null) {
    return problem !== null ? (
      <Problem title="This order could not be loaded">{problem}</Problem>
    ) : (
      <Loading label="Loading your order" />
    );
  }
  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-title">{intent.market}</h1>
          <EnvironmentBadge environment={intent.environment} />
        </div>
        <IntentTimeline state={intent.state} />
        {problem !== null ? <Problem title="Status is not refreshing">{problem}</Problem> : null}
      </Panel>
      <Panel>
        <h2 className="t-card">What you approved</h2>
        <TicketRows
          rows={[
            ["Plan", `${intent.planPublicId}, version ${String(intent.planVersion)}`],
            ["Size", intent.approved.quantity],
            ["Limit price", formatPrice(intent.approved.limitPrice)],
            ["Planned risk", formatUsd(intent.approved.plannedLoss)],
          ]}
        />
      </Panel>
      <Panel>
        <h2 className="t-card">On Strike</h2>
        <OrdersPanel orders={intent.orders} />
        {settled.has(intent.state) ? (
          <Link to={`/receipts/${intent.id}`} className="t-body underline underline-offset-4">
            View the receipt
          </Link>
        ) : null}
      </Panel>
    </>
  );
}

export function IntentPage() {
  const { intentId = "" } = useParams();
  return (
    <AppShell>
      <LoginGate>{() => <IntentDetail intentId={intentId} />}</LoginGate>
    </AppShell>
  );
}
