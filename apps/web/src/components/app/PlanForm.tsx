import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { draftedKeys, draftingStatusSchema, type PlanDraftReply } from "@/lib/api/drafting";
import { createdPlanSchema, publishedPlanVersionSchema } from "@/lib/api/schemas";
import { draftSummary, fillFromDraft, type FormKey, type Sources } from "@/lib/draft-fill";
import { shortDigest } from "@/lib/format";
import { checkDraft, type PlanDraft } from "@/lib/plan-form";
import { useNow } from "@/lib/use-now";
import { useResource } from "@/lib/use-resource";
import { Panel } from "./AppShell";
import { CuratorFeeFields } from "./CuratorFeeFields";
import { DraftFromMessage } from "./DraftFromMessage";
import { Field } from "./Field";
import { Problem } from "./Notice";
import { SelectField } from "./SelectField";

const emptyDraft: PlanDraft = {
  environment: "live",
  market: "BTC-USD",
  direction: "long",
  entryMin: "",
  entryMax: "",
  stopPrice: "",
  targetPrice: "",
  closesAtLocal: "",
  rationale: "",
  builderCode: "",
  curatorFeeBps: "",
};

const fieldNames: Record<FormKey, string> = {
  environment: "where it runs",
  market: "market",
  direction: "direction",
  entryMin: "lowest entry",
  entryMax: "highest entry",
  stopPrice: "stop",
  targetPrice: "target",
  closesAtLocal: "entry window",
  rationale: "why this setup",
  builderCode: "builder code",
  curatorFeeBps: "curator fee",
};

const environmentOptions = [
  { value: "live", label: "Live: real orders on Strike" },
  { value: "replay", label: "Replay: simulated, no money" },
];
const directionOptions = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
];
const listedMarkets = ["BTC-USD", "ETH-USD"];

const marketOptions = (current: string) =>
  (listedMarkets.includes(current) ? listedMarkets : [...listedMarkets, current]).map((market) => ({
    value: market,
    label: market,
  }));

const fromMessage = (quote: string | undefined) =>
  quote === undefined ? undefined : `From your message: “${quote}”`;

const without = (sources: Sources, key: FormKey): Sources =>
  Object.fromEntries(Object.entries(sources).filter(([name]) => name !== key));

type Drafted = { missing: FormKey[] };

function DraftSummary({ drafted }: { drafted: Drafted }) {
  const summary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    summary.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    summary.current?.focus({ preventScroll: true });
  }, [drafted]);
  const complete = drafted.missing.length === 0;
  return (
    <p
      ref={summary}
      tabIndex={-1}
      role="status"
      className={`t-body rounded-card border border-ink p-4 outline-none ${complete ? "bg-mint" : "bg-butter"}`}
    >
      {draftSummary(
        draftedKeys.length,
        drafted.missing.map((key) => fieldNames[key]),
      )}
    </p>
  );
}

type Published = { publicId: string; version: number; digest: string };

export function PlanForm({ communityId }: { communityId: string }) {
  const drafting = useResource("drafting", (signal) =>
    apiRequest(draftingStatusSchema, "/api/drafting", { signal }),
  );
  const [draft, setDraft] = useState(emptyDraft);
  const [sources, setSources] = useState<Sources>({});
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const now = useNow(1000);
  const check = checkDraft(draft, now);
  const errors = touched && !check.ok ? check.errors : {};
  const set = (key: FormKey) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSources((current) => without(current, key));
  };

  const applyDraft = (reply: PlanDraftReply) => {
    const filled = fillFromDraft(draft, reply.draft);
    setDraft(filled.draft);
    setSources(filled.sources);
    setDrafted({ missing: filled.missing });
    setTouched(true);
  };

  const publish = async () => {
    setTouched(true);
    if (!check.ok) {
      return;
    }
    try {
      const created = await apiRequest(createdPlanSchema, "/api/plans", {
        method: "POST",
        body: { communityId, fields: check.plan },
      });
      setPublished(
        await apiRequest(publishedPlanVersionSchema, `/api/plans/${created.plan.id}/publish`, {
          method: "POST",
          body: {},
        }),
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The plan was not published.");
    }
  };

  if (published !== null) {
    return (
      <Panel className="bg-mint">
        <h2 className="t-card">Published to your group</h2>
        <p className="t-body">
          Version {published.version} is fixed with digest {shortDigest(published.digest)}. Members
          open it from the card in Telegram.
        </p>
        <Link to={`/p/${published.publicId}`} className="t-body underline underline-offset-4">
          Open the public plan
        </Link>
      </Panel>
    );
  }

  return (
    <>
      {drafting.status === "ready" && drafting.data.available ? (
        <DraftFromMessage onDrafted={applyDraft} />
      ) : null}
      <Panel>
        <h2 className="t-card">New plan</h2>
        {drafted !== null ? <DraftSummary drafted={drafted} /> : null}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <SelectField
            label="Runs on"
            value={draft.environment}
            options={environmentOptions}
            onChange={(value) => {
              setDraft((current) => ({
                ...current,
                environment: value === "replay" ? "replay" : "live",
              }));
            }}
            wide
          />
          <SelectField
            label="Market"
            value={draft.market}
            options={marketOptions(draft.market)}
            onChange={set("market")}
            hint={fromMessage(sources.market)}
          />
          <SelectField
            label="Direction"
            value={draft.direction}
            options={directionOptions}
            onChange={(value) => {
              setDraft((current) => ({
                ...current,
                direction: value === "short" ? "short" : "long",
              }));
              setSources((current) => without(current, "direction"));
            }}
            hint={fromMessage(sources.direction)}
          />
          <Field
            label="Lowest entry"
            value={draft.entryMin}
            onChange={set("entryMin")}
            inputMode="decimal"
            error={errors.entryMin}
            hint={fromMessage(sources.entryMin)}
          />
          <Field
            label="Highest entry"
            value={draft.entryMax}
            onChange={set("entryMax")}
            inputMode="decimal"
            error={errors.entryMax}
            hint={fromMessage(sources.entryMax)}
          />
          <Field
            label="Stop"
            value={draft.stopPrice}
            onChange={set("stopPrice")}
            inputMode="decimal"
            error={errors.stopPrice}
            hint={fromMessage(sources.stopPrice)}
          />
          <Field
            label="Target"
            value={draft.targetPrice}
            onChange={set("targetPrice")}
            inputMode="decimal"
            error={errors.targetPrice}
            hint={fromMessage(sources.targetPrice)}
          />
          <Field
            label="Entry window closes"
            type="datetime-local"
            value={draft.closesAtLocal}
            onChange={set("closesAtLocal")}
            error={errors.closesAtLocal}
            hint={fromMessage(sources.closesAtLocal) ?? "In your local time; stored in UTC."}
          />
          <Field
            label="Why this setup"
            value={draft.rationale}
            onChange={set("rationale")}
            error={errors.rationale}
            hint={sources.rationale === undefined ? undefined : "Copied from your message."}
          />
          <CuratorFeeFields draft={draft} errors={errors} onChange={set} />
        </div>
        <div>
          <ActionButton onClick={() => void publish()}>Publish to the group</ActionButton>
        </div>
        {problem !== null ? <Problem title="Not published">{problem}</Problem> : null}
      </Panel>
    </>
  );
}
