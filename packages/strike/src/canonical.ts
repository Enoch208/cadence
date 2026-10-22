import { createHash } from "node:crypto";

export type HttpMethod = "GET" | "POST" | "DELETE";

export type RestSigningInput = {
  method: HttpMethod;
  pathWithQuery: string;
  timestampSeconds: number;
  nonce: string;
  body: string;
};

export const bodyHash = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("hex");

const isWholeNonNegative = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function restSigningMessage(input: RestSigningInput): string {
  if (!isWholeNonNegative(input.timestampSeconds)) {
    throw new Error("The signing timestamp must be a whole number of seconds");
  }
  if (!input.pathWithQuery.startsWith("/")) {
    throw new Error("The signed path must start with /");
  }
  return [
    input.method,
    input.pathWithQuery,
    String(input.timestampSeconds),
    input.nonce,
    bodyHash(input.body),
  ].join(":");
}

export function logonMessage(timestampMs: number, publicKeyHex: string): string {
  if (!isWholeNonNegative(timestampMs)) {
    throw new Error("The logon timestamp must be a whole number of milliseconds");
  }
  return `session.logon:${String(timestampMs)}:${publicKeyHex}`;
}
