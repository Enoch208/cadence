import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import {
  builderChallenges,
  openCredential,
  sealCredential,
  type BuilderChallengeRow,
} from "@cadence/db";
import {
  createSigner,
  type BuilderChallenge,
  type BuilderWallet,
  type Signer,
  type SignerKeys,
} from "@cadence/strike";
import type { AppDeps } from "../deps";
import { keyEncryptionKeyBytes } from "../env";
import { HttpError, notFound } from "../http/errors";

const pendingBinding = (row: { userId: string; id: string }) => ({
  userId: row.userId,
  builderChallengeId: row.id,
  environment: "live" as const,
});

const unknownChallenge = () =>
  notFound("That signing request does not exist. Start again.", "CHALLENGE_NOT_FOUND");

const expiredChallenge = () =>
  new HttpError(410, "CHALLENGE_EXPIRED", "That signing request expired. Start again.");

export async function savePendingChallenge(
  deps: AppDeps,
  userId: string,
  pending: {
    wallet: BuilderWallet;
    keys: SignerKeys;
    challenge: BuilderChallenge;
    expiresAt: number;
  },
): Promise<BuilderChallengeRow> {
  const id = randomUUID();
  const sealed = sealCredential({
    plaintext: pending.keys.privateKeyHex,
    key: keyEncryptionKeyBytes(deps.env),
    keyVersion: deps.env.KEY_ENCRYPTION_KEY_VERSION,
    binding: pendingBinding({ userId, id }),
  });
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    await tx.delete(builderChallenges).where(lte(builderChallenges.expiresAt, now));
    const [row] = await tx
      .insert(builderChallenges)
      .values({
        id,
        userId,
        walletChain: pending.wallet.chain,
        walletAddress: pending.wallet.address,
        publicKey: pending.keys.publicKeyHex,
        keyCiphertext: sealed.ciphertext,
        keyIv: sealed.iv,
        keyTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        strikeNonce: pending.challenge.nonce,
        consentMessage: pending.challenge.message,
        expiresAt: pending.expiresAt,
        createdAt: now,
      })
      .returning();
    if (row === undefined) {
      throw new Error("Saving the signing request returned no row");
    }
    return row;
  });
}

const ownedBy = (userId: string, id: string) =>
  and(eq(builderChallenges.id, id), eq(builderChallenges.userId, userId));

export async function livePendingChallenge(
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<BuilderChallengeRow> {
  const [row] = await deps.db.select().from(builderChallenges).where(ownedBy(userId, id));
  if (row === undefined) {
    throw unknownChallenge();
  }
  if (row.expiresAt <= deps.now()) {
    await deps.db.delete(builderChallenges).where(ownedBy(userId, id));
    throw expiredChallenge();
  }
  return row;
}

export async function claimPendingChallenge(
  deps: AppDeps,
  row: BuilderChallengeRow,
): Promise<{ signer: Signer; privateKeyHex: string }> {
  const [claimed] = await deps.db
    .delete(builderChallenges)
    .where(ownedBy(row.userId, row.id))
    .returning();
  if (claimed === undefined) {
    throw unknownChallenge();
  }
  const privateKeyHex = openCredential(
    {
      ciphertext: claimed.keyCiphertext,
      iv: claimed.keyIv,
      tag: claimed.keyTag,
      keyVersion: claimed.keyVersion,
    },
    keyEncryptionKeyBytes(deps.env),
    pendingBinding(claimed),
  );
  return {
    signer: createSigner({ publicKeyHex: claimed.publicKey, privateKeyHex }),
    privateKeyHex,
  };
}
