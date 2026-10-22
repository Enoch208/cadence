import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalJson, type Environment } from "@cadence/core";

const algorithm = "aes-256-gcm";
const keyBytes = 32;
const ivBytes = 12;
const tagBytes = 16;

export type CredentialBinding = {
  userId: string;
  strikeAccountId: string;
  environment: Environment;
};

export type SealedCredential = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
};

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialVaultError";
  }
}

function requireKey(key: Uint8Array): void {
  if (key.byteLength !== keyBytes) {
    throw new CredentialVaultError("The key encryption key must be exactly 32 bytes");
  }
}

function requireKeyVersion(keyVersion: number): void {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new CredentialVaultError("The key version must be a positive integer");
  }
}

const associatedData = (binding: CredentialBinding, keyVersion: number) =>
  Buffer.from(canonicalJson({ ...binding, keyVersion }), "utf8");

export function sealCredential(args: {
  plaintext: string;
  key: Uint8Array;
  keyVersion: number;
  binding: CredentialBinding;
}): SealedCredential {
  requireKey(args.key);
  requireKeyVersion(args.keyVersion);
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, args.key, iv, { authTagLength: tagBytes });
  cipher.setAAD(associatedData(args.binding, args.keyVersion));
  const ciphertext = Buffer.concat([cipher.update(args.plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: args.keyVersion,
  };
}

const unopenable = () =>
  new CredentialVaultError(
    "The sealed credential does not open for this owner, account, environment and key version",
  );

function decrypt(sealed: SealedCredential, key: Uint8Array, binding: CredentialBinding): Buffer {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  if (iv.byteLength !== ivBytes || tag.byteLength !== tagBytes) {
    throw unopenable();
  }
  const decipher = createDecipheriv(algorithm, key, iv, { authTagLength: tagBytes });
  decipher.setAAD(associatedData(binding, sealed.keyVersion));
  decipher.setAuthTag(tag);
  const head = decipher.update(Buffer.from(sealed.ciphertext, "base64"));
  try {
    return Buffer.concat([head, decipher.final()]);
  } catch {
    head.fill(0);
    throw unopenable();
  }
}

export function openCredential(
  sealed: SealedCredential,
  key: Uint8Array,
  binding: CredentialBinding,
): string {
  requireKey(key);
  requireKeyVersion(sealed.keyVersion);
  return decrypt(sealed, key, binding).toString("utf8");
}
