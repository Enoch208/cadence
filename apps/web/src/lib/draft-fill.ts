import { directions } from "@cadence/core";
import { draftedKeys, type DraftedKey, type PlanDraftReply } from "./api/drafting";
import { localInputValue, type PlanDraft } from "./plan-form";

export type FormKey = keyof PlanDraft;
export type Sources = Partial<Record<FormKey, string>>;
export type Filled = { draft: PlanDraft; sources: Sources; missing: FormKey[] };

const formKeyFor: Record<DraftedKey, FormKey> = {
  market: "market",
  direction: "direction",
  entryMin: "entryMin",
  entryMax: "entryMax",
  stopPrice: "stopPrice",
  targetPrice: "targetPrice",
  entryExpiresAt: "closesAtLocal",
  rationale: "rationale",
};

function withValue(draft: PlanDraft, key: DraftedKey, value: string): PlanDraft | null {
  if (key === "direction") {
    const direction = directions.find((side) => side === value);
    return direction === undefined ? null : { ...draft, direction };
  }
  if (key === "entryExpiresAt") {
    const closesAtLocal = localInputValue(value);
    return closesAtLocal === "" ? null : { ...draft, closesAtLocal };
  }
  return { ...draft, [formKeyFor[key]]: value };
}

export function fillFromDraft(current: PlanDraft, reply: PlanDraftReply["draft"]): Filled {
  let draft = current;
  const sources: Sources = {};
  const missing: FormKey[] = [];
  for (const key of draftedKeys) {
    const sourced = reply.filled[key];
    const next = sourced === undefined ? null : withValue(draft, key, sourced.value);
    if (sourced === undefined || next === null) {
      missing.push(formKeyFor[key]);
    } else {
      draft = next;
      sources[formKeyFor[key]] = sourced.quote;
    }
  }
  return { draft, sources, missing };
}
