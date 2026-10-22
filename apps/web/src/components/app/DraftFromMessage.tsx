import { useId, useState } from "react";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { planDraftSchema, type PlanDraftReply } from "@/lib/api/drafting";
import { Panel } from "./AppShell";
import { Problem } from "./Notice";

const example = "BTC long. Entry 84,000 to 84,500, stop 83,200, target 86,800. Valid for 4 hours.";

export function DraftFromMessage({ onDrafted }: { onDrafted: (reply: PlanDraftReply) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const read = async () => {
    setReading(true);
    setProblem(null);
    try {
      onDrafted(
        await apiRequest(planDraftSchema, "/api/drafting/plan", {
          method: "POST",
          body: { text },
        }),
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your message could not be read.");
    } finally {
      setReading(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-col gap-2">
        <h2 className="t-card">Start from your message</h2>
        <p className="t-body">
          Paste the setup as you wrote it for your group. Claude copies the levels into the form and
          shows the words each one came from. Nothing is published until you check the plan and
          press Publish.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="t-body font-medium">
          Your message
        </label>
        <textarea
          id={id}
          value={text}
          rows={4}
          maxLength={4000}
          placeholder={example}
          onChange={(event) => {
            setText(event.target.value);
          }}
          className="min-h-[132px] resize-y rounded-btn border border-ink bg-paper p-4 t-body outline-none focus-visible:bg-sky"
        />
      </div>
      <div>
        <ActionButton onClick={() => void read()} disabled={reading || text.trim() === ""}>
          {reading ? "Reading your message" : "Fill the plan"}
        </ActionButton>
      </div>
      {problem !== null ? <Problem title="The plan was not filled">{problem}</Problem> : null}
    </Panel>
  );
}
