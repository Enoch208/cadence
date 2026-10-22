import { useState } from "react";
import { Panel } from "@/components/app/AppShell";
import { Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { accountSchema } from "@/lib/api/schemas";

const scenarios = [
  {
    name: "happy_path",
    title: "Fills cleanly",
    detail: "The entry fills and both exits appear on the exchange.",
  },
  {
    name: "late_entry",
    title: "Arrives late",
    detail: "The price has already run past the plan’s entry range.",
  },
  { name: "stale_data", title: "Old prices", detail: "Market data is too old to decide on." },
  {
    name: "ambiguous_response",
    title: "Lost answer",
    detail: "The exchange accepts the order but its reply never arrives.",
  },
  {
    name: "exits_missing",
    title: "Missing exits",
    detail: "The entry fills but the stop and target never appear.",
  },
] as const;

export function ReplayAccounts({ onAdded }: { onAdded: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (scenario: string) => {
    setBusy(scenario);
    setProblem(null);
    try {
      await apiRequest(accountSchema, "/api/accounts/replay", {
        method: "POST",
        body: { scenario },
      });
      onAdded();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The replay account was not added.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel>
      <h2 className="t-card">Try it in replay</h2>
      <p className="t-body">
        A replay account runs against a simulated exchange with no keys and no money. It only takes
        replay plans, and every screen says Replay. Each one reproduces a situation Cadence has to
        handle.
      </p>
      <ul className="flex flex-col">
        {scenarios.map((scenario) => (
          <li
            key={scenario.name}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-ink py-4"
          >
            <span className="flex flex-col">
              <span className="t-body font-medium">{scenario.title}</span>
              <span className="t-body">{scenario.detail}</span>
            </span>
            <ActionButton onClick={() => void add(scenario.name)} disabled={busy !== null}>
              {busy === scenario.name ? "Adding…" : "Add"}
            </ActionButton>
          </li>
        ))}
      </ul>
      {problem !== null ? <Problem title="Not added">{problem}</Problem> : null}
    </Panel>
  );
}
