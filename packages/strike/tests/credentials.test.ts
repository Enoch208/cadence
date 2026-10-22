import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { loadStrikeCredentials, strikeCredentialsSchema } from "../src/credentials";
import { keyRenderings, throwawayKeys, verifies } from "./support/keys";

const subAccountId = "5f0c1a7e-3b2d-4c8e-9f1a-2d3c4b5a6e7f";

const environmentFor = (keys: { publicKeyHex: string; privateKeyHex: string }) => ({
  STRIKE_API_PUBLIC_KEY: keys.publicKeyHex,
  STRIKE_API_PRIVATE_KEY: keys.privateKeyHex,
  STRIKE_SUBACCOUNT_ID: subAccountId,
});

const failureOf = (env: Record<string, string | undefined>): string => {
  try {
    loadStrikeCredentials(env);
  } catch (error) {
    return error instanceof Error ? `${error.message} ${inspect(error, { depth: Infinity })}` : "";
  }
  throw new Error("Expected the credentials to be refused");
};

describe("loadStrikeCredentials", () => {
  it("returns a signer for the key pair and the sub-account it is bound to", () => {
    const keys = throwawayKeys();
    const credentials = loadStrikeCredentials(environmentFor(keys));
    expect(credentials.publicKeyHex).toBe(keys.publicKeyHex);
    expect(credentials.subAccountId).toBe(subAccountId);
    expect(verifies(keys.publicKeyHex, "probe", credentials.signer.sign("probe"))).toBe(true);
  });

  it("accepts a 128-hex expanded private key", () => {
    const keys = throwawayKeys();
    const expanded = { ...keys, privateKeyHex: `${keys.privateKeyHex}${keys.publicKeyHex}` };
    expect(() => loadStrikeCredentials(environmentFor(expanded))).not.toThrow();
  });

  it("names every missing variable", () => {
    const message = failureOf({});
    expect(message).toContain("STRIKE_API_PUBLIC_KEY");
    expect(message).toContain("STRIKE_API_PRIVATE_KEY");
    expect(message).toContain("STRIKE_SUBACCOUNT_ID");
  });

  it("names a malformed variable without printing its value", () => {
    const keys = throwawayKeys();
    const malformed = `${keys.privateKeyHex}0`;
    const message = failureOf({ ...environmentFor(keys), STRIKE_API_PRIVATE_KEY: malformed });
    expect(message).toContain("STRIKE_API_PRIVATE_KEY");
    expect(message).not.toContain(malformed);
    for (const secret of keyRenderings(keys.privateKeyHex)) {
      expect(message).not.toContain(secret);
    }
  });

  it("refuses a private key that belongs to another public key, without echoing it", () => {
    const mine = throwawayKeys();
    const theirs = throwawayKeys();
    const message = failureOf({
      ...environmentFor(theirs),
      STRIKE_API_PRIVATE_KEY: mine.privateKeyHex,
    });
    expect(message).toContain("does not belong");
    for (const secret of keyRenderings(mine.privateKeyHex)) {
      expect(message).not.toContain(secret);
    }
  });

  it("keeps the private key out of the credentials it returns", () => {
    const keys = throwawayKeys();
    const credentials = loadStrikeCredentials(environmentFor(keys));
    const renderings = [
      JSON.stringify(credentials),
      inspect(credentials, { depth: Infinity, showHidden: true, getters: true }),
    ];
    for (const rendering of renderings) {
      for (const secret of keyRenderings(keys.privateKeyHex)) {
        expect(rendering).not.toContain(secret);
      }
    }
  });
});

describe("strikeCredentialsSchema", () => {
  it.each([
    ["a 63-hex public key", { STRIKE_API_PUBLIC_KEY: "a".repeat(63) }],
    ["a 96-hex private key", { STRIKE_API_PRIVATE_KEY: "a".repeat(96) }],
    ["an empty sub-account", { STRIKE_SUBACCOUNT_ID: "" }],
  ])("refuses %s", (_label, change) => {
    const valid = {
      STRIKE_API_PUBLIC_KEY: "a".repeat(64),
      STRIKE_API_PRIVATE_KEY: "b".repeat(64),
      STRIKE_SUBACCOUNT_ID: subAccountId,
    };
    expect(strikeCredentialsSchema.safeParse(valid).success).toBe(true);
    expect(strikeCredentialsSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
