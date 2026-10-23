import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createGrammyPublisher } from "../src/telegram/publisher";
import { testBotToken } from "./support/telegram";

type Sent = { method: string; body: Record<string, unknown> };

function telegramServer(reply: (method: string) => { status: number; body: unknown }) {
  const sent: Sent[] = [];
  const fetch = (url: string, init: { body?: string }) => {
    const method = url.split("/").at(-1) ?? "";
    sent.push({ method, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    const { status, body } = reply(method);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { api: new Api(testBotToken, { fetch }), sent };
}

const message = { message_id: 77, date: 0, chat: { id: -1001234567890, type: "supergroup" } };

describe("the grammY Telegram publisher", () => {
  it("sends the card as plain text with a bold first line and one URL button", async () => {
    const server = telegramServer(() => ({ status: 200, body: { ok: true, result: message } }));
    const result = await createGrammyPublisher(server.api).postPlanCard({
      chatId: "-1001234567890",
      text: "BTC-USD long\nEntry",
      boldLength: 12,
      button: { label: "Preview for me", url: "https://cadence.test/p/abc" },
    });
    expect(result).toEqual({ messageId: 77 });
    expect(server.sent).toHaveLength(1);
    const [sent] = server.sent;
    expect(sent?.method).toBe("sendMessage");
    expect(sent?.body).toMatchObject({
      chat_id: "-1001234567890",
      text: "BTC-USD long\nEntry",
      entities: [{ type: "bold", offset: 0, length: 12 }],
      reply_markup: {
        inline_keyboard: [[{ text: "Preview for me", url: "https://cadence.test/p/abc" }]],
      },
    });
    expect(sent?.body).not.toHaveProperty("parse_mode");
  });

  it("recognises the group's creator and administrators only", async () => {
    const statuses = ["creator", "administrator", "member"];
    const server = telegramServer(() => ({
      status: 200,
      body: { ok: true, result: { status: statuses.shift(), user: { id: 1, is_bot: false } } },
    }));
    const publisher = createGrammyPublisher(server.api);
    expect(await publisher.isChatAdministrator("-1001234567890", 1)).toBe(true);
    expect(await publisher.isChatAdministrator("-1001234567890", 1)).toBe(true);
    expect(await publisher.isChatAdministrator("-1001234567890", 1)).toBe(false);
    expect(server.sent[0]).toMatchObject({
      method: "getChatMember",
      body: { chat_id: "-1001234567890", user_id: 1 },
    });
  });

  it("answers no when the bot is not in the group", async () => {
    const server = telegramServer(() => ({
      status: 400,
      body: { ok: false, error_code: 400, description: "Bad Request: chat not found" },
    }));
    expect(await createGrammyPublisher(server.api).isChatAdministrator("-1001234567890", 1)).toBe(
      false,
    );
  });
});
