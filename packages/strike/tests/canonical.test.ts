import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bodyHash, logonMessage, restSigningMessage } from "../src/canonical";

const emptyBodyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("bodyHash", () => {
  it("hashes an empty body to SHA-256 of the empty string, never to an empty string", () => {
    expect(bodyHash("")).toBe(emptyBodyHash);
  });

  it("matches the FIPS 180-2 SHA-256 vector", () => {
    expect(bodyHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the UTF-8 bytes of the body", () => {
    const utf8 = createHash("sha256")
      .update(Buffer.from([0xc3, 0xa9]))
      .digest("hex");
    expect(bodyHash("é")).toBe(utf8);
  });

  it("distinguishes bodies that differ only in whitespace", () => {
    expect(bodyHash('{"a":"1"}')).not.toBe(bodyHash('{"a": "1"}'));
  });
});

describe("restSigningMessage", () => {
  it("joins method, path with query, timestamp, nonce and body hash", () => {
    expect(
      restSigningMessage({
        method: "GET",
        pathWithQuery: "/v2/positions?symbol=BTC-USD",
        timestampSeconds: 1792600000,
        nonce: "nonce-1",
        body: "",
      }),
    ).toBe(`GET:/v2/positions?symbol=BTC-USD:1792600000:nonce-1:${emptyBodyHash}`);
  });

  it("hashes the body it is given rather than including it", () => {
    const body = '{"symbol":"BTC-USD","client_order_id":"cad-1-e"}';
    expect(
      restSigningMessage({
        method: "DELETE",
        pathWithQuery: "/v2/order/cancel",
        timestampSeconds: 1792600001,
        nonce: "nonce-2",
        body,
      }),
    ).toBe(`DELETE:/v2/order/cancel:1792600001:nonce-2:${bodyHash(body)}`);
  });

  it.each([1792600000.5, Number.NaN, -1])("refuses the timestamp %s", (timestampSeconds) => {
    expect(() =>
      restSigningMessage({
        method: "GET",
        pathWithQuery: "/v2/account",
        timestampSeconds,
        nonce: "nonce-3",
        body: "",
      }),
    ).toThrow("The signing timestamp must be a whole number of seconds");
  });

  it("refuses a path that is not origin-relative", () => {
    expect(() =>
      restSigningMessage({
        method: "GET",
        pathWithQuery: "https://api.strikefinance.org/v2/account",
        timestampSeconds: 1792600000,
        nonce: "nonce-4",
        body: "",
      }),
    ).toThrow("The signed path must start with /");
  });
});

describe("logonMessage", () => {
  it("signs the WebSocket logon with a millisecond timestamp and the public key", () => {
    expect(logonMessage(1792600000123, "ab".repeat(32))).toBe(
      `session.logon:1792600000123:${"ab".repeat(32)}`,
    );
  });

  it("refuses a fractional millisecond timestamp", () => {
    expect(() => logonMessage(1792600000123.5, "ab".repeat(32))).toThrow(
      "The logon timestamp must be a whole number of milliseconds",
    );
  });
});
