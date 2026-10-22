import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../deps";
import { HttpError } from "../http/errors";
import { recordBotStart, recordBotStop } from "../telegram/bot-starts";
import { groupReply, groupWelcome, replyCopy, webhookReply } from "../telegram/replies";
import { readTurn, type BotTurn } from "../telegram/updates";
import { isWebhookSecret } from "../telegram/webhook-secret";

export const telegramWebhookPath = "/api/telegram/webhook";

const refused = () =>
  new HttpError(401, "WEBHOOK_SECRET_REFUSED", "This address only accepts updates from Telegram.");

async function answer(deps: AppDeps, turn: BotTurn) {
  const appUrl = `${deps.env.PUBLIC_WEB_ORIGIN}/app`;
  switch (turn.kind) {
    case "start":
      await recordBotStart(deps.db, turn.identity, deps.now());
      return webhookReply(turn.chatId, replyCopy.started, appUrl);
    case "message":
      return webhookReply(turn.chatId, replyCopy.pointer, appUrl);
    case "joinedGroup":
      return groupReply(turn.chatId, groupWelcome(turn.chatId, turn.admin));
    case "stopped":
      await recordBotStop(deps.db, turn.telegramUserId);
      return null;
    case "ignored":
      return null;
  }
}

export function telegramRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().post("/telegram/webhook", async (c) => {
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    if (!isWebhookSecret(secret, deps.env.TELEGRAM_BOT_TOKEN)) {
      throw refused();
    }
    const reply = await answer(deps, readTurn(await c.req.text()));
    return reply === null ? c.body(null, 204) : c.json(reply);
  });
}
