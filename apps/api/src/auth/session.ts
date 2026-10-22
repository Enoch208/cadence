import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "cadence_session";
export const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

const userIdShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const expiryShape = /^\d{13,15}$/;

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(`cadence.session.v1:${body}`).digest("base64url");

export function issueSession(userId: string, secret: string, nowMs: number): string {
  if (!userIdShape.test(userId)) {
    throw new TypeError("A session can only be issued for a user ID");
  }
  const body = `${userId}.${String(nowMs + sessionLifetimeMs)}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token: string, secret: string, nowMs: number): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [userId = "", expiresAt = "", signature = ""] = parts;
  if (!userIdShape.test(userId) || !expiryShape.test(expiresAt)) {
    return null;
  }
  const expected = Buffer.from(sign(`${userId}.${expiresAt}`, secret));
  const given = Buffer.from(signature);
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) {
    return null;
  }
  return nowMs < Number(expiresAt) ? userId : null;
}
