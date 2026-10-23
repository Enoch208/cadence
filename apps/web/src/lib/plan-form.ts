import {
  planGeometryIssues,
  publishedPlanSchema,
  type Direction,
  type Environment,
  type PublishedPlan,
} from "@cadence/core";
import { curatorFeeCandidate, curatorFeeField, curatorFeeMessages } from "./curator-fee-form";

export type PlanDraft = {
  environment: Environment;
  market: string;
  direction: Direction;
  entryMin: string;
  entryMax: string;
  stopPrice: string;
  targetPrice: string;
  closesAtLocal: string;
  rationale: string;
  builderCode: string;
  curatorFeeBps: string;
};

export type DraftCheck =
  | { ok: true; plan: PublishedPlan }
  | { ok: false; errors: Partial<Record<keyof PlanDraft, string>> };

const fieldFor: Record<string, keyof PlanDraft> = {
  entryMin: "entryMin",
  entryMax: "entryMax",
  stopPrice: "stopPrice",
  targetPrice: "targetPrice",
  entryExpiresAt: "closesAtLocal",
  rationale: "rationale",
  market: "market",
};

const utcInstant = (local: string) => {
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const pad = (value: number) => String(value).padStart(2, "0");

export function localInputValue(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  const day = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function checkDraft(draft: PlanDraft, now: number): DraftCheck {
  const candidate = {
    schemaVersion: 1,
    market: draft.market,
    direction: draft.direction,
    entryMin: draft.entryMin.trim(),
    entryMax: draft.entryMax.trim(),
    stopPrice: draft.stopPrice.trim(),
    targetPrice: draft.targetPrice.trim(),
    triggerSource: "mark_price",
    entryExpiresAt: utcInstant(draft.closesAtLocal),
    rationale: draft.rationale.trim(),
    environment: draft.environment,
    ...curatorFeeCandidate(draft),
  };
  const parsed = publishedPlanSchema.safeParse(candidate);
  const errors: Partial<Record<keyof PlanDraft, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const feeKey = curatorFeeField(issue.path);
      const key = feeKey ?? fieldFor[String(issue.path[0])];
      if (key !== undefined && errors[key] === undefined) {
        errors[key] =
          feeKey !== null
            ? curatorFeeMessages[feeKey]
            : key === "closesAtLocal"
              ? "Choose when the entry window closes."
              : issue.message;
      }
    }
    return { ok: false, errors };
  }
  if (Date.parse(parsed.data.entryExpiresAt) <= now) {
    return { ok: false, errors: { closesAtLocal: "The entry window must close in the future." } };
  }
  return planGeometryIssues(parsed.data).length === 0
    ? { ok: true, plan: parsed.data }
    : { ok: false, errors };
}
