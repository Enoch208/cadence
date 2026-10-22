import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

export type Signer = {
  readonly publicKeyHex: string;
  sign(message: string): string;
};

export type SignerKeys = {
  publicKeyHex: string;
  privateKeyHex: string;
};

const seedHex = /^[0-9a-fA-F]{64}$/;
const expandedHex = /^[0-9a-fA-F]{128}$/;
const pkcs8Ed25519Prefix = Buffer.from("302e020100300506032b657004220420", "hex");

function seedBytes(privateKeyHex: string): Buffer {
  if (seedHex.test(privateKeyHex)) {
    return Buffer.from(privateKeyHex, "hex");
  }
  if (expandedHex.test(privateKeyHex)) {
    return Buffer.from(privateKeyHex.slice(0, 64), "hex");
  }
  throw new Error("The private key must be 64 or 128 hex characters");
}

function importSeed(seed: Buffer): KeyObject {
  const der = Buffer.concat([pkcs8Ed25519Prefix, seed]);
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
    seed.fill(0);
  }
}

const rawPublicKeyHex = (privateKey: KeyObject) =>
  createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

export function generateSignerKeys(): SignerKeys {
  const { privateKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  try {
    return { publicKeyHex: rawPublicKeyHex(privateKey), privateKeyHex: seed.toString("hex") };
  } finally {
    seed.fill(0);
  }
}

export function createSigner(keys: SignerKeys): Signer {
  if (!seedHex.test(keys.publicKeyHex)) {
    throw new Error("The public key must be 64 hex characters");
  }
  const privateKey = importSeed(seedBytes(keys.privateKeyHex));
  const publicKeyHex = rawPublicKeyHex(privateKey);
  if (publicKeyHex !== keys.publicKeyHex.toLowerCase()) {
    throw new Error("The private key does not belong to this public key");
  }
  return Object.freeze({
    publicKeyHex,
    sign: (message: string) => sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex"),
  });
}
