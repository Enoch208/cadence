import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { createSigner } from "../src/signer";
import { keyRenderings, rfc8032Vector1, throwawayKeys, verifies } from "./support/keys";

const thrownMessage = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message} ${String(error.stack)}` : "";
  }
  throw new Error("Expected the action to throw");
};

describe("createSigner", () => {
  it("signs exactly as RFC 8032 Ed25519 does", () => {
    const signer = createSigner(rfc8032Vector1);
    expect(signer.sign("")).toBe(rfc8032Vector1.emptyMessageSignatureHex);
  });

  it("produces a signature that verifies against the registered public key", () => {
    const keys = throwawayKeys();
    const signer = createSigner(keys);
    const message = "GET:/v2/account:1792600000:3f1d2c4b-1a2b-4c3d-8e9f-0a1b2c3d4e5f:e3b0";
    const signature = signer.sign(message);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifies(keys.publicKeyHex, message, signature)).toBe(true);
    expect(verifies(keys.publicKeyHex, `${message}0`, signature)).toBe(false);
  });

  it("accepts a 128-hex expanded key by signing with its first 32 bytes", () => {
    const keys = throwawayKeys();
    const expanded = createSigner({
      publicKeyHex: keys.publicKeyHex,
      privateKeyHex: `${keys.privateKeyHex}${keys.publicKeyHex}`,
    });
    expect(expanded.sign("same message")).toBe(createSigner(keys).sign("same message"));
  });

  it("exposes the public key in lowercase whatever case it was given in", () => {
    const signer = createSigner({
      publicKeyHex: rfc8032Vector1.publicKeyHex.toUpperCase(),
      privateKeyHex: rfc8032Vector1.privateKeyHex.toUpperCase(),
    });
    expect(signer.publicKeyHex).toBe(rfc8032Vector1.publicKeyHex);
  });

  it("refuses a private key that does not belong to the public key", () => {
    const mine = throwawayKeys();
    const theirs = throwawayKeys();
    expect(() =>
      createSigner({ publicKeyHex: theirs.publicKeyHex, privateKeyHex: mine.privateKeyHex }),
    ).toThrow("The private key does not belong to this public key");
  });

  it.each([
    ["too short", "ab".repeat(31)],
    ["between the two lengths", "ab".repeat(48)],
    ["not hex", "zz".repeat(32)],
    ["padded", ` ${"ab".repeat(32)}`],
  ])("refuses a private key that is %s", (_label, privateKeyHex) => {
    expect(() =>
      createSigner({ publicKeyHex: rfc8032Vector1.publicKeyHex, privateKeyHex }),
    ).toThrow("The private key must be 64 or 128 hex characters");
  });

  it("refuses a public key that is not 64 hex characters", () => {
    expect(() =>
      createSigner({ publicKeyHex: "ab".repeat(31), privateKeyHex: rfc8032Vector1.privateKeyHex }),
    ).toThrow("The public key must be 64 hex characters");
  });
});

describe("the private key never leaves the signer", () => {
  it("is absent from every rendering of the signer", () => {
    const keys = throwawayKeys();
    const signer = createSigner(keys);
    const renderings = [
      JSON.stringify(signer),
      inspect(signer, { showHidden: true, depth: Infinity, getters: true }),
      Object.keys(signer).join(","),
    ];
    for (const rendering of renderings) {
      for (const secret of keyRenderings(keys.privateKeyHex)) {
        expect(rendering).not.toContain(secret);
      }
    }
  });

  it("is absent from every error the signer throws", () => {
    const mine = throwawayKeys();
    const theirs = throwawayKeys();
    const messages = [
      thrownMessage(() =>
        createSigner({ publicKeyHex: theirs.publicKeyHex, privateKeyHex: mine.privateKeyHex }),
      ),
      thrownMessage(() =>
        createSigner({
          publicKeyHex: theirs.publicKeyHex,
          privateKeyHex: `${mine.privateKeyHex}00`,
        }),
      ),
      thrownMessage(() =>
        createSigner({ publicKeyHex: `${mine.privateKeyHex}0`, privateKeyHex: mine.privateKeyHex }),
      ),
    ];
    for (const message of messages) {
      for (const secret of keyRenderings(mine.privateKeyHex)) {
        expect(message).not.toContain(secret);
      }
      expect(message).not.toContain(`${mine.privateKeyHex}00`);
    }
  });

  it("cannot be modified after creation", () => {
    const signer = createSigner(throwawayKeys());
    expect(Object.isFrozen(signer)).toBe(true);
  });
});
