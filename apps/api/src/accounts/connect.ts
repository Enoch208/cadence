import { randomUUID } from "node:crypto";
import { accountConnections, type AccountConnectionRow } from "@cadence/db";
import { createSigner, type ReplayScenarioName, type Signer } from "@cadence/strike";
import type { AppDeps } from "../deps";
import { unprocessable } from "../http/errors";
import { effectivePolicy } from "../policies/service";
import { configureMarkets, recordConnection, storeLiveConnection } from "./live-connection";

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

export function connectLiveAccount(
  deps: AppDeps,
  userId: string,
  keys: { publicKey: string; privateKey: string },
) {
  return storeLiveConnection(deps, userId, {
    signer: proveKeyPair(keys),
    privateKeyHex: keys.privateKey,
    source: "api_key",
    reportedAccountId: null,
    detail: {},
  });
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
    credentialSource: null,
    replayScenario: scenario,
    status: "active",
    createdAt: deps.now(),
  };
  await configureMarkets(deps.strike.forConnection(row), await effectivePolicy(deps.db, userId));
  const [inserted] = await deps.db.insert(accountConnections).values(row).returning();
  return recordConnection(deps, userId, inserted ?? row);
}
