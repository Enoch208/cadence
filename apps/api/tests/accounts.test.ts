import { eq } from "drizzle-orm";
import { accountConnections, events, openCredential } from "@cadence/db";
import { StrikeRejectedError } from "@cadence/strike";
import { afterEach, describe, expect, it, vi } from "vitest";
import { call, signIn, testApp, testKeyEncryptionKey } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { curator, member } from "./support/flows";
import { throwawayKeyPair } from "./support/keys";

resetDatabaseBetweenTests();
afterEach(() => {
  vi.restoreAllMocks();
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function signedInMember() {
  const context = testApp();
  return { ...context, cookie: await signIn(context.app, member) };
}

describe("connecting a live Strike sub-account", () => {
  it("proves the key pair, resolves the account, sets isolated margin and stores only ciphertext", async () => {
    const { app, live, cookie } = await signedInMember();
    const keys = throwawayKeyPair();
    const body = { publicKey: keys.publicKeyHex, privateKey: keys.seedHex };
    const reply = await call(app, "POST", "/api/accounts", { cookie, body });
    expect(reply).toMatchObject({
      status: 201,
      body: { environment: "live", strikeAccountId: "strike-sub-42", status: "active" },
    });
    expect(live.signedBy).toEqual([keys.publicKeyHex]);
    expect(live.configured).toEqual([
      { symbol: "BTC-USD", settings: { marginMode: "isolated", leverage: 5 } },
      { symbol: "ETH-USD", settings: { marginMode: "isolated", leverage: 5 } },
    ]);
    const [row] = await db.select().from(accountConnections);
    expect(JSON.stringify(row)).not.toContain(keys.seedHex);
    expect(row?.keyCiphertext).toBeTruthy();
    expect(row?.credentialSource).toBe("api_key");
    const sealed = {
      ciphertext: row?.keyCiphertext ?? "",
      iv: row?.keyIv ?? "",
      tag: row?.keyTag ?? "",
      keyVersion: row?.keyVersion ?? 0,
    };
    const binding = {
      userId: row?.userId ?? "",
      strikeAccountId: "strike-sub-42",
      environment: "live" as const,
    };
    expect(openCredential(sealed, testKeyEncryptionKey, binding)).toBe(keys.seedHex);
  });

  it("never echoes the key in a response, an event or a log, whatever fails", async () => {
    const { app, live, cookie } = await signedInMember();
    const keys = throwawayKeyPair();
    const stranger = throwawayKeyPair();
    const logged = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mismatched = await call(app, "POST", "/api/accounts", {
      cookie,
      body: { publicKey: stranger.publicKeyHex, privateKey: keys.seedHex },
    });
    expect(mismatched).toMatchObject({ status: 422, body: { code: "KEY_PAIR_MISMATCH" } });
    live.refusal = new StrikeRejectedError({
      operation: "account",
      status: 401,
      code: null,
      message: "invalid api key",
    });
    const refused = await call(app, "POST", "/api/accounts", {
      cookie,
      body: { publicKey: keys.publicKeyHex, privateKey: keys.seedHex },
    });
    expect(refused).toMatchObject({ status: 422, body: { code: "KEY_NOT_ACCEPTED" } });
    const malformed = await call(app, "POST", "/api/accounts", {
      cookie,
      body: { publicKey: keys.publicKeyHex, privateKey: `${keys.seedHex}zz` },
    });
    expect(malformed.status).toBe(400);
    const exposed = [
      JSON.stringify([mismatched.body, refused.body, malformed.body]),
      JSON.stringify(await db.select().from(events)),
      logged.mock.calls.map(([text]) => String(text)).join(""),
    ].join("\n");
    expect(exposed).not.toContain(keys.seedHex);
    expect(await db.select().from(accountConnections)).toHaveLength(0);
  });

  it("refuses a Strike account that another member already connected", async () => {
    const { app, cookie } = await signedInMember();
    const body = () => {
      const keys = throwawayKeyPair();
      return { publicKey: keys.publicKeyHex, privateKey: keys.seedHex };
    };
    expect((await call(app, "POST", "/api/accounts", { cookie, body: body() })).status).toBe(201);
    const other = await signIn(app, curator);
    expect(await call(app, "POST", "/api/accounts", { cookie: other, body: body() })).toMatchObject(
      {
        status: 409,
        body: { code: "ACCOUNT_ALREADY_CONNECTED" },
      },
    );
  });
});

describe("replay accounts and pausing", () => {
  it("connects a replay account under a minted ID with no key", async () => {
    const { app, cookie } = await signedInMember();
    const reply = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "late_entry" },
    });
    expect(reply).toMatchObject({ status: 201, body: { environment: "replay", status: "active" } });
    const { strikeAccountId } = reply.body as { strikeAccountId: string };
    expect(strikeAccountId).toMatch(/^replay-/);
    expect(strikeAccountId.slice("replay-".length)).toMatch(uuid);
    const [row] = await db.select().from(accountConnections);
    expect(row).toMatchObject({
      replayScenario: "late_entry",
      publicKey: null,
      keyCiphertext: null,
    });
    const unknown = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "moon_shot" },
    });
    expect(unknown.status).toBe(400);
  });

  it("pauses and resumes an account, as GET /api/accounts shows", async () => {
    const { app, cookie } = await signedInMember();
    const created = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "happy_path" },
    });
    const { id } = created.body as { id: string };
    expect(await call(app, "POST", `/api/accounts/${id}/pause`, { cookie })).toMatchObject({
      status: 200,
      body: { id, status: "paused" },
    });
    expect((await call(app, "GET", "/api/accounts", { cookie })).body).toEqual({
      accounts: [
        {
          id,
          environment: "replay",
          strikeAccountId: (created.body as { strikeAccountId: string }).strikeAccountId,
          status: "paused",
        },
      ],
    });
    expect(await call(app, "POST", `/api/accounts/${id}/resume`, { cookie })).toMatchObject({
      body: { status: "active" },
    });
  });

  it("treats another member's account as missing", async () => {
    const { app, cookie } = await signedInMember();
    const created = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "happy_path" },
    });
    const { id } = created.body as { id: string };
    const other = await signIn(app, curator);
    for (const action of ["pause", "resume"]) {
      const reply = await call(app, "POST", `/api/accounts/${id}/${action}`, { cookie: other });
      expect(reply).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    }
    expect((await call(app, "GET", "/api/accounts", { cookie: other })).body).toEqual({
      accounts: [],
    });
    const [row] = await db.select().from(accountConnections).where(eq(accountConnections.id, id));
    expect(row?.status).toBe("active");
  });
});
