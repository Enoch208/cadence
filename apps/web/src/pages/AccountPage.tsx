import { useState } from "react";
import { AppShell, Panel } from "@/components/app/AppShell";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import { Field } from "@/components/app/Field";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import { apiRequest } from "@/lib/api/client";
import { accountSchema, accountsSchema, type ConnectedAccount } from "@/lib/api/schemas";
import { useResource } from "@/lib/use-resource";
import { ReplayAccounts } from "./ReplayAccounts";
import { RiskRules } from "./RiskRules";

function AccountRow({ account, onChanged }: { account: ConnectedAccount; onChanged: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = async () => {
    const action = account.status === "paused" ? "resume" : "pause";
    try {
      await apiRequest(accountSchema, `/api/accounts/${account.id}/${action}`, {
        method: "POST",
        body: {},
      });
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The change did not go through.");
    }
  };
  return (
    <li className="flex flex-col gap-3 border-t border-ink py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="t-body font-medium">
          {account.environment === "replay"
            ? `Replay account …${account.strikeAccountId.slice(-6)}`
            : `Strike account ${account.strikeAccountId}`}
        </span>
        <EnvironmentBadge environment={account.environment} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="t-body">
          {account.status === "paused" ? "Paused: no new entries" : "Active"}
        </span>
        <ActionButton onClick={() => void toggle()}>
          {account.status === "paused" ? "Resume new entries" : "Pause new entries"}
        </ActionButton>
      </div>
      {problem !== null ? <Problem title="Not changed">{problem}</Problem> : null}
    </li>
  );
}

function ConnectLive({ onConnected }: { onConnected: () => void }) {
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await apiRequest(accountSchema, "/api/accounts", {
        method: "POST",
        body: { publicKey: publicKey.trim(), privateKey: privateKey.trim() },
      });
      setPrivateKey("");
      onConnected();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The account was not connected.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <h2 className="t-card">Connect a Strike sub-account</h2>
      <p className="t-body">
        Create an API key in Strike bound to one sub-account you set aside for Cadence. A key like
        that can trade only that sub-account and can never withdraw. Cadence stores it encrypted and
        never shows it again.
      </p>
      <Field
        label="API public key"
        value={publicKey}
        onChange={setPublicKey}
        hint="64 hexadecimal characters."
      />
      <Field
        label="API private key"
        type="password"
        value={privateKey}
        onChange={setPrivateKey}
        autoComplete="new-password"
        hint="Sent once over HTTPS, then kept only in encrypted form."
      />
      <div>
        <ActionButton
          onClick={() => void connect()}
          disabled={busy || publicKey.trim() === "" || privateKey.trim() === ""}
        >
          {busy ? "Checking with Strike…" : "Connect"}
        </ActionButton>
      </div>
      {problem !== null ? <Problem title="Not connected">{problem}</Problem> : null}
    </Panel>
  );
}

function Accounts() {
  const accounts = useResource("accounts", (signal) =>
    apiRequest(accountsSchema, "/api/accounts", { signal }),
  );
  if (accounts.status !== "ready") {
    return accounts.status === "failed" ? (
      <Problem title="Your accounts could not be loaded" onRetry={accounts.reload}>
        {accounts.error.message}
      </Problem>
    ) : (
      <Loading label="Loading your accounts" />
    );
  }
  return (
    <>
      <Panel>
        <h1 className="t-title">Your accounts</h1>
        {accounts.data.accounts.length === 0 ? (
          <p className="t-body">None connected yet.</p>
        ) : (
          <ul className="flex flex-col">
            {accounts.data.accounts.map((account) => (
              <AccountRow key={account.id} account={account} onChanged={accounts.reload} />
            ))}
          </ul>
        )}
      </Panel>
      <ConnectLive onConnected={accounts.reload} />
      <ReplayAccounts onAdded={accounts.reload} />
      <RiskRules />
    </>
  );
}

export function AccountPage() {
  return (
    <AppShell>
      <LoginGate>{() => <Accounts />}</LoginGate>
    </AppShell>
  );
}
