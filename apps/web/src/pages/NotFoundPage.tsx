import { AppShell, Panel } from "@/components/app/AppShell";
import { RouteButton } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <AppShell>
      <Panel>
        <h1 className="t-title">Nothing here</h1>
        <p className="t-body">This link does not point to a plan or an order.</p>
        <div>
          <RouteButton to="/">Back to Cadence</RouteButton>
        </div>
      </Panel>
    </AppShell>
  );
}
