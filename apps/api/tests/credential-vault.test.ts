import { Buffer } from "node:buffer";
import {
  CredentialVaultError,
  openCredential,
  sealCredential,
  type AccountCredentialBinding,
  type ChallengeCredentialBinding,
  type CredentialBinding,
  type SealedCredential,
} from "@cadence/db";
import { describe, expect, it } from "vitest";

const encryptionKeyHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f00011223344556677889aabbccddeeff0";
const encryptionKey = Uint8Array.from(Buffer.from(encryptionKeyHex, "hex"));
const delegatedKey = "5eed0fc0ffee1234".repeat(8);
const owner: AccountCredentialBinding = {
  userId: "5f0c8a52-0f39-4c2e-9d67-3a1f3b2a8e11",
  strikeAccountId: "strike-account-7",
  environment: "live",
};

const seal = () =>
  sealCredential({ plaintext: delegatedKey, key: encryptionKey, keyVersion: 1, binding: owner });

function flipFirstByte(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString("base64");
}

function openError(sealed: SealedCredential, binding: CredentialBinding, key = encryptionKey) {
  try {
    openCredential(sealed, key, binding);
  } catch (error) {
    return error;
  }
  throw new Error("The credential opened when it should not have");
}

describe("credential vault", () => {
  it("opens what it sealed for the same owner, account and environment", () => {
    expect(openCredential(seal(), encryptionKey, owner)).toBe(delegatedKey);
  });

  it("uses a fresh 12-byte IV for every seal", () => {
    const first = seal();
    const second = seal();
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(first.tag, "base64")).toHaveLength(16);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it.each([
    ["another user", { ...owner, userId: "0b7e7c8e-1d4f-4f5e-8a2b-6c9d0e1f2a3b" }],
    ["another Strike account", { ...owner, strikeAccountId: "strike-account-8" }],
    ["another environment", { ...owner, environment: "replay" as const }],
  ])("refuses to open for %s", (_, binding) => {
    expect(openError(seal(), binding)).toBeInstanceOf(CredentialVaultError);
  });

  it("refuses a ciphertext relabelled with another key version", () => {
    expect(openError({ ...seal(), keyVersion: 2 }, owner)).toBeInstanceOf(CredentialVaultError);
  });

  it("refuses a flipped ciphertext byte or a flipped tag byte", () => {
    const sealed = seal();
    expect(
      openError({ ...sealed, ciphertext: flipFirstByte(sealed.ciphertext) }, owner),
    ).toBeInstanceOf(CredentialVaultError);
    expect(openError({ ...sealed, tag: flipFirstByte(sealed.tag) }, owner)).toBeInstanceOf(
      CredentialVaultError,
    );
  });

  it("refuses another encryption key and a key of the wrong length", () => {
    const otherKey = Uint8Array.from(encryptionKey, (byte) => byte ^ 0x01);
    expect(openError(seal(), owner, otherKey)).toBeInstanceOf(CredentialVaultError);
    expect(() =>
      sealCredential({
        plaintext: delegatedKey,
        key: encryptionKey.subarray(0, 16),
        keyVersion: 1,
        binding: owner,
      }),
    ).toThrow(CredentialVaultError);
  });

  it("keeps a key sealed for a pending wallet connection from opening as an account's key", () => {
    const pending: ChallengeCredentialBinding = {
      userId: owner.userId,
      builderChallengeId: "8d1f3c52-2a4b-4c6d-9e8f-0a1b2c3d4e5f",
      environment: "live",
    };
    const sealed = sealCredential({
      plaintext: delegatedKey,
      key: encryptionKey,
      keyVersion: 1,
      binding: pending,
    });
    expect(openCredential(sealed, encryptionKey, pending)).toBe(delegatedKey);
    const asAccount = { ...owner, strikeAccountId: pending.builderChallengeId };
    expect(openError(sealed, asAccount)).toBeInstanceOf(CredentialVaultError);
    expect(
      openError(seal(), { ...pending, builderChallengeId: owner.strikeAccountId }),
    ).toBeInstanceOf(CredentialVaultError);
  });

  it("never echoes the key in the sealed record or in an error", () => {
    const sealed = seal();
    const failures = [
      openError(sealed, { ...owner, userId: "0b7e7c8e-1d4f-4f5e-8a2b-6c9d0e1f2a3b" }),
      openError({ ...sealed, tag: flipFirstByte(sealed.tag) }, owner),
    ];
    const exposed = [
      JSON.stringify(sealed),
      ...failures.map((failure) =>
        failure instanceof Error ? `${failure.message} ${failure.stack ?? ""}` : "",
      ),
    ].join("\n");
    expect(exposed).not.toContain(delegatedKey);
    expect(exposed).not.toContain(delegatedKey.slice(0, 16));
    expect(exposed).not.toContain(encryptionKeyHex);
  });
});
