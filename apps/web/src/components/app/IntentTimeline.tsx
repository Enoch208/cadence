import type { Environment, IntentState } from "@cadence/core";
import { Alert02Icon, Clock01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { intentStateDetail, intentStateLabel } from "@/lib/copy/states";

const happyPath: readonly IntentState[] = [
  "reserved",
  "submitted",
  "open_verifying",
  "open_verified",
  "closed",
];
const attention: ReadonlySet<IntentState> = new Set(["unknown", "recovery_required"]);
const stopped: ReadonlySet<IntentState> = new Set([
  "blocked",
  "rejected",
  "unfilled",
  "canceled",
  "expired",
]);

export function IntentTimeline({
  state,
  environment,
}: {
  state: IntentState;
  environment: Environment;
}) {
  const reached = happyPath.indexOf(state);
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-3">
        {happyPath.map((step, index) => {
          const done = reached >= 0 && index <= reached;
          return (
            <li key={step} className="t-body flex items-center gap-3">
              <span
                className={`flex size-7 items-center justify-center rounded-full border border-ink ${done ? "bg-mint" : "bg-paper"}`}
              >
                <HugeiconsIcon icon={done ? Tick02Icon : Clock01Icon} size={14} strokeWidth={2} />
              </span>
              {intentStateLabel(step, environment)}
            </li>
          );
        })}
      </ol>
      {attention.has(state) || stopped.has(state) ? (
        <p
          role="status"
          className={`t-body flex items-start gap-3 rounded-card border border-ink p-4 ${attention.has(state) ? "bg-butter" : "bg-blush"}`}
        >
          <HugeiconsIcon icon={Alert02Icon} size={20} strokeWidth={1.6} className="mt-1 shrink-0" />
          <span>
            <strong>{intentStateLabel(state, environment)}.</strong>{" "}
            {intentStateDetail(state, environment)}
          </span>
        </p>
      ) : (
        <p className="t-body">{intentStateDetail(state, environment)}</p>
      )}
    </div>
  );
}
