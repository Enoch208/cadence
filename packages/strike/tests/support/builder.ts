import type { WalletChain } from "../../src/builder-connect";
import { json } from "./fake-fetch";

export const documentedNonce = "0192f0c1-7b8e-7c3a-9d61-2f1e4b5a6c7d";
export const documentedAccountId = "01a144dc-27e4-706c-ac46-9c2c1e77d60b";
export const solanaAddress = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

export type ConsentFields = {
  code: string;
  address: string;
  chain: WalletChain;
  publicKeyHex: string;
  nonce: string;
};

export const documentedConsentMessage = (fields: ConsentFields) =>
  [
    `Connect to Strike via builder "${fields.code}".`,
    "This authorizes the builder to collect up to 0% fee on your trades.",
    "Referral attribution: none.",
    "By signing, you are entrusting your API wallet private key to this builder. You trust the builder to store and use this key responsibly.",
    `Wallet: ${fields.address}`,
    `Chain: ${fields.chain}`,
    `API Key: ${fields.publicKeyHex}`,
    `Nonce: ${fields.nonce}`,
    "Timestamp: 2026-10-22T09:00:00Z",
    "",
    "Complete verify-signature within 5 minutes; after that the challenge expires.",
  ].join("\n");

export const challengeReply = (fields: ConsentFields) => {
  const message = documentedConsentMessage(fields);
  return json(
    200,
    JSON.stringify({ nonce: fields.nonce, message_to_sign: message, message: message }),
  );
};

export const verifiedReply = (
  fields: { code: string; publicKeyHex: string },
  overrides: Record<string, unknown> = {},
) =>
  json(
    200,
    JSON.stringify({
      account_id: documentedAccountId,
      nickname: "",
      avatar_url: "",
      builder_code: fields.code,
      fee_share_bps: 0,
      api_wallet_id: 1234,
      api_wallet_public_key: fields.publicKeyHex,
      api_wallet_expired_at: "9999-12-31T23:59:59Z",
      referral: { status: "not_requested" },
      ...overrides,
    }),
  );
