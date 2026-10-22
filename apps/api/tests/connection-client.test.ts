import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  clientForConnection,
  CredentialVaultError,
  sealCredential,
  type AccountConnectionRow,
} from "@cadence/db";
import { StrikeReadError } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { testNow } from "./support/fixtures";

const keyEncryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function throwawayKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyHex: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"),
    seedHex: privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex"),
  };
}

function liveRow(keys: { publicKeyHex: string; seedHex: string }): AccountConnectionRow {
  const userId = randomUUID();
  const strikeAccountId = "strike-sub-7";
  const sealed = sealCredential({
    plaintext: keys.seedHex,
    key: keyEncryptionKey,
    keyVersion: 1,
    binding: { userId, strikeAccountId, environment: "live" },
  });
  return {
    id: randomUUID(),
    userId,
    environment: "live",
    strikeAccountId,
    publicKey: keys.publicKeyHex,
    keyCiphertext: sealed.ciphertext,
    keyIv: sealed.iv,
    keyTag: sealed.tag,
    keyVersion: sealed.keyVersion,
    replayScenario: null,
    status: "active",
    createdAt: testNow,
  };
}

const replayRow = (replayScenario: string): AccountConnectionRow => ({
  id: randomUUID(),
  userId: randomUUID(),
  environment: "replay",
  strikeAccountId: `replay-${randomUUID()}`,
  publicKey: null,
  keyCiphertext: null,
  keyIv: null,
  keyTag: null,
  keyVersion: null,
  replayScenario,
  status: "active",
  createdAt: testNow,
});

function recordingStrike() {
  const signedWith: (string | null)[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/v2/time") {
      return Promise.resolve(Response.json({ serverTime: testNow }));
    }
    signedWith.push(new Headers(init?.headers).get("X-API-Wallet-Public-Key"));
    return Promise.resolve(new Response("unavailable", { status: 503 }));
  };
  return { fetch, signedWith };
}

const deps = (fetch: typeof globalThis.fetch) => ({
  keyEncryptionKey,
  strikeApiBase: "https://strike.test",
  fetch,
  now: () => testNow,
});

describe("reaching a connection's exchange", () => {
  it("signs a live connection's requests with its own sealed key", async () => {
    const keys = throwawayKeyPair();
    const strike = recordingStrike();
    const client = clientForConnection(liveRow(keys), deps(strike.fetch));
    expect(client.environment).toBe("live");
    await expect(client.openOrders("BTC-USD")).rejects.toBeInstanceOf(StrikeReadError);
    expect(strike.signedWith).toEqual([keys.publicKeyHex]);
  });

  it("refuses a sealed key moved onto another account, without echoing it", () => {
    const keys = throwawayKeyPair();
    const moved = { ...liveRow(keys), strikeAccountId: "strike-sub-8" };
    let failure: unknown = null;
    try {
      clientForConnection(moved, deps(recordingStrike().fetch));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CredentialVaultError);
    expect(String((failure as Error).stack)).not.toContain(keys.seedHex);
  });

  it("keeps one replay exchange per connection, so its state survives between calls", async () => {
    const row = replayRow("happy_path");
    const first = clientForConnection(row, deps(recordingStrike().fetch));
    const again = clientForConnection(row, deps(recordingStrike().fetch));
    const another = clientForConnection(replayRow("happy_path"), deps(recordingStrike().fetch));
    expect(first.environment).toBe("replay");
    expect(again).toBe(first);
    expect(another).not.toBe(first);
    expect((await first.accountState("BTC-USD")).account.environment).toBe("replay");
  });

  it("refuses a replay scenario Cadence does not know", () => {
    expect(() =>
      clientForConnection(replayRow("moon_shot"), deps(recordingStrike().fetch)),
    ).toThrow(/replay scenario/);
  });
});
