import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import { meSchema } from "@/lib/api/schemas";
import { telegramBotUsername } from "@/lib/env";
import { miniAppInitData, mountLoginWidget } from "@/lib/telegram";
import { useResource } from "@/lib/use-resource";
import { Loading, Problem } from "./Notice";
import { Panel } from "./AppShell";

export type SignedInUser = z.infer<typeof meSchema>["user"];

const signedOut = Symbol("signed-out");

async function currentUser(signal: AbortSignal): Promise<SignedInUser | typeof signedOut> {
  try {
    return (await apiRequest(meSchema, "/api/me", { signal })).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return signedOut;
    }
    throw error;
  }
}

function TelegramSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const widget = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const explain = (error: unknown) => {
      setProblem(error instanceof Error ? error.message : "Telegram sign-in failed.");
    };
    const submit = async (path: string, body: unknown) => {
      try {
        await apiRequest(meSchema, path, { method: "POST", body });
        onSignedIn();
      } catch (error) {
        explain(error);
      }
    };
    const start = async () => {
      const initData = await miniAppInitData();
      if (initData !== null) {
        await submit("/api/auth/telegram/webapp", { initData });
        return;
      }
      if (widget.current && telegramBotUsername !== null) {
        await mountLoginWidget(widget.current, telegramBotUsername, (fields) => {
          void submit("/api/auth/telegram/widget", fields);
        });
        return;
      }
      setProblem("Telegram sign-in is not configured on this deployment.");
    };
    start().catch(explain);
  }, [onSignedIn]);

  return (
    <Panel>
      <h1 className="t-title">Sign in with Telegram</h1>
      <p className="t-body">
        Cadence knows you by your Telegram account, the same one your group uses. It never asks for
        your wallet or seed phrase.
      </p>
      <div ref={widget} className="min-h-12" />
      {problem !== null ? <Problem title="Sign-in did not work">{problem}</Problem> : null}
    </Panel>
  );
}

export function LoginGate({ children }: { children: (user: SignedInUser) => ReactNode }) {
  const me = useResource("me", currentUser);
  if (me.status === "loading" || me.status === "idle") {
    return <Loading label="Checking who you are" />;
  }
  if (me.status === "failed") {
    return (
      <Problem title="Cadence could not be reached" onRetry={me.reload}>
        {me.error.message}
      </Problem>
    );
  }
  return me.data === signedOut ? <TelegramSignIn onSignedIn={me.reload} /> : children(me.data);
}
