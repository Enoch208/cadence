import { eq } from "drizzle-orm";
import { users } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { webhookSecretFor } from "../src/telegram/webhook-secret";
import { call, signIn, testApp, type TestApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { otherBotToken, testBotToken } from "./support/telegram";

resetDatabaseBetweenTests();

const member = { id: 424242, is_bot: false, first_name: "Tobi", username: "tobi_trades" };
const privateChat = { id: member.id, type: "private", first_name: "Tobi" };

const textUpdate = (text: string, chat: object = privateChat, from: object = member) => ({
  update_id: 9001,
  message: { message_id: 1, date: 1_792_670_400, chat, from, text },
});

const memberStatusUpdate = (status: string) => ({
  update_id: 9002,
  my_chat_member: {
    chat: privateChat,
    from: member,
    date: 1_792_670_400,
    old_chat_member: { status: "member", user: { id: 1, is_bot: true, first_name: "Cadence" } },
    new_chat_member: { status, user: { id: 1, is_bot: true, first_name: "Cadence" } },
  },
});

async function deliver(
  app: TestApp,
  body: unknown,
  secret: string | null = webhookSecretFor(testBotToken),
  path = "/api/telegram/webhook",
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-telegram-bot-api-secret-token", secret);
  const response = await app.request(path, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length === 0 ? null : (JSON.parse(text) as unknown),
  };
}

async function botStartedAt(telegramUserId: number) {
  const [row] = await db
    .select({ botStartedAt: users.botStartedAt })
    .from(users)
    .where(eq(users.telegramUserId, telegramUserId));
  return row === undefined ? "no user" : row.botStartedAt;
}

const appButton = { text: "Open Cadence", web_app: { url: "https://cadence.test/app" } };

describe("the Telegram webhook secret", () => {
  it("is derived from the bot token, never equal to it, and changes with it", () => {
    const secret = webhookSecretFor(testBotToken);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toContain(testBotToken);
    expect(webhookSecretFor(testBotToken)).toBe(secret);
    expect(webhookSecretFor(otherBotToken)).not.toBe(secret);
  });
});

describe("POST /api/telegram/webhook", () => {
  it("refuses an update without the secret header or with another bot's secret", async () => {
    const { app } = testApp();
    for (const secret of [null, "", webhookSecretFor(otherBotToken), testBotToken]) {
      const reply = await deliver(app, textUpdate("/start"), secret);
      expect(reply.status).toBe(401);
      expect(reply.body).toMatchObject({ code: "WEBHOOK_SECRET_REFUSED" });
    }
    expect(await botStartedAt(member.id)).toBe("no user");
  });

  it("records /start in a private chat and answers with one line and an app button", async () => {
    const { app } = testApp();
    const reply = await deliver(app, textUpdate("/start"));
    expect(reply).toEqual({
      status: 200,
      body: {
        method: "sendMessage",
        chat_id: member.id,
        text: "Cadence will message you here when one of your orders changes state.",
        reply_markup: { inline_keyboard: [[appButton]] },
        link_preview_options: { is_disabled: true },
      },
    });
    expect(await botStartedAt(member.id)).toBe(testNow);
    const [user] = await db.select().from(users).where(eq(users.telegramUserId, member.id));
    expect(user).toMatchObject({ displayName: "Tobi", telegramUsername: "tobi_trades" });
  });

  it("accepts /start with a deep-link payload and keeps the first start time", async () => {
    let now = testNow;
    const { app } = testApp({ now: () => now });
    await deliver(app, textUpdate("/start"));
    now += 60_000;
    expect((await deliver(app, textUpdate("/start plan_abc"))).status).toBe(200);
    expect(await botStartedAt(member.id)).toBe(testNow);
  });

  it("keeps the start when the member later signs in to the app", async () => {
    const { app } = testApp();
    await deliver(app, textUpdate("/start"));
    await signIn(app, { id: member.id, first_name: "Tobi" });
    expect(await botStartedAt(member.id)).toBe(testNow);
  });

  it("points any other private message at the app without recording a start", async () => {
    const { app } = testApp();
    const reply = await deliver(app, textUpdate("what is my position?"));
    expect(reply.body).toMatchObject({
      method: "sendMessage",
      chat_id: member.id,
      text: "Cadence works in the app. Open it to see your plans and orders.",
      reply_markup: { inline_keyboard: [[appButton]] },
    });
    expect(await botStartedAt(member.id)).toBe("no user");
  });

  it("ignores group messages, bots and updates it cannot read", async () => {
    const { app } = testApp();
    const group = { id: -1001234567890, type: "supergroup", title: "Range Traders" };
    const bot = { id: 777, is_bot: true, first_name: "Other" };
    for (const update of [
      textUpdate("/start", group),
      textUpdate("/start", privateChat, bot),
      { update_id: 9003, edited_message: textUpdate("/start").message },
      { not: "an update" },
      "not json",
    ]) {
      expect(await deliver(app, update)).toEqual({ status: 204, body: null });
    }
    expect(await botStartedAt(member.id)).toBe("no user");
    expect(await botStartedAt(bot.id)).toBe("no user");
  });

  it("forgets the start when the member blocks the bot, and records it again on /start", async () => {
    const { app } = testApp();
    await deliver(app, textUpdate("/start"));
    expect(await deliver(app, memberStatusUpdate("kicked"))).toEqual({ status: 204, body: null });
    expect(await botStartedAt(member.id)).toBeNull();
    await deliver(app, memberStatusUpdate("member"));
    expect(await botStartedAt(member.id)).toBeNull();
    await deliver(app, textUpdate("/start"));
    expect(await botStartedAt(member.id)).toBe(testNow);
  });

  it("is the only route exempt from the same-origin rule", async () => {
    const { app } = testApp();
    const crossSite = { origin: "https://evil.test", marked: false };
    expect((await call(app, "POST", "/api/auth/logout", crossSite)).status).toBe(403);
    expect((await call(app, "POST", "/api/telegram/webhook/", crossSite)).status).toBe(403);
    expect((await deliver(app, textUpdate("/start"), null, "/api/telegram/webhooks")).status).toBe(
      403,
    );
  });
});
