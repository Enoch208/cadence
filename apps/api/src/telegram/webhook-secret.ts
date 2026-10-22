import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

const purpose = "cadence:telegram-webhook:v1";

export const webhookSecretFor = (botToken: string): string =>
  createHmac("sha256", botToken).update(purpose).digest("hex");

export function isWebhookSecret(given: string | undefined, botToken: string): boolean {
  if (given === undefined) {
    return false;
  }
  const expected = Buffer.from(webhookSecretFor(botToken));
  const received = Buffer.from(given);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
