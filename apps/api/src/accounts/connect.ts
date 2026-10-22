import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { RiskPolicy } from "@cadence/core";
import { accountConnections, sealCredential, type AccountConnectionRow } from "@cadence/db";
import {
  createSigner,
  type ReplayScenarioName,
  type Signer,
  type StrikeClient,
} from "@cadence/strike";
import type { AppDeps } from "../deps";
import { keyEncryptionKeyBytes } from "../env";
import { recordEvent, userActor } from "../events";
import { conflict, unprocessable } from "../http/errors";
import { askStrike } from "../http/strike";
import { effectivePolicy } from "../policies/service";
import { accountView } from "./service";

const taken = () =>
  conflict(
    "ACCOUNT_ALREADY_CONNECTED",
    "That Strike account is already connected to another Cadence member.",
  );

function proveKeyPair(keys: { publicKey: string; privateKey: string }): Signer {
  try {
    return createSigner({ publicKeyHex: keys.publicKey, privateKeyHex: keys.privateKey });
  } catch {
    throw unprocessable(
      "KEY_PAIR_MISMATCH",
      "That private key does not belong to that public key.",
    );
  }
}

async function resolveAccountId(client: StrikeClient, policy: RiskPolicy): Promise<string> {
  const [market = "BTC-USD"] = policy.allowedMarkets;
  const state = await askStrike("read your Strike account", () => client.accountState(market));
  return state.account.accountId;
}

async function configureMarkets(client: StrikeClient, policy: RiskPolicy): Promise<void> {
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

async function recordConnection(deps: AppDeps, userId: string, row: AccountConnectionRow) {
  await recordEvent(deps.db, {
    at: deps.now(),
    actor: userActor(userId),
    correlationId: row.id,
    environment: row.environment,
    type: "account_connected",
    data: { strikeAccountId: row.strikeAccountId },
  });
  return accountView(row);
}

export async function connectLiveAccount(
  deps: AppDeps,
  userId: string,
  keys: { publicKey: string; privateKey: string },
) {
  const signer = proveKeyPair(keys);
  const client = deps.strike.forSigner(signer);
  const policy = await effectivePolicy(deps.db, userId);
  const strikeAccountId = await resolveAccountId(client, policy);
  if (await heldByAnotherMember(deps, userId, strikeAccountId)) {
    throw taken();
  }
  await configureMarkets(client, policy);
  const sealed = sealCredential({
    plaintext: keys.privateKey,
    key: keyEncryptionKeyBytes(deps.env),
    keyVersion: deps.env.KEY_ENCRYPTION_KEY_VERSION,
    binding: { userId, strikeAccountId, environment: "live" },
  });
  const credential = {
    publicKey: signer.publicKeyHex,
    keyCiphertext: sealed.ciphertext,
    keyIv: sealed.iv,
    keyTag: sealed.tag,
    keyVersion: sealed.keyVersion,
  };
  const [row] = await deps.db
    .insert(accountConnections)
    .values({ userId, environment: "live", strikeAccountId, ...credential, createdAt: deps.now() })
    .onConflictDoUpdate({
      target: [accountConnections.environment, accountConnections.strikeAccountId],
      set: credential,
      setWhere: eq(accountConnections.userId, userId),
    })
    .returning();
  if (row === undefined) {
    throw taken();
  }
  return recordConnection(deps, userId, row);
}

export async function connectReplayAccount(
  deps: AppDeps,
  userId: string,
  scenario: ReplayScenarioName,
) {
  const row: AccountConnectionRow = {
    id: randomUUID(),
    userId,
    environment: "replay",
    strikeAccountId: `replay-${randomUUID()}`,
    publicKey: null,
    keyCiphertext: null,
    keyIv: null,
    keyTag: null,
    keyVersion: null,
    replayScenario: scenario,
    status: "active",
    createdAt: deps.now(),
  };
  await configureMarkets(deps.strike.forConnection(row), await effectivePolicy(deps.db, userId));
  const [inserted] = await deps.db.insert(accountConnections).values(row).returning();
  return recordConnection(deps, userId, inserted ?? row);
}
