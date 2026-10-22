import { useId } from "react";

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string | undefined;
  wide?: boolean;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  wide = false,
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${wide ? "md:col-span-2" : ""}`}>
      <label htmlFor={id} className="t-body font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={hint === undefined ? undefined : `${id}-note`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-[54px] w-full min-w-0 rounded-btn border border-ink bg-paper px-4 t-body"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : (
        <span id={`${id}-note`} className="t-body">
          {hint}
        </span>
      )}
    </div>
  );
}
