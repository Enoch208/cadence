import { Api } from "grammy";
import { apiEnvSchema } from "../src/env";
import { telegramWebhookPath } from "../src/routes/telegram";
import { webhookSecretFor } from "../src/telegram/webhook-secret";

const line = (text: string) => process.stdout.write(`${text}\n`);

const fail = (text: string): never => {
  process.stderr.write(`${text}\n`);
  process.exit(1);
};

const webhookEnvSchema = apiEnvSchema.pick({ TELEGRAM_BOT_TOKEN: true, PUBLIC_WEB_ORIGIN: true });

async function main() {
  const parsed = webhookEnvSchema.safeParse({
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN,
  });
  if (!parsed.success) {
    return fail("Set TELEGRAM_BOT_TOKEN and PUBLIC_WEB_ORIGIN, as the API has them, first.");
  }
  const { TELEGRAM_BOT_TOKEN: token, PUBLIC_WEB_ORIGIN: origin } = parsed.data;
  if (!origin.startsWith("https://")) {
    return fail(`Telegram delivers webhooks over HTTPS only, and PUBLIC_WEB_ORIGIN is ${origin}.`);
  }
  const url = `${origin}${telegramWebhookPath}`;
  const api = new Api(token);
  await api.setWebhook(url, {
    secret_token: webhookSecretFor(token),
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: true,
  });
  const info = await api.getWebhookInfo();
  if (info.url !== url) {
    return fail(`Telegram did not keep the webhook: it reports "${info.url ?? ""}".`);
  }
  line(`Telegram delivers ${(info.allowed_updates ?? []).join(" and ")} updates to ${url}.`);
  line(`Pending updates: ${String(info.pending_update_count)}.`);
  if (info.last_error_message !== undefined) {
    line(`Last delivery error reported by Telegram: ${info.last_error_message}`);
  }
}

void main();
