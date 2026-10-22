import { accountConnections, builderChallenges, events, openCredential } from "@cadence/db";
import { createSigner, StrikeReadError } from "@cadence/strike";
import { afterEach, describe, expect, it, vi } from "vitest";
import { call, signIn, testApp, testKeyEncryptionKey } from "./support/app";
import {
  fakeBuilderStrike,
  memberSignature,
  solanaWallet,
  testBuilderCode,
} from "./support/builder-strike";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { curator, member } from "./support/flows";

resetDatabaseBetweenTests();
afterEach(() => {
  vi.restoreAllMocks();
});

type Started = { challengeId: string; message: string; expiresAt: number };

async function builderMember(options: { now?: () => number } = {}) {
  const strike = fakeBuilderStrike();
  const context = testApp({ builderConnect: strike.client, ...options });
  const cookie = await signIn(context.app, member);
  const start = (wallet: { chain: string; address: string } = solanaWallet, as = cookie) =>
    call(context.app, "POST", "/api/accounts/builder/start", { cookie: as, body: wallet });
  const finish = (challengeId: string, signature = memberSignature, as = cookie) =>
    call(context.app, "POST", "/api/accounts/builder/finish", {
      cookie: as,
      body: { challengeId, signature },
    });
  const started = async () => (await start()).body as Started;
  return { ...context, strike: strike.state, cookie, start, finish, started };
}

const publicKeyIn = (message: string) => /API Key: ([0-9a-f]{64})/.exec(message)?.[1] ?? "";

describe("wallet connect is off without a builder code", () => {
  it("tells the page it is off and refuses to start or finish", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    expect(await call(app, "GET", "/api/accounts/builder", { cookie })).toMatchObject({
      status: 200,
      body: { available: false, builderCode: null },
    });
    for (const path of ["/api/accounts/builder/start", "/api/accounts/builder/finish"]) {
      expect(await call(app, "POST", path, { cookie, body: {} })).toMatchObject({
        status: 503,
        body: { code: "BUILDER_CONNECT_OFF" },
      });
    }
  });

  it("needs a signed-in member", async () => {
    const { app } = testApp({ builderConnect: fakeBuilderStrike().client });
    const reply = await call(app, "POST", "/api/accounts/builder/start", { body: solanaWallet });
    expect(reply.status).toBe(401);
  });
});

describe("connecting a Strike account with one wallet signature", () => {
  it("describes what the member would approve: the builder, a zero fee and the chains", async () => {
    const { app, cookie } = await builderMember();
    expect(await call(app, "GET", "/api/accounts/builder", { cookie })).toMatchObject({
      status: 200,
      body: {
        available: true,
        builderCode: testBuilderCode,
        feeBps: 0,
        chains: ["ethereum", "solana", "cardano"],
        liveMaxNotional: "25",
      },
    });
  });

  it("keeps the generated key on the server, then registers, configures and seals it", async () => {
    const { live, strike, start, finish } = await builderMember();
    const startReply = await start();
    expect(startReply.status).toBe(201);
    const challenge = startReply.body as Started & { chain: string; address: string };
    const publicKey = publicKeyIn(challenge.message);
    expect(challenge).toMatchObject({ chain: "solana", address: solanaWallet.address });
    expect(challenge.message).toContain("entrusting your API wallet private key");
    expect(challenge.expiresAt).toBe(testNow + 270_000);
    expect(strike.asked).toEqual([
      {
        address: solanaWallet.address,
        chain: "solana",
        code: testBuilderCode,
        fee_share_bps: 0,
        public_key: publicKey,
      },
    ]);
    const [pending] = await db.select().from(builderChallenges);
    expect(pending?.publicKey).toBe(publicKey);
    expect(JSON.stringify(startReply.body)).not.toContain(pending?.keyCiphertext ?? "-");

    const reply = await finish(challenge.challengeId);
    expect(reply).toMatchObject({
      status: 201,
      body: {
        environment: "live",
        strikeAccountId: "strike-sub-42",
        credentialSource: "builder",
        status: "active",
      },
    });
    const [verified] = strike.verified;
    expect(Object.keys(verified ?? {})).toEqual(["nonce", "wallet_signature"]);
    expect(verified?.wallet_signature).toBe(memberSignature);
    expect(strike.registered).toEqual([publicKey]);
    expect(live.signedBy).toEqual([publicKey]);
    expect(live.configured.map(({ settings }) => settings.marginMode)).toEqual([
      "isolated",
      "isolated",
    ]);
    expect(await db.select().from(builderChallenges)).toEqual([]);
    const [row] = await db.select().from(accountConnections);
    const privateKeyHex = openCredential(
      {
        ciphertext: row?.keyCiphertext ?? "",
        iv: row?.keyIv ?? "",
        tag: row?.keyTag ?? "",
        keyVersion: row?.keyVersion ?? 0,
      },
      testKeyEncryptionKey,
      { userId: row?.userId ?? "", strikeAccountId: "strike-sub-42", environment: "live" },
    );
    expect(createSigner({ publicKeyHex: publicKey, privateKeyHex }).publicKeyHex).toBe(publicKey);
    const [connected] = await db.select().from(events);
    expect(connected).toMatchObject({
      type: "account_connected",
      data: {
        strikeAccountId: "strike-sub-42",
        credentialSource: "builder",
        walletChain: "solana",
        walletAddress: solanaWallet.address,
        builderCode: testBuilderCode,
        apiWalletId: "4321",
      },
    });
  });

  it("refuses an address in another chain's format before asking Strike", async () => {
    const { strike, start } = await builderMember();
    const reply = await start({ chain: "ethereum", address: solanaWallet.address });
    expect(reply).toMatchObject({ status: 400, body: { code: "INVALID_REQUEST" } });
    expect(strike.asked).toEqual([]);
  });

  it("keeps the challenge when the signature is malformed, so the member can sign again", async () => {
    const { strike, started, finish } = await builderMember();
    const { challengeId } = await started();
    expect(await finish(challengeId, "0xnot-a-solana-signature")).toMatchObject({
      status: 400,
      body: { code: "INVALID_REQUEST" },
    });
    expect(strike.verified).toEqual([]);
    expect((await finish(challengeId)).status).toBe(201);
  });

  it("explains a refused signature and spends the challenge, as Strike does", async () => {
    const { strike, started, finish } = await builderMember();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { challengeId } = await started();
    expect(await finish(challengeId, "4".repeat(88))).toMatchObject({
      status: 422,
      body: { code: "WALLET_SIGNATURE_REFUSED" },
    });
    expect(await finish(challengeId)).toMatchObject({
      status: 404,
      body: { code: "CHALLENGE_NOT_FOUND" },
    });
    expect(strike.registered).toEqual([]);
    expect(await db.select().from(accountConnections)).toEqual([]);
  });

  it("refuses an expired challenge without sending it to Strike", async () => {
    let now = testNow;
    const { strike, started, finish } = await builderMember({ now: () => now });
    const { challengeId, expiresAt } = await started();
    now = expiresAt;
    expect(await finish(challengeId)).toMatchObject({
      status: 410,
      body: { code: "CHALLENGE_EXPIRED" },
    });
    expect(strike.verified).toEqual([]);
    expect(await db.select().from(builderChallenges)).toEqual([]);
  });

  it("never lets one member finish another member's challenge", async () => {
    const { app, strike, started, finish } = await builderMember();
    const { challengeId } = await started();
    const other = await signIn(app, curator);
    expect(await finish(challengeId, memberSignature, other)).toMatchObject({
      status: 404,
      body: { code: "CHALLENGE_NOT_FOUND" },
    });
    expect(strike.verified).toEqual([]);
  });

  it("reports an inactive builder code as unavailable, not as the member's fault", async () => {
    const { strike, start } = await builderMember();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    strike.startReply = { status: 400, body: { error: "builder is not active" } };
    expect(await start()).toMatchObject({
      status: 503,
      body: { code: "BUILDER_CONNECT_UNAVAILABLE" },
    });
    expect(await db.select().from(builderChallenges)).toEqual([]);
  });

  it("reconciles a lost answer by reading the account with the new key", async () => {
    const { strike, started, finish } = await builderMember();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    strike.verifyReply = "hang";
    strike.registerDespiteReply = true;
    const { challengeId } = await started();
    expect(await finish(challengeId)).toMatchObject({
      status: 201,
      body: { strikeAccountId: "strike-sub-42", credentialSource: "builder" },
    });
  });

  it("stores nothing when the answer was lost and Strike refuses the new key", async () => {
    const { live, strike, started, finish } = await builderMember();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    strike.verifyReply = { status: 500, body: { error: "failed to create API wallet" } };
    live.refusal = new StrikeReadError({ operation: "account", status: 401, detail: "refused" });
    const { challengeId } = await started();
    expect(await finish(challengeId)).toMatchObject({
      status: 502,
      body: { code: "BUILDER_CONNECT_UNCONFIRMED" },
    });
    expect(await db.select().from(accountConnections)).toEqual([]);
  });

  it("stores nothing when Strike names a different account than the key reads", async () => {
    const { strike, started, finish } = await builderMember();
    strike.accountId = "strike-main-other";
    const { challengeId } = await started();
    expect(await finish(challengeId)).toMatchObject({
      status: 502,
      body: { code: "ACCOUNT_MISMATCH" },
    });
    expect(await db.select().from(accountConnections)).toEqual([]);
  });

  it("refuses a Strike account another member already connected", async () => {
    const first = await builderMember();
    expect((await first.finish((await first.started()).challengeId)).status).toBe(201);
    const other = await signIn(first.app, curator);
    const started = (await first.start(solanaWallet, other)).body as Started;
    expect(await first.finish(started.challengeId, memberSignature, other)).toMatchObject({
      status: 409,
      body: { code: "ACCOUNT_ALREADY_CONNECTED" },
    });
  });

  it("never puts the private key in a response, an event or a log", async () => {
    const { started, finish } = await builderMember();
    const logged = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const first = await started();
    const failed = await finish(first.challengeId, "4".repeat(88));
    expect(failed.status).toBe(422);
    const second = await started();
    const done = await finish(second.challengeId);
    const [row] = await db.select().from(accountConnections);
    const privateKeyHex = openCredential(
      {
        ciphertext: row?.keyCiphertext ?? "",
        iv: row?.keyIv ?? "",
        tag: row?.keyTag ?? "",
        keyVersion: row?.keyVersion ?? 0,
      },
      testKeyEncryptionKey,
      { userId: row?.userId ?? "", strikeAccountId: "strike-sub-42", environment: "live" },
    );
    const exposed = [
      JSON.stringify([first, failed.body, second, done.body]),
      JSON.stringify(await db.select().from(events)),
      logged.mock.calls.map(([text]) => String(text)).join(""),
    ].join("\n");
    expect(privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(exposed).not.toContain(privateKeyHex);
  });
});
