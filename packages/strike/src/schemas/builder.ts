import { z } from "zod";
import { jsonId, jsonInteger } from "../json";

export const challengeResponseSchema = z.object({
  nonce: z.guid(),
  message_to_sign: z.string().min(1).max(4096),
});

export const registeredWalletResponseSchema = z.object({
  account_id: z.string().min(1),
  builder_code: z.string().min(1),
  fee_share_bps: jsonInteger,
  api_wallet_id: jsonId,
  api_wallet_public_key: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
