import { useState } from "react";
import { Link } from "react-router";
import { AppShell, Panel } from "@/components/app/AppShell";
import { Field } from "@/components/app/Field";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import {
  communitiesSchema,
  createdCommunitySchema,
  createdPlanSchema,
  publishedPlanVersionSchema,
} from "@/lib/api/schemas";
import { checkDraft, type PlanDraft } from "@/lib/plan-form";
import { shortDigest } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useResource } from "@/lib/use-resource";

const emptyDraft: PlanDraft = {
  market: "BTC-USD",
  direction: "long",
  entryMin: "",
  entryMax: "",
  stopPrice: "",
  targetPrice: "",
  closesAtLocal: "",
  rationale: "",
};

function CommunitySetup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    try {
      await apiRequest(createdCommunitySchema, "/api/communities", {
        method: "POST",
        body: { name, telegramChatId: chatId },
      });
      onCreated();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The community was not created.");
    }
  };
  return (
    <Panel>
      <h2 className="t-card">Your Telegram group</h2>
      <p className="t-body">
        Add the Cadence bot to your group as an admin, then enter the group’s chat ID.
      </p>
      <Field label="Community name" value={name} onChange={setName} />
      <Field
        label="Telegram chat ID"
        value={chatId}
        onChange={setChatId}
        inputMode="numeric"
        hint="Group IDs start with -100."
      />
      <div>
        <ActionButton
          onClick={() => void create()}
          disabled={name.trim() === "" || chatId.trim() === ""}
        >
          Save the group
        </ActionButton>
      </div>
      {problem !== null ? <Problem title="Not saved">{problem}</Problem> : null}
    </Panel>
  );
}

function PlanForm({ communityId }: { communityId: string }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [published, setPublished] = useState<{
    publicId: string;
    version: number;
    digest: string;
  } | null>(null);
  const now = useNow(1000);
  const check = checkDraft(draft, now);
  const errors = touched && !check.ok ? check.errors : {};
  const set = (key: keyof PlanDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
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
    <Panel>
      <h2 className="t-card">New plan</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="t-body font-medium">Market</span>
          <select
            value={draft.market}
            onChange={(event) => {
              set("market")(event.target.value);
            }}
            className="h-[54px] rounded-btn border border-ink bg-paper px-4 t-body"
          >
            <option value="BTC-USD">BTC-USD</option>
            <option value="ETH-USD">ETH-USD</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="t-body font-medium">Direction</span>
          <select
            value={draft.direction}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                direction: event.target.value === "short" ? "short" : "long",
              }));
            }}
            className="h-[54px] rounded-btn border border-ink bg-paper px-4 t-body"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <Field
          label="Lowest entry"
          value={draft.entryMin}
          onChange={set("entryMin")}
          inputMode="decimal"
          error={errors.entryMin}
        />
        <Field
          label="Highest entry"
          value={draft.entryMax}
          onChange={set("entryMax")}
          inputMode="decimal"
          error={errors.entryMax}
        />
        <Field
          label="Stop"
          value={draft.stopPrice}
          onChange={set("stopPrice")}
          inputMode="decimal"
          error={errors.stopPrice}
        />
        <Field
          label="Target"
          value={draft.targetPrice}
          onChange={set("targetPrice")}
          inputMode="decimal"
          error={errors.targetPrice}
        />
        <Field
          label="Entry window closes"
          type="datetime-local"
          value={draft.closesAtLocal}
          onChange={set("closesAtLocal")}
          error={errors.closesAtLocal}
          hint="In your local time; stored in UTC."
        />
        <Field
          label="Why this setup"
          value={draft.rationale}
          onChange={set("rationale")}
          error={errors.rationale}
        />
      </div>
      <div>
        <ActionButton onClick={() => void publish()}>Publish to the group</ActionButton>
      </div>
      {problem !== null ? <Problem title="Not published">{problem}</Problem> : null}
    </Panel>
  );
}

function Author() {
  const communities = useResource("communities", (signal) =>
    apiRequest(communitiesSchema, "/api/communities", { signal }),
  );
  if (communities.status !== "ready") {
    return communities.status === "failed" ? (
      <Problem title="Your groups could not be loaded" onRetry={communities.reload}>
        {communities.error.message}
      </Problem>
    ) : (
      <Loading label="Loading your groups" />
    );
  }
  const community = communities.data.communities[0];
  return community === undefined ? (
    <CommunitySetup onCreated={communities.reload} />
  ) : (
    <PlanForm communityId={community.id} />
  );
}

export function AuthorPage() {
  return (
    <AppShell>
      <LoginGate>{() => <Author />}</LoginGate>
    </AppShell>
  );
}
