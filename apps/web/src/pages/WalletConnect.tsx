import { useEffect, useState } from "react";
import { Panel } from "@/components/app/AppShell";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import { Loading, Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import {
  builderChallengeSchema,
  builderTermsSchema,
  type BuilderChallenge,
  type BuilderTerms,
} from "@/lib/api/builder";
import { apiRequest } from "@/lib/api/client";
import { accountSchema } from "@/lib/api/schemas";
import { useResource } from "@/lib/use-resource";
import type { ConnectedWallet, WalletOption } from "@/lib/wallets/chains";
import { detectWallets } from "@/lib/wallets/detect";
import { WalletError } from "@/lib/wallets/errors";
import { ConnectedNote, MessageReview, WalletList } from "./WalletSteps";
import { WalletTerms } from "./WalletTerms";

type Step =
  | { kind: "choose" }
  | { kind: "opening"; wallet: WalletOption }
  | {
      kind: "review" | "signing";
      wallet: WalletOption;
      connected: ConnectedWallet;
      challenge: BuilderChallenge;
    };

type Outcome = { title: string; body: string };
type Connected = (strikeAccountId: string) => void;

const lateExtensionMs = 800;

function useWallets(): WalletOption[] | null {
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  useEffect(() => {
    const scans = [0, lateExtensionMs].map((delay) =>
      window.setTimeout(() => {
        setWallets(detectWallets(window));
      }, delay),
    );
    return () => {
      scans.forEach((scan) => {
        window.clearTimeout(scan);
      });
    };
  }, []);
  return wallets;
}

const problemTitle = {
  declined: "Not connected",
  network: "Wrong network",
  failed: "Wallet error",
};

function failure(error: unknown): Outcome {
  if (error instanceof WalletError) {
    return { title: problemTitle[error.problem], body: error.message };
  }
  const body = error instanceof Error ? error.message : "The account was not connected.";
  return { title: "Not connected", body };
}

function Flow({ terms, onConnected }: { terms: BuilderTerms; onConnected: Connected }) {
  const wallets = useWallets();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const supported = wallets?.filter((wallet) => terms.chains.includes(wallet.chain)) ?? null;
  const backToChoosing = (next: Outcome | null) => {
    setStep({ kind: "choose" });
    setOutcome(next);
  };

  const open = async (wallet: WalletOption) => {
    setOutcome(null);
    setStep({ kind: "opening", wallet });
    try {
      const connected = await wallet.connect();
      const challenge = await apiRequest(builderChallengeSchema, "/api/accounts/builder/start", {
        method: "POST",
        body: { chain: connected.chain, address: connected.address },
      });
      setStep({ kind: "review", wallet, connected, challenge });
    } catch (error) {
      backToChoosing(failure(error));
    }
  };

  const sign = async () => {
    if (step.kind !== "review") {
      return;
    }
    setStep({ ...step, kind: "signing" });
    try {
      const signature = await step.connected.sign(step.challenge.message);
      const account = await apiRequest(accountSchema, "/api/accounts/builder/finish", {
        method: "POST",
        body: { challengeId: step.challenge.challengeId, signature },
      });
      backToChoosing(null);
      onConnected(account.strikeAccountId);
    } catch (error) {
      backToChoosing(failure(error));
    }
  };

  return (
    <>
      {step.kind === "choose" && supported === null ? (
        <Loading label="Looking for wallets in this browser" />
      ) : null}
      {step.kind === "choose" && supported !== null ? (
        <WalletList wallets={supported} onPick={(wallet) => void open(wallet)} />
      ) : null}
      {step.kind === "opening" ? <Loading label={`Waiting for ${step.wallet.name}`} /> : null}
      {step.kind === "review" || step.kind === "signing" ? (
        <MessageReview
          walletName={step.wallet.name}
          connected={step.connected}
          message={step.challenge.message}
        />
      ) : null}
      {step.kind === "review" ? (
        <div className="flex flex-wrap gap-3">
          <ActionButton onClick={() => void sign()}>Sign with {step.wallet.name}</ActionButton>
          <ActionButton
            onClick={() => {
              backToChoosing(null);
            }}
          >
            Cancel
          </ActionButton>
        </div>
      ) : null}
      {step.kind === "signing" ? (
        <Loading label={`Sign in ${step.wallet.name}, then Cadence checks it with Strike`} />
      ) : null}
      {outcome === null ? null : <Problem title={outcome.title}>{outcome.body}</Problem>}
    </>
  );
}

export function WalletConnect(props: {
  connectedAccountId: string | null;
  onConnected: Connected;
}) {
  const terms = useResource("builder-terms", (signal) =>
    apiRequest(builderTermsSchema, "/api/accounts/builder", { signal }),
  );
  if (terms.status !== "ready" || !terms.data.available) {
    return null;
  }
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-card">Connect with one signature</h2>
        <EnvironmentBadge environment="live" />
      </div>
      <p className="t-body">
        Sign one message with the wallet you use on Strike. Strike then creates an API key for that
        account and hands it to Cadence, so you never copy a key.
      </p>
      <WalletTerms terms={terms.data} />
      {props.connectedAccountId === null ? null : (
        <ConnectedNote strikeAccountId={props.connectedAccountId} />
      )}
      <Flow terms={terms.data} onConnected={props.onConnected} />
    </Panel>
  );
}
