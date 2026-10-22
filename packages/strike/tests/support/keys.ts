import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";

export const rfc8032Vector1 = {
  privateKeyHex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKeyHex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  emptyMessageSignatureHex:
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
} as const;

export type TestKeys = { publicKeyHex: string; privateKeyHex: string };

export function throwawayKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  return {
    publicKeyHex: publicDer.subarray(-32).toString("hex"),
    privateKeyHex: privateDer.subarray(-32).toString("hex"),
  };
}

const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyObject(publicKeyHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

export const verifies = (publicKeyHex: string, message: string, signatureHex: string) =>
  verify(
    null,
    Buffer.from(message, "utf8"),
    publicKeyObject(publicKeyHex),
    Buffer.from(signatureHex, "hex"),
  );

export const keyRenderings = (privateKeyHex: string): readonly string[] => {
  const bytes = Buffer.from(privateKeyHex, "hex");
  return [
    privateKeyHex.toLowerCase(),
    privateKeyHex.toUpperCase(),
    bytes.toString("base64"),
    bytes.toString("base64url"),
  ];
};
