import { describe, expect, it } from "vitest";
import {
  builderFeeShareBps,
  createBuilderConnectClient,
  walletAddressSchema,
  walletSignatureSchema,
} from "../src/builder-connect";
import { StrikeAmbiguousError, StrikeRateLimitedError, StrikeRejectedError } from "../src/errors";
import { generateSignerKeys } from "../src/signer";
import {
  challengeReply,
  documentedAccountId,
  documentedNonce,
  solanaAddress,
  verifiedReply,
} from "./support/builder";
import { fakeFetch, json, type RecordedRequest, type Reply } from "./support/fake-fetch";

const code = "cadence";
const baseUrl = "https://api.strikefinance.org";

function builderHarness(route: (request: RecordedRequest) => Reply) {
  const fake = fakeFetch(route);
  let now = 1_792_603_881_365;
  const client = createBuilderConnectClient({
    baseUrl,
    builderCode: code,
    fetch: fake.fetch,
    timeoutMs: 200,
    now: () => (now += 5),
  });
  return { client, requests: fake.requests };
}

const wallet = { chain: "solana" as const, address: solanaAddress };
const terms = { builderCode: code, feeShareBps: 0 };
const curatorTerms = { builderCode: "range_traders", feeShareBps: 5 };

describe("requesting a builder connect challenge", () => {
  it("asks Strike for the consent message with a zero fee and no API wallet headers", async () => {
    const keys = generateSignerKeys();
    const fields = { code, ...wallet, publicKeyHex: keys.publicKeyHex, nonce: documentedNonce };
    const { client, requests } = builderHarness(() => challengeReply(fields));
    const challenge = await client.requestSignature({
      ...wallet,
      publicKeyHex: keys.publicKeyHex,
      terms,
    });
    expect(challenge.nonce).toBe(documentedNonce);
    expect(challenge.message).toContain(`API Key: ${keys.publicKeyHex}`);
    expect(challenge.message).toContain("entrusting your API wallet private key");
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url.href).toBe(`${baseUrl}/auth/builder/request-signature`);
    expect(JSON.parse(request?.body ?? "")).toStrictEqual({
      address: solanaAddress,
      chain: "solana",
      code,
      fee_share_bps: 0,
      public_key: keys.publicKeyHex,
    });
    const headerNames = [...(request?.headers.keys() ?? [])];
    expect(headerNames.filter((name) => name.startsWith("x-"))).toEqual([]);
    expect(builderFeeShareBps).toBe(0);
  });

  it("refuses a consent message that does not name the key, the nonce and the builder", async () => {
    const keys = generateSignerKeys();
    const other = generateSignerKeys();
    const fields = { code, ...wallet, publicKeyHex: other.publicKeyHex, nonce: documentedNonce };
    const { client } = builderHarness(() => challengeReply(fields));
    await expect(
      client.requestSignature({ ...wallet, publicKeyHex: keys.publicKeyHex, terms }),
    ).rejects.toBeInstanceOf(StrikeAmbiguousError);
    const wrongBuilder = builderHarness(() =>
      challengeReply({ ...fields, code: "someone-else", publicKeyHex: keys.publicKeyHex }),
    );
    await expect(
      wrongBuilder.client.requestSignature({ ...wallet, publicKeyHex: keys.publicKeyHex, terms }),
    ).rejects.toBeInstanceOf(StrikeAmbiguousError);
  });

  it("asks Strike to approve a curator's code at the plan's fee instead of Cadence's own", async () => {
    const keys = generateSignerKeys();
    const fields = {
      code: curatorTerms.builderCode,
      ...wallet,
      publicKeyHex: keys.publicKeyHex,
      nonce: documentedNonce,
    };
    const { client, requests } = builderHarness(() => challengeReply(fields));
    await client.requestSignature({
      ...wallet,
      publicKeyHex: keys.publicKeyHex,
      terms: curatorTerms,
    });
    expect(JSON.parse(requests[0]?.body ?? "")).toMatchObject({
      code: "range_traders",
      fee_share_bps: 5,
    });
    expect(client.ownTerms).toEqual({ builderCode: code, feeShareBps: 0 });
  });

  it("refuses terms Strike could never accept before anything is sent", async () => {
    const keys = generateSignerKeys();
    const { client, requests } = builderHarness(() => json(500, "{}"));
    for (const bad of [
      { builderCode: "not a code", feeShareBps: 0 },
      { builderCode: code, feeShareBps: 101 },
      { builderCode: code, feeShareBps: 2.5 },
    ]) {
      await expect(
        client.requestSignature({ ...wallet, publicKeyHex: keys.publicKeyHex, terms: bad }),
      ).rejects.toThrow(/builder terms/);
    }
    expect(requests).toEqual([]);
  });

  it("passes on Strike's refusal of an inactive builder code", async () => {
    const keys = generateSignerKeys();
    const { client } = builderHarness(() => json(400, '{"error":"builder is not active"}'));
    const refusal = client.requestSignature({ ...wallet, publicKeyHex: keys.publicKeyHex, terms });
    await expect(refusal).rejects.toBeInstanceOf(StrikeRejectedError);
    await expect(refusal).rejects.toMatchObject({ status: 400 });
  });

  it("will not start with a builder code Strike could never accept", () => {
    expect(() =>
      createBuilderConnectClient({
        baseUrl,
        builderCode: "not a code",
        fetch: () => Promise.reject(new Error("never")),
        timeoutMs: 200,
        now: Date.now,
      }),
    ).toThrow(/builder code/);
  });
});

describe("verifying the member's wallet signature", () => {
  it("sends only the nonce and the signature, and maps the registered wallet", async () => {
    const keys = generateSignerKeys();
    const { client, requests } = builderHarness(() =>
      verifiedReply({ code, publicKeyHex: keys.publicKeyHex }),
    );
    const registered = await client.verifySignature({
      nonce: documentedNonce,
      walletSignature: "5Kd8Cj",
      publicKeyHex: keys.publicKeyHex,
      terms,
    });
    expect(registered).toEqual({
      accountId: documentedAccountId,
      builderCode: code,
      feeShareBps: 0,
      apiWalletId: "1234",
      publicKeyHex: keys.publicKeyHex,
    });
    const [request] = requests;
    expect(request?.url.href).toBe(`${baseUrl}/auth/builder/verify-signature`);
    expect(JSON.parse(request?.body ?? "")).toStrictEqual({
      nonce: documentedNonce,
      wallet_signature: "5Kd8Cj",
    });
  });

  it("treats a wallet Strike says it registered for another key, builder or fee as unknown", async () => {
    const keys = generateSignerKeys();
    const curator = builderHarness(() =>
      verifiedReply(
        { code: "range_traders", publicKeyHex: keys.publicKeyHex },
        { fee_share_bps: 5 },
      ),
    );
    await expect(
      curator.client.verifySignature({
        nonce: documentedNonce,
        walletSignature: "5Kd8Cj",
        publicKeyHex: keys.publicKeyHex,
        terms: curatorTerms,
      }),
    ).resolves.toMatchObject({ builderCode: "range_traders", feeShareBps: 5 });
    const strays = [
      { api_wallet_public_key: generateSignerKeys().publicKeyHex },
      { builder_code: "someone-else" },
      { fee_share_bps: 50 },
      { account_id: "" },
    ];
    for (const stray of strays) {
      const { client } = builderHarness(() =>
        verifiedReply({ code, publicKeyHex: keys.publicKeyHex }, stray),
      );
      await expect(
        client.verifySignature({
          nonce: documentedNonce,
          walletSignature: "5Kd8Cj",
          publicKeyHex: keys.publicKeyHex,
          terms,
        }),
      ).rejects.toBeInstanceOf(StrikeAmbiguousError);
    }
  });

  it("tells a refused signature from an outcome nobody knows", async () => {
    const keys = generateSignerKeys();
    const attempt = (reply: Reply) =>
      builderHarness(() => reply).client.verifySignature({
        nonce: documentedNonce,
        walletSignature: "5Kd8Cj",
        publicKeyHex: keys.publicKeyHex,
        terms,
      });
    await expect(
      attempt(json(401, '{"error":"wallet signature verification failed"}')),
    ).rejects.toMatchObject({ name: "StrikeRejectedError", status: 401 });
    await expect(
      attempt(json(400, '{"error":"challenge not found or expired"}')),
    ).rejects.toMatchObject({ name: "StrikeRejectedError", status: 400 });
    await expect(
      attempt(json(500, '{"error":"failed to create API wallet"}')),
    ).rejects.toBeInstanceOf(StrikeAmbiguousError);
    await expect(attempt("hang")).rejects.toBeInstanceOf(StrikeAmbiguousError);
    await expect(attempt(json(429, '{"error":"rate limit exceeded"}'))).rejects.toBeInstanceOf(
      StrikeRateLimitedError,
    );
  });
});

describe("the wallet formats Strike verifies", () => {
  it("accepts each chain's documented address and signature encodings", () => {
    expect(walletAddressSchema("solana").safeParse(solanaAddress).success).toBe(true);
    expect(
      walletAddressSchema("ethereum").safeParse("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18")
        .success,
    ).toBe(true);
    expect(
      walletAddressSchema("cardano").safeParse(
        "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
      ).success,
    ).toBe(true);
    expect(walletSignatureSchema("ethereum").safeParse(`0x${"ab".repeat(65)}`).success).toBe(true);
    expect(walletSignatureSchema("solana").safeParse("5".repeat(87)).success).toBe(true);
    expect(walletSignatureSchema("cardano").safeParse("845846a201:a4010103").success).toBe(true);
  });

  it("rejects an address or signature in another chain's encoding", () => {
    expect(walletAddressSchema("ethereum").safeParse(solanaAddress).success).toBe(false);
    expect(walletAddressSchema("cardano").safeParse("addr_test1qx2fxv2umyhttkxyxp8x").success).toBe(
      false,
    );
    expect(walletAddressSchema("solana").safeParse("0x742d35Cc6634C0532925a3b8").success).toBe(
      false,
    );
    expect(walletSignatureSchema("ethereum").safeParse("5".repeat(87)).success).toBe(false);
    expect(walletSignatureSchema("solana").safeParse(`0x${"ab".repeat(65)}`).success).toBe(false);
    expect(walletSignatureSchema("cardano").safeParse("845846a201").success).toBe(false);
  });
});
