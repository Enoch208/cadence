import { useState } from "react";
import { AppShell, Panel } from "@/components/app/AppShell";
import { Field } from "@/components/app/Field";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { PlanForm } from "@/components/app/PlanForm";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { communitiesSchema, createdCommunitySchema } from "@/lib/api/schemas";
import { telegramBotUsername } from "@/lib/env";
import { useResource } from "@/lib/use-resource";

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
        Add {telegramBotUsername === null ? "the Cadence bot" : `@${telegramBotUsername}`} to your
        group as an admin. It posts the group’s ID in the group; enter it here.
      </p>
      <Field label="Community name" value={name} onChange={setName} />
      <Field
        label="Telegram chat ID"
        value={chatId}
        onChange={setChatId}
        inputMode="text"
        hint="The bot posts it in the group when you add it."
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
