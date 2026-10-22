import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { PublishedPlan } from "./plan";

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot represent a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot represent a value of type ${typeof value}`);
}

export const canonicalJson = (value: unknown): string => canonicalValue(value);

export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

export const planVersionDigest = (plan: PublishedPlan): string => sha256Hex(canonicalJson(plan));
