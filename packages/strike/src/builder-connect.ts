import { z } from "zod";
import { builderCodeSchema } from "@cadence/core";
import { StrikeAmbiguousError } from "./errors";
import { shaped } from "./live-requests";
import { challengeResponseSchema, registeredWalletResponseSchema } from "./schemas/builder";
import { createTransport, type TransportRequest } from "./transport";

export const walletChains = ["ethereum", "solana", "cardano"] as const;
export type WalletChain = (typeof walletChains)[number];

export const builderFeeShareBps = 0;
export const builderChallengeLifetimeMs = 5 * 60_000;

const base58 = "[1-9A-HJ-NP-Za-km-z]";
const hexPairs = "(?:[0-9a-fA-F]{2})";

const addressPatterns: Record<WalletChain, RegExp> = {
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  solana: new RegExp(`^${base58}{32,44}$`),
  cardano: /^addr1[02-9ac-hj-np-z]{50,200}$/,
};

const signaturePatterns: Record<WalletChain, RegExp> = {
  ethereum: new RegExp(`^(?:0x)?${hexPairs}{65,4096}$`),
  solana: new RegExp(`^${base58}{64,90}$`),
  cardano: new RegExp(`^${hexPairs}{1,4096}:${hexPairs}{1,1024}$`),
};

export const walletAddressSchema = (chain: WalletChain) =>
  z.string().regex(addressPatterns[chain], `is not a ${chain} mainnet address`);

export const walletSignatureSchema = (chain: WalletChain) =>
  z.string().regex(signaturePatterns[chain], `is not a ${chain} wallet signature`);

export type BuilderWallet = { chain: WalletChain; address: string };

export type BuilderChallenge = { nonce: string; message: string };

export type RegisteredBuilderWallet = {
  accountId: string;
  builderCode: string;
  feeShareBps: number;
  apiWalletId: string;
  publicKeyHex: string;
};

export interface BuilderConnectClient {
  readonly builderCode: string;
  requestSignature(input: BuilderWallet & { publicKeyHex: string }): Promise<BuilderChallenge>;
  verifySignature(input: {
    nonce: string;
    walletSignature: string;
    publicKeyHex: string;
  }): Promise<RegisteredBuilderWallet>;
}

export type BuilderConnectClientArgs = {
  baseUrl: string;
  builderCode: string;
  fetch: typeof fetch;
  timeoutMs: number;
  now: () => number;
};

const connectRequest = (
  operation: string,
  path: `/auth/builder/${string}`,
  body: Readonly<Record<string, unknown>>,
): TransportRequest => ({ operation, kind: "write", method: "POST", path, body });

const misanswered = (operation: string, detail: string) =>
  new StrikeAmbiguousError({ operation, reason: "response", detail });

const mentions = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

export function createBuilderConnectClient(args: BuilderConnectClientArgs): BuilderConnectClient {
  const builderCode = builderCodeSchema.parse(args.builderCode, {
    error: () => "The builder code is not a Strike builder code",
  });
  const transport = createTransport(args);

  async function requestSignature(input: BuilderWallet & { publicKeyHex: string }) {
    const publicKeyHex = input.publicKeyHex.toLowerCase();
    const request = connectRequest("builderRequestSignature", "/auth/builder/request-signature", {
      address: input.address,
      chain: input.chain,
      code: builderCode,
      fee_share_bps: builderFeeShareBps,
      public_key: publicKeyHex,
    });
    const reply = await transport.send(request);
    const challenge = shaped(request, () => challengeResponseSchema.parse(reply.body));
    const message = challenge.message_to_sign;
    const binds = [`"${builderCode}"`, publicKeyHex, challenge.nonce, input.address].every((part) =>
      mentions(message, part),
    );
    if (!binds) {
      throw misanswered(request.operation, "Strike's consent message does not name this request");
    }
    return { nonce: challenge.nonce, message };
  }

  async function verifySignature(input: {
    nonce: string;
    walletSignature: string;
    publicKeyHex: string;
  }): Promise<RegisteredBuilderWallet> {
    const request = connectRequest("builderVerifySignature", "/auth/builder/verify-signature", {
      nonce: input.nonce,
      wallet_signature: input.walletSignature,
    });
    const reply = await transport.send(request);
    const wallet = shaped(request, () => registeredWalletResponseSchema.parse(reply.body));
    const publicKeyHex = wallet.api_wallet_public_key.toLowerCase();
    if (
      publicKeyHex !== input.publicKeyHex.toLowerCase() ||
      wallet.builder_code !== builderCode ||
      wallet.fee_share_bps !== builderFeeShareBps
    ) {
      throw misanswered(request.operation, "Strike registered a different wallet than requested");
    }
    return {
      accountId: wallet.account_id,
      builderCode: wallet.builder_code,
      feeShareBps: wallet.fee_share_bps,
      apiWalletId: wallet.api_wallet_id,
      publicKeyHex,
    };
  }

  return { builderCode, requestSignature, verifySignature };
}
