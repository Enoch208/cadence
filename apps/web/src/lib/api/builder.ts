import { z } from "zod";
import { walletChains } from "../wallets/chains";
import { accountSchema } from "./schemas";

export const sourcedAccountSchema = accountSchema.extend({
  credentialSource: z.enum(["api_key", "builder"]).nullable(),
});
export type SourcedAccount = z.infer<typeof sourcedAccountSchema>;

export const sourcedAccountsSchema = z.object({ accounts: z.array(sourcedAccountSchema) });

export const builderTermsSchema = z.object({
  available: z.boolean(),
  builderCode: z.string().nullable(),
  feeBps: z.number(),
  chains: z.array(z.enum(walletChains)),
  liveMaxNotional: z.string(),
});
export type BuilderTerms = z.infer<typeof builderTermsSchema>;

export const builderChallengeSchema = z.object({
  challengeId: z.string(),
  chain: z.enum(walletChains),
  address: z.string(),
  message: z.string(),
  expiresAt: z.number(),
});
export type BuilderChallenge = z.infer<typeof builderChallengeSchema>;
