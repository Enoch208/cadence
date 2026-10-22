import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import type { OutgoingMessage } from "../src/notify-message";
import { createTelegramSender } from "../src/notify-telegram";

const botToken = "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

type Sent = { method: string; body: Record<string, unknown> };

function telegramServer(reply: () => { status: number; body: unknown } | Error) {
  const sent: Sent[] = [];
  const fetch = (url: string, init: { body?: string }) => {
    sent.push({
      method: url.split("/").at(-1) ?? "",
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });
    const answer = reply();
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
  return { sender: createTelegramSender(new Api(botToken, { fetch })), sent };
}

const message = (url = "https://cadence.test/intents/abc"): OutgoingMessage => ({
  chatId: 5001,
  text: "Exits verified",
  button: { label: "Open order", url },
});

const telegramError = (status: number, description: string, parameters?: object) => ({
  status,
  body: { ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) },
});

describe("the Telegram sender", () => {
  it("sends plain text with one button that opens the app inside Telegram", async () => {
    const server = telegramServer(() => ({
      status: 200,
      body: { ok: true, result: { message_id: 81, date: 0, chat: { id: 5001, type: "private" } } },
    }));
    await expect(server.sender.send(message())).resolves.toEqual({ kind: "sent", messageId: 81 });
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]).toMatchObject({
      method: "sendMessage",
      body: {
        chat_id: 5001,
        text: "Exits verified",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open order", web_app: { url: "https://cadence.test/intents/abc" } }],
          ],
        },
        link_preview_options: { is_disabled: true },
      },
    });
    expect(server.sent[0]?.body).not.toHaveProperty("parse_mode");
  });

  it("uses a plain link for an app that is not served over HTTPS", async () => {
    const server = telegramServer(() => ({
      status: 200,
      body: { ok: true, result: { message_id: 82, date: 0, chat: { id: 5001, type: "private" } } },
    }));
    await server.sender.send(message("http://127.0.0.1:5190/intents/abc"));
    expect(server.sent[0]?.body).toMatchObject({
      reply_markup: {
        inline_keyboard: [[{ text: "Open order", url: "http://127.0.0.1:5190/intents/abc" }]],
      },
    });
  });

  it("waits as long as Telegram asks when it rate-limits", async () => {
    const server = telegramServer(() =>
      telegramError(429, "Too Many Requests: retry after 3", { retry_after: 3 }),
    );
    await expect(server.sender.send(message())).resolves.toEqual({
      kind: "retry",
      afterMs: 3_000,
      reason: "Telegram 429: Too Many Requests: retry after 3",
    });
  });

  it("retries when Telegram itself fails", async () => {
    const server = telegramServer(() => telegramError(502, "Bad Gateway"));
    await expect(server.sender.send(message())).resolves.toEqual({
      kind: "retry",
      afterMs: null,
      reason: "Telegram 502: Bad Gateway",
    });
  });

  it("gives up on a member who blocked the bot and on a chat Telegram cannot find", async () => {
    const blocked = telegramServer(() =>
      telegramError(403, "Forbidden: bot was blocked by the user"),
    );
    await expect(blocked.sender.send(message())).resolves.toEqual({
      kind: "refused",
      reason: "Telegram 403: Forbidden: bot was blocked by the user",
      botStopped: true,
    });
    const missing = telegramServer(() => telegramError(400, "Bad Request: chat not found"));
    await expect(missing.sender.send(message())).resolves.toMatchObject({
      kind: "refused",
      botStopped: false,
    });
  });

  it("calls a network failure unconfirmed and never prints the bot token", async () => {
    const server = telegramServer(() => new Error(`connect ECONNRESET for ${botToken}`));
    const delivery = await server.sender.send(message());
    expect(delivery).toEqual({
      kind: "unconfirmed",
      reason: "Network request for 'sendMessage' failed!",
    });
    expect(JSON.stringify(delivery)).not.toContain(botToken);
  });
});
