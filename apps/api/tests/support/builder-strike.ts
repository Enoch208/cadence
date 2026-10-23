import { randomUUID } from "node:crypto";
import { createBuilderConnectClient } from "@cadence/strike";
import { testNow } from "./fixtures";

export const testBuilderCode = "cadence";
export const solanaWallet = {
  chain: "solana" as const,
  address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};
export const memberSignature = "3".repeat(88);

type Challenge = {
  address: string;
  chain: string;
  publicKey: string;
  code: string;
  feeShareBps: number;
};
type Scripted = { status: number; body: unknown } | "hang";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const consentMessage = (challenge: Challenge, nonce: string) =>
  [
    `Connect to Strike via builder "${challenge.code}".`,
    `This authorizes the builder to collect up to ${String(challenge.feeShareBps / 100)}% fee on your trades.`,
    "Referral attribution: none.",
    "By signing, you are entrusting your API wallet private key to this builder. You trust the builder to store and use this key responsibly.",
    `Wallet: ${challenge.address}`,
    `Chain: ${challenge.chain}`,
    `API Key: ${challenge.publicKey}`,
    `Nonce: ${nonce}`,
    "Timestamp: 2026-10-22T09:00:00Z",
    "",
    "Complete verify-signature within 5 minutes; after that the challenge expires.",
  ].join("\n");

const hang = (signal: AbortSignal | null | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    });
  });

export function fakeBuilderStrike() {
  const state = {
    accountId: "strike-sub-42",
    challenges: new Map<string, Challenge>(),
    asked: [] as Record<string, unknown>[],
    verified: [] as Record<string, unknown>[],
    registered: [] as string[],
    startReply: null as Scripted | null,
    verifyReply: null as Scripted | null,
    registerDespiteReply: false,
  };

  function requestSignature(body: Record<string, unknown>) {
    state.asked.push(body);
    const nonce = randomUUID();
    const challenge = {
      address: String(body.address),
      chain: String(body.chain),
      publicKey: String(body.public_key),
      code: String(body.code),
      feeShareBps: Number(body.fee_share_bps),
    };
    state.challenges.set(nonce, challenge);
    const message = consentMessage(challenge, nonce);
    return reply(200, { nonce, message_to_sign: message, message });
  }

  function verifySignature(body: Record<string, unknown>, signal: AbortSignal | null | undefined) {
    state.verified.push(body);
    const nonce = String(body.nonce);
    const challenge = state.challenges.get(nonce);
    state.challenges.delete(nonce);
    if (challenge === undefined) {
      return reply(400, { error: "challenge not found or expired" });
    }
    if (body.wallet_signature !== memberSignature) {
      return reply(401, { error: "wallet signature verification failed" });
    }
    if (state.verifyReply === null || state.registerDespiteReply) {
      state.registered.push(challenge.publicKey);
    }
    if (state.verifyReply === "hang") {
      return hang(signal);
    }
    if (state.verifyReply !== null) {
      return reply(state.verifyReply.status, state.verifyReply.body);
    }
    return reply(200, {
      account_id: state.accountId,
      nickname: "",
      avatar_url: "",
      builder_code: challenge.code,
      fee_share_bps: challenge.feeShareBps,
      api_wallet_id: 4321,
      api_wallet_public_key: challenge.publicKey,
      api_wallet_expired_at: "9999-12-31T23:59:59Z",
      referral: { status: "not_requested" },
    });
  }

  const fetch: typeof globalThis.fetch = (input, init) => {
    if (!(input instanceof URL) || typeof init?.body !== "string") {
      return Promise.reject(new Error("The builder client must send a URL and a string body"));
    }
    const url = input;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (url.pathname === "/auth/builder/request-signature") {
      const scripted = state.startReply;
      if (scripted === "hang") {
        return hang(init.signal);
      }
      return Promise.resolve(
        scripted === null ? requestSignature(body) : reply(scripted.status, scripted.body),
      );
    }
    if (url.pathname === "/auth/builder/verify-signature") {
      return Promise.resolve(verifySignature(body, init.signal));
    }
    return Promise.reject(new Error(`The fake builder Strike does not serve ${url.pathname}`));
  };

  const client = createBuilderConnectClient({
    baseUrl: "https://strike.test",
    builderCode: testBuilderCode,
    fetch,
    timeoutMs: 100,
    now: () => testNow,
  });
  return { client, state };
}
