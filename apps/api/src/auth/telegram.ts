import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type TelegramIdentity = {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

const maximumAgeSeconds = 86_400;
const hexDigest = /^[0-9a-f]{64}$/;

const telegramUserId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionalName = z
  .string()
  .max(256)
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? null : value));

const identitySchema = z
  .object({
    id: telegramUserId,
    first_name: z.string().min(1).max(256),
    last_name: optionalName,
    username: optionalName,
  })
  .transform((user): TelegramIdentity => ({
    telegramUserId: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
  }));

function dataCheckString(fields: ReadonlyMap<string, string>): string {
  return [...fields.keys()]
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => `${key}=${fields.get(key) ?? ""}`)
    .join("\n");
}

function signedBy(fields: ReadonlyMap<string, string>, secret: Buffer): boolean {
  const given = fields.get("hash");
  if (given === undefined || !hexDigest.test(given)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(dataCheckString(fields)).digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

function isFresh(authDate: string | undefined, nowSeconds: number): boolean {
  if (authDate === undefined || !/^\d{1,12}$/.test(authDate)) {
    return false;
  }
  return nowSeconds - Number(authDate) <= maximumAgeSeconds;
}

function parseJsonObject(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function verifyWebAppInitData(
  initData: string,
  botToken: string,
  nowSeconds: number,
): TelegramIdentity | null {
  const params = new URLSearchParams(initData);
  const fields = new Map(params.entries());
  if (fields.size !== [...params.keys()].length) {
    return null;
  }
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (!signedBy(fields, secret) || !isFresh(fields.get("auth_date"), nowSeconds)) {
    return null;
  }
  const identity = identitySchema.safeParse(parseJsonObject(fields.get("user")));
  return identity.success ? identity.data : null;
}

export function verifyLoginWidget(
  fields: Record<string, string>,
  botToken: string,
  nowSeconds: number,
): TelegramIdentity | null {
  const entries = new Map(Object.entries(fields));
  const secret = createHash("sha256").update(botToken).digest();
  if (!signedBy(entries, secret) || !isFresh(entries.get("auth_date"), nowSeconds)) {
    return null;
  }
  const identity = identitySchema.safeParse(fields);
  return identity.success ? identity.data : null;
}
