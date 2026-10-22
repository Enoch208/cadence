import {
  createLiveStrikeClient,
  createReplayStrikeClient,
  createServerClock,
  createSigner,
  replayScenarioNames,
  replayScenarios,
  type ReplayScenarioName,
  type ReplayStrikeClient,
  type StrikeClient,
} from "@cadence/strike";
import { openCredential } from "./credential-vault";
import type { AccountConnectionRow } from "./schema/accounts";

export type ConnectionClientDeps = {
  keyEncryptionKey: Uint8Array;
  strikeApiBase: string;
  fetch: typeof fetch;
  now: () => number;
};

export const strikeTimeoutMs = 10_000;

const replayClients = new Map<string, ReplayStrikeClient>();

const isScenarioName = (value: string | null): value is ReplayScenarioName =>
  value !== null && (replayScenarioNames as readonly string[]).includes(value);

export function replayClientForConnection(
  connection: AccountConnectionRow,
  now: () => number,
): ReplayStrikeClient {
  const scenario = connection.replayScenario;
  if (connection.environment !== "replay" || !isScenarioName(scenario)) {
    throw new Error(`Connection ${connection.id} has no replay scenario Cadence knows`);
  }
  const existing = replayClients.get(connection.id);
  if (existing !== undefined) {
    return existing;
  }
  const client = createReplayStrikeClient(replayScenarios[scenario], now);
  replayClients.set(connection.id, client);
  return client;
}

function liveClientForConnection(
  connection: AccountConnectionRow,
  deps: ConnectionClientDeps,
): StrikeClient {
  const { publicKey, keyCiphertext, keyIv, keyTag, keyVersion } = connection;
  if (
    publicKey === null ||
    keyCiphertext === null ||
    keyIv === null ||
    keyTag === null ||
    keyVersion === null
  ) {
    throw new Error(`Connection ${connection.id} has no sealed credential`);
  }
  const privateKeyHex = openCredential(
    { ciphertext: keyCiphertext, iv: keyIv, tag: keyTag, keyVersion },
    deps.keyEncryptionKey,
    {
      userId: connection.userId,
      strikeAccountId: connection.strikeAccountId,
      environment: connection.environment,
    },
  );
  return createLiveStrikeClient({
    baseUrl: deps.strikeApiBase,
    signer: createSigner({ publicKeyHex: publicKey, privateKeyHex }),
    clock: createServerClock(deps.now),
    fetch: deps.fetch,
    timeoutMs: strikeTimeoutMs,
    now: deps.now,
  });
}

export function clientForConnection(
  connection: AccountConnectionRow,
  deps: ConnectionClientDeps,
): StrikeClient {
  return connection.environment === "live"
    ? liveClientForConnection(connection, deps)
    : replayClientForConnection(connection, deps.now);
}
