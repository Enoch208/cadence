import { useState } from "react";
import { Panel } from "@/components/app/AppShell";
import { Field } from "@/components/app/Field";
import { Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { policyVersionSchema } from "@/lib/api/schemas";

const defaults = {
  perTradeBudget: "20",
  aggregateBudget: "60",
  sessionBudget: "40",
  leverageCap: "5",
  minRewardRisk: "1.5",
};

type Rules = typeof defaults;

export function RiskRules() {
  const [rules, setRules] = useState<Rules>(defaults);
  const [saved, setSaved] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof Rules) => (value: string) => {
    setRules((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    setProblem(null);
    try {
      const result = await apiRequest(policyVersionSchema, "/api/policies", {
        method: "PUT",
        body: {
          perTradeBudget: rules.perTradeBudget.trim(),
          aggregateBudget: rules.aggregateBudget.trim(),
          sessionBudget: rules.sessionBudget.trim(),
          leverageCap: Number.parseInt(rules.leverageCap, 10),
          minRewardRisk: rules.minRewardRisk.trim(),
        },
      });
      setSaved(result.version);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your rules were not saved.");
    }
  };
  return (
    <Panel>
      <h2 className="t-card">Your rules</h2>
      <p className="t-body">
        Cadence sizes every plan inside these limits and declines a plan that cannot fit. Planned
        risk is a modelled loss at the stop, not a guaranteed maximum.
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Planned risk per plan (USD)"
          value={rules.perTradeBudget}
          onChange={set("perTradeBudget")}
          inputMode="decimal"
        />
        <Field
          label="Across all open plans (USD)"
          value={rules.aggregateBudget}
          onChange={set("aggregateBudget")}
          inputMode="decimal"
        />
        <Field
          label="Per day (USD)"
          value={rules.sessionBudget}
          onChange={set("sessionBudget")}
          inputMode="decimal"
        />
        <Field
          label="Highest leverage"
          value={rules.leverageCap}
          onChange={set("leverageCap")}
          inputMode="numeric"
        />
        <Field
          label="Lowest reward to risk after costs"
          value={rules.minRewardRisk}
          onChange={set("minRewardRisk")}
          inputMode="decimal"
        />
      </div>
      <div>
        <ActionButton onClick={() => void save()}>Save my rules</ActionButton>
      </div>
      {saved !== null ? (
        <p className="t-body">Saved as version {saved}. New previews use it.</p>
      ) : null}
      {problem !== null ? <Problem title="Not saved">{problem}</Problem> : null}
    </Panel>
  );
}
