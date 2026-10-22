import { generateKeyPairSync } from "node:crypto";

export function throwawayKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyHex: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"),
    seedHex: privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex"),
  };
}
