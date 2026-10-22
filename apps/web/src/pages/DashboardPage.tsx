import { terminalIntentStates, type IntentState } from "@cadence/core";
import { Decimal } from "decimal.js";
import { Link } from "react-router";
import { AppShell, Panel } from "@/components/app/AppShell";
import { LoginGate, type SignedInUser } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { OrderRows } from "@/components/dashboard/OrderRows";
import { PlanRows } from "@/components/dashboard/PlanRows";
import { SummaryTiles } from "@/components/dashboard/SummaryTiles";
import { RouteButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { accountsSchema, authoredPlansSchema, intentListSchema } from "@/lib/api/schemas";
import { formatUsd } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useResource } from "@/lib/use-resource";

const settled: ReadonlySet<IntentState> = new Set(terminalIntentStates);

async function loadDashboard(signal: AbortSignal) {
  const [accounts, intents, plans] = await Promise.all([
    apiRequest(accountsSchema, "/api/accounts", { signal }),
    apiRequest(intentListSchema, "/api/intents", { signal }),
    apiRequest(authoredPlansSchema, "/api/plans", { signal }),
  ]);
  return { accounts: accounts.accounts, intents: intents.intents, plans: plans.plans };
}

function Dashboard({ user }: { user: SignedInUser }) {
  const now = useNow(30_000);
  const data = useResource(`dashboard:${user.id}`, loadDashboard);
  if (data.status !== "ready") {
    return data.status === "failed" ? (
      <Problem title="Your dashboard could not be loaded" onRetry={data.reload}>
        {data.error.message}
      </Problem>
    ) : (
      <Loading label="Loading your dashboard" />
    );
  }
  const { accounts, intents, plans } = data.data;
  const open = intents.filter((intent) => !settled.has(intent.state));
  const history = intents.filter((intent) => settled.has(intent.state));
  const riskInUse = open.reduce((total, intent) => total.plus(intent.plannedLoss), new Decimal(0));
  const activeAccounts = accounts.filter((account) => account.status === "active").length;
  const publishedPlans = plans.filter((plan) => plan.status !== "draft").length;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="t-h2">Your Cadence</h1>
        <p className="t-body">Signed in as {user.displayName}.</p>
      </div>
      <SummaryTiles
        tiles={[
          { label: "Open orders", value: String(open.length), tone: "sky" },
          { label: "Planned risk in use", value: formatUsd(riskInUse.toFixed(2)), tone: "butter" },
          { label: "Active accounts", value: String(activeAccounts), tone: "mint" },
          { label: "Plans published", value: String(publishedPlans), tone: "blush" },
        ]}
      />
      <Panel>
        <h2 className="t-card">Open orders</h2>
        {open.length === 0 ? (
          <p className="t-body">
            Nothing open. Open a plan link from your group to preview it, or{" "}
            <Link to="/account" className="underline underline-offset-4">
              add a replay account
            </Link>{" "}
            to try the whole loop without money.
          </p>
        ) : (
          <OrderRows orders={open} history={false} />
        )}
      </Panel>
      <Panel>
        <h2 className="t-card">History</h2>
        {history.length === 0 ? (
          <p className="t-body">Finished orders and their receipts appear here.</p>
        ) : (
          <OrderRows orders={history} history />
        )}
      </Panel>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="t-card">Plans you published</h2>
          <RouteButton to="/author">Publish a plan</RouteButton>
        </div>
        {plans.length === 0 ? (
          <p className="t-body">You have not published a plan yet.</p>
        ) : (
          <PlanRows plans={plans} now={now} />
        )}
      </Panel>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="t-card">Accounts</h2>
          <RouteButton to="/account">Manage accounts</RouteButton>
        </div>
        <p className="t-body">
          {accounts.length === 0
            ? "No Strike account connected yet."
            : `${String(activeAccounts)} of ${String(accounts.length)} connected account${accounts.length === 1 ? " is" : "s are"} taking new entries.`}
        </p>
      </Panel>
    </>
  );
}

export function DashboardPage() {
  return (
    <AppShell wide>
      <LoginGate>{(user) => <Dashboard user={user} />}</LoginGate>
    </AppShell>
  );
}
