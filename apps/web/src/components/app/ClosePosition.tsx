import { useState } from "react";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { createdIntentSchema, type IntentView } from "@/lib/api/schemas";
import { closeProgress } from "@/lib/copy/close";
import { venueName } from "@/lib/copy/states";

const closableStates: ReadonlySet<IntentView["state"]> = new Set([
  "open_verifying",
  "open_verified",
]);

export function ClosePosition({ intent }: { intent: IntentView }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const venue = venueName[intent.environment];
  const progress = closeProgress(intent.events, venue);
  if (!closableStates.has(intent.state)) {
    return null;
  }
  if (progress !== null) {
    return <p className="t-body border-t border-ink pt-4">{progress}</p>;
  }
  const close = async () => {
    setBusy(true);
    try {
      await apiRequest(createdIntentSchema, `/api/intents/${encodeURIComponent(intent.id)}/close`, {
        method: "POST",
        body: {},
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The close request did not go through.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-4 border-t border-ink pt-4">
      {confirming ? (
        <>
          <p className="t-body">
            This sends one reduce-only order that closes your whole position at the market price on{" "}
            {venue}. Your stop and target are canceled after it fills.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              onClick={() => {
                void close();
              }}
              disabled={busy}
            >
              {busy ? "Closing…" : "Close at market"}
            </ActionButton>
            <ActionButton
              onClick={() => {
                setConfirming(false);
              }}
              disabled={busy}
            >
              Keep it open
            </ActionButton>
          </div>
        </>
      ) : (
        <ActionButton
          onClick={() => {
            setConfirming(true);
          }}
        >
          Close position
        </ActionButton>
      )}
      {problem !== null ? <p className="t-meta">{problem}</p> : null}
    </div>
  );
}
