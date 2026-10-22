import { z } from "zod";
import { createSigner, type Signer } from "./signer";

export const strikeCredentialsSchema = z.object({
  STRIKE_API_PUBLIC_KEY: z
    .string({ error: "is missing" })
    .regex(/^[0-9a-fA-F]{64}$/, "is not 64 hex characters"),
  STRIKE_API_PRIVATE_KEY: z
    .string({ error: "is missing" })
    .regex(/^(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/, "is not 64 or 128 hex characters"),
  STRIKE_SUBACCOUNT_ID: z.string({ error: "is missing" }).min(1, "is empty"),
});

export type StrikeCredentials = {
  readonly publicKeyHex: string;
  readonly subAccountId: string;
  readonly signer: Signer;
};

export function loadStrikeCredentials(env: Record<string, string | undefined>): StrikeCredentials {
  const parsed = strikeCredentialsSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
    throw new Error(`The Strike credentials cannot be used: ${problems.join("; ")}`);
  }
  const signer = createSigner({
    publicKeyHex: parsed.data.STRIKE_API_PUBLIC_KEY,
    privateKeyHex: parsed.data.STRIKE_API_PRIVATE_KEY,
  });
  return Object.freeze({
    publicKeyHex: signer.publicKeyHex,
    subAccountId: parsed.data.STRIKE_SUBACCOUNT_ID,
    signer,
  });
}
