import { eq } from "drizzle-orm";
import { users } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { issueSession } from "../src/auth/session";
import { call, sessionCookie, signIn, testApp, testEnv } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import {
  otherBotToken,
  signLoginWidget,
  signWebAppInitData,
  webAppFields,
  withTamperedHash,
} from "./support/telegram";

resetDatabaseBetweenTests();

const ada = { id: 424242, first_name: "Ada", last_name: "Obi", username: "ada_trades" };
const signedAt = Math.floor(testNow / 1000) - 30;

describe("signing in with Telegram", () => {
  it("signs in from the Mini App, upserts the user and sets a strict session cookie", async () => {
    const { app } = testApp();
    const initData = signWebAppInitData(webAppFields(ada, signedAt));
    const reply = await call(app, "POST", "/api/auth/telegram/webapp", { body: { initData } });
    expect(reply.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.telegramUserId, 424242));
    expect(row).toMatchObject({ displayName: "Ada Obi", telegramUsername: "ada_trades" });
    expect(reply.body).toEqual({ user: { id: row?.id, displayName: "Ada Obi" } });
    const setCookie = reply.headers.getSetCookie().join("; ");
    expect(setCookie).toMatch(/cadence_session=[^;]+/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=604800");
  });

  it("keeps one user per Telegram account and refreshes the name on each sign-in", async () => {
    const { app } = testApp();
    await signIn(app, ada);
    await signIn(app, { ...ada, first_name: "Adaeze" });
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe("Adaeze Obi");
  });

  it("signs in from the Login Widget", async () => {
    const { app } = testApp();
    const body = signLoginWidget({ id: "424242", first_name: "Ada", auth_date: String(signedAt) });
    const reply = await call(app, "POST", "/api/auth/telegram/widget", {
      body: { ...body, id: 424242, auth_date: signedAt },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ user: { displayName: "Ada" } });
  });

  it.each([
    ["a tampered hash", withTamperedHash(signWebAppInitData(webAppFields(ada, signedAt)))],
    ["an old auth_date", signWebAppInitData(webAppFields(ada, signedAt - 86_400))],
    ["another bot's token", signWebAppInitData(webAppFields(ada, signedAt), otherBotToken)],
  ])("refuses init data with %s and creates no user", async (_, initData) => {
    const { app } = testApp();
    const reply = await call(app, "POST", "/api/auth/telegram/webapp", { body: { initData } });
    expect(reply.status).toBe(401);
    expect(reply.body).toMatchObject({ code: "TELEGRAM_SIGNATURE_REFUSED" });
    expect(reply.headers.getSetCookie()).toEqual([]);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe("sessions on requests", () => {
  it("reads the signed-in user from the cookie", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, ada);
    const reply = await call(app, "GET", "/api/me", { cookie });
    expect(reply).toMatchObject({ status: 200, body: { user: { displayName: "Ada Obi" } } });
  });

  it("answers 401 with a plain message when signed out", async () => {
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/me");
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ code: "UNAUTHENTICATED", message: expect.any(String) as string });
  });

  it("refuses a forged session and one signed with another secret", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, ada);
    const forged = `${cookie.slice(0, -2)}xx`;
    const [row] = await db.select().from(users);
    const foreign = issueSession(
      { userId: row?.id ?? "", epoch: row?.sessionEpoch ?? 0 },
      "another-secret-that-is-long-enough-1234",
      testNow,
    );
    expect((await call(app, "GET", "/api/me", { cookie: forged })).status).toBe(401);
    expect(
      (await call(app, "GET", "/api/me", { cookie: `cadence_session=${foreign}` })).status,
    ).toBe(401);
  });

  it("ends every copy of the session at sign-out, and a new sign-in works", async () => {
    const { app } = testApp();
    const kept = await signIn(app, ada);
    await call(app, "POST", "/api/auth/logout", { cookie: kept });
    expect((await call(app, "GET", "/api/me", { cookie: kept })).status).toBe(401);
    const fresh = await signIn(app, ada);
    expect((await call(app, "GET", "/api/me", { cookie: fresh })).status).toBe(200);
  });

  it("signs out without a session too", async () => {
    const { app } = testApp();
    expect((await call(app, "POST", "/api/auth/logout")).status).toBe(204);
  });

  it("signs out by clearing the cookie", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, ada);
    const reply = await call(app, "POST", "/api/auth/logout", { cookie });
    expect(reply.status).toBe(204);
    expect(sessionCookie(reply.headers)).toBe("cadence_session=");
    expect(reply.headers.getSetCookie().join("; ")).toContain("Max-Age=0");
  });
});

describe("cross-site protection", () => {
  const initData = () => signWebAppInitData(webAppFields(ada, signedAt));

  it("refuses a mutation without the Cadence request header", async () => {
    const { app } = testApp();
    const reply = await call(app, "POST", "/api/auth/telegram/webapp", {
      body: { initData: initData() },
      marked: false,
    });
    expect(reply).toMatchObject({ status: 403, body: { code: "CROSS_SITE_REQUEST" } });
  });

  it.each([
    ["another origin", "https://evil.example"],
    ["no origin", null],
  ])("refuses a mutation from %s", async (_, origin) => {
    const { app } = testApp();
    const cookie = await signIn(app, ada);
    const reply = await call(app, "POST", "/api/auth/logout", { cookie, origin });
    expect(reply).toMatchObject({ status: 403, body: { code: "CROSS_SITE_REQUEST" } });
  });

  it("serves reads without the header", async () => {
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/health", { origin: null, marked: false });
    expect(reply).toEqual({ status: 200, body: { status: "ok" }, headers: reply.headers });
    expect(testEnv.PUBLIC_WEB_ORIGIN).toBe("https://cadence.test");
  });
});
