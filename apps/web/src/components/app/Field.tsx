import { useId } from "react";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "datetime-local";
  inputMode?: "decimal" | "numeric" | "text";
  hint?: string | undefined;
  error?: string | undefined;
  autoComplete?: string;
};

export function Field({
  label,
  value,
  onChange,
  type = "text",
  inputMode = "text",
  hint,
  error,
  autoComplete = "off",
}: FieldProps) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="t-body font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={error !== undefined}
        aria-describedby={`${id}-note`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-[54px] rounded-btn border border-ink bg-paper px-4 t-body tabular-nums outline-none focus-visible:bg-sky"
      />
      <span id={`${id}-note`} className={`t-body ${error === undefined ? "" : "font-medium"}`}>
        {error ?? hint ?? ""}
      </span>
    </div>
  );
}
