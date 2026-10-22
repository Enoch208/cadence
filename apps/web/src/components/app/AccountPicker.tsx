import { Link } from "react-router";
import type { ConnectedAccount } from "@/lib/api/schemas";
import { EnvironmentBadge } from "./EnvironmentBadge";

type AccountPickerProps = {
  accounts: readonly ConnectedAccount[];
  selected: string | null;
  onSelect: (accountId: string) => void;
};

export function AccountPicker({ accounts, selected, onSelect }: AccountPickerProps) {
  const usable = accounts.filter((account) => account.status === "active");
  if (usable.length === 0) {
    return (
      <p className="t-body">
        You have no active account for this plan yet.{" "}
        <Link to="/account" className="underline underline-offset-4">
          Connect one first
        </Link>
        .
      </p>
    );
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="t-card mb-3">Which account?</legend>
      {usable.map((account) => (
        <label
          key={account.id}
          className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-btn border border-ink p-4 ${selected === account.id ? "bg-sky" : "bg-paper"}`}
        >
          <span className="t-body flex items-center gap-3">
            <input
              type="radio"
              name="account"
              value={account.id}
              checked={selected === account.id}
              onChange={() => {
                onSelect(account.id);
              }}
              className="size-4 accent-ink"
            />
            {account.environment === "replay"
              ? `Replay account …${account.strikeAccountId.slice(-6)}`
              : `Strike account ${account.strikeAccountId}`}
          </span>
          <EnvironmentBadge environment={account.environment} />
        </label>
      ))}
    </fieldset>
  );
}
