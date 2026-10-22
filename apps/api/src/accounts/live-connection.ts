import { and, eq, ne, sql } from "drizzle-orm";
import type { RiskPolicy } from "@cadence/core";
import {
  accountConnections,
  sealCredential,
  type AccountConnectionRow,
  type CredentialSource,
} from "@cadence/db";
import type { Signer, StrikeClient } from "@cadence/strike";
import type { AppDeps } from "../deps";
import { keyEncryptionKeyBytes } from "../env";
import { recordEvent, userActor, type ApplicationEvent } from "../events";
import { conflict, HttpError } from "../http/errors";
import { askStrike } from "../http/strike";
import { effectivePolicy } from "../policies/service";
import { accountView } from "./service";

export type EventDetail = ApplicationEvent["data"];

export type LiveCredential = {
  signer: Signer;
  privateKeyHex: string;
  source: CredentialSource;
  reportedAccountId: string | null;
  detail: EventDetail;
};

const taken = () =>
  conflict(
    "ACCOUNT_ALREADY_CONNECTED",
    "That Strike account is already connected to another Cadence member.",
  );

const contradicted = () =>
  new HttpError(
    502,
    "ACCOUNT_MISMATCH",
    "Strike named two different accounts for this key, so Cadence did not store it.",
  );

async function resolveAccountId(client: StrikeClient, policy: RiskPolicy): Promise<string> {
  const [market = "BTC-USD"] = policy.allowedMarkets;
  const state = await askStrike("read your Strike account", () => client.accountState(market));
  return state.account.accountId;
}

export async function configureMarkets(client: StrikeClient, policy: RiskPolicy): Promise<void> {
  const listed = await askStrike("read Strike's markets", () => client.markets());
  const symbols = new Set(listed.map((market) => market.symbol));
  for (const market of policy.allowedMarkets.filter((symbol) => symbols.has(symbol))) {
    const settings = { marginMode: "isolated" as const, leverage: policy.leverageCap };
    await askStrike(`set isolated margin on ${market}`, () =>
      client.configureSymbol(market, settings),
    );
  }
}

async function heldByAnotherMember(deps: AppDeps, userId: string, strikeAccountId: string) {
  const [row] = await deps.db
    .select({ id: accountConnections.id })
    .from(accountConnections)
    .where(
      and(
        eq(accountConnections.environment, "live"),
        eq(accountConnections.strikeAccountId, strikeAccountId),
        ne(accountConnections.userId, userId),
      ),
    );
  return row !== undefined;
}

export async function recordConnection(
  deps: AppDeps,
  userId: string,
  row: AccountConnectionRow,
  detail: EventDetail = {},
) {
  await recordEvent(deps.db, {
    at: deps.now(),
    actor: userActor(userId),
    correlationId: row.id,
    environment: row.environment,
    type: "account_connected",
    data: { strikeAccountId: row.strikeAccountId, ...detail },
  });
  return accountView(row);
}

const revivedStatus = sql`case when ${accountConnections.status} = 'disconnected'
  then 'active'::connection_status else ${accountConnections.status} end`;

export async function storeLiveConnection(deps: AppDeps, userId: string, live: LiveCredential) {
  const client = deps.strike.forSigner(live.signer);
  const policy = await effectivePolicy(deps.db, userId);
  const strikeAccountId = await resolveAccountId(client, policy);
  if (live.reportedAccountId !== null && live.reportedAccountId !== strikeAccountId) {
    throw contradicted();
  }
  if (await heldByAnotherMember(deps, userId, strikeAccountId)) {
    throw taken();
  }
  await configureMarkets(client, policy);
  const sealed = sealCredential({
    plaintext: live.privateKeyHex,
    key: keyEncryptionKeyBytes(deps.env),
    keyVersion: deps.env.KEY_ENCRYPTION_KEY_VERSION,
    binding: { userId, strikeAccountId, environment: "live" },
  });
  const credential = {
    publicKey: live.signer.publicKeyHex,
    keyCiphertext: sealed.ciphertext,
    keyIv: sealed.iv,
    keyTag: sealed.tag,
    keyVersion: sealed.keyVersion,
    credentialSource: live.source,
  };
  const [row] = await deps.db
    .insert(accountConnections)
    .values({ userId, environment: "live", strikeAccountId, ...credential, createdAt: deps.now() })
    .onConflictDoUpdate({
      target: [accountConnections.environment, accountConnections.strikeAccountId],
      set: { ...credential, status: revivedStatus },
      setWhere: eq(accountConnections.userId, userId),
    })
    .returning();
  if (row === undefined) {
    throw taken();
  }
  return recordConnection(deps, userId, row, { credentialSource: live.source, ...live.detail });
}
