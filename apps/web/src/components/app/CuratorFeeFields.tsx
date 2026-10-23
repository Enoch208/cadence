import { builderCodesUrl, curatorFeeNotYetLive } from "@/lib/copy/curator-fee";
import type { PlanDraft } from "@/lib/plan-form";
import { Field } from "./Field";

type FeeKey = "builderCode" | "curatorFeeBps";

type CuratorFeeFieldsProps = {
  draft: PlanDraft;
  errors: Partial<Record<keyof PlanDraft, string>>;
  onChange: (key: FeeKey) => (value: string) => void;
};

export function CuratorFeeFields({ draft, errors, onChange }: CuratorFeeFieldsProps) {
  const offered = draft.builderCode.trim() !== "" || draft.curatorFeeBps.trim() !== "";
  return (
    <>
      <Field
        label="Your Strike builder code"
        value={draft.builderCode}
        onChange={onChange("builderCode")}
        error={errors.builderCode}
        hint="Optional. Members who connect under it pay your fee."
      />
      <Field
        label="Curator fee (bps)"
        value={draft.curatorFeeBps}
        onChange={onChange("curatorFeeBps")}
        inputMode="numeric"
        error={errors.curatorFeeBps}
        hint="Optional. 1 to 20 basis points of each fill; 20 is 0.20%."
      />
      <p className="t-body md:col-span-2">
        You register your builder code on Strike at{" "}
        <a href={builderCodesUrl} className="break-all underline underline-offset-4">
          {builderCodesUrl}
        </a>
        .
      </p>
      {offered && draft.environment === "live" ? (
        <p className="t-body rounded-card border border-ink bg-butter p-4 md:col-span-2">
          {curatorFeeNotYetLive}
        </p>
      ) : null}
    </>
  );
}
