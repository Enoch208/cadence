import { describe, expect, it } from "vitest";
import { orderRoles } from "../src/contract";
import { canonicalJson, planVersionDigest, sha256Hex } from "../src/digest";
import { clientOrderIdFor, strategyIdFor } from "../src/identity";
import { publishedPlanSchema } from "../src/plan";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";
const reservedPrefixes = [
  "copy:",
  "liq_",
  "bankrupt_",
  "adl_",
  "if_transfer_",
  "if_adl_",
  "vault_wd_",
];

describe("order identities", () => {
  it("derives the same identity for the same intent every time", () => {
    expect(clientOrderIdFor(intentId, "entry")).toBe(clientOrderIdFor(intentId, "entry"));
    expect(strategyIdFor(intentId)).toBe(`cad-${intentId}`);
  });

  it("gives every role its own client order ID", () => {
    const ids = orderRoles.map((role) => clientOrderIdFor(intentId, role));
    expect(new Set(ids).size).toBe(orderRoles.length);
  });

  it("stays inside Strike's length limit and away from its reserved prefixes", () => {
    for (const role of orderRoles) {
      const id = clientOrderIdFor(intentId, role);
      expect(id.length).toBeLessThanOrEqual(256);
      expect(reservedPrefixes.some((prefix) => id.startsWith(prefix))).toBe(false);
    }
  });
});

describe("canonical digests", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("refuses values JSON cannot carry faithfully", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  it("hashes the empty string to the known SHA-256 value", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("gives a plan the same digest however its fields are ordered", () => {
    const plan = publishedPlanSchema.parse({
      schemaVersion: 1,
      market: "BTC-USD",
      direction: "long",
      entryMin: "84000",
      entryMax: "84400",
      stopPrice: "83200",
      targetPrice: "86800",
      triggerSource: "mark_price",
      entryExpiresAt: "2026-10-23T18:00:00Z",
      rationale: "",
      environment: "live",
    });
    const reordered = publishedPlanSchema.parse(Object.fromEntries(Object.entries(plan).reverse()));
    expect(planVersionDigest(reordered)).toBe(planVersionDigest(plan));
    expect(planVersionDigest(plan)).toMatch(/^[0-9a-f]{64}$/);
  });
});
