import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "cadence_session";
export const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type Session = { userId: string; epoch: number };

const userIdShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const epochShape = /^(?:0|[1-9]\d{0,8})$/;
const expiryShape = /^\d{13,15}$/;

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(`cadence.session.v2:${body}`).digest("base64url");

export function issueSession(session: Session, secret: string, nowMs: number): string {
  if (!userIdShape.test(session.userId) || !epochShape.test(String(session.epoch))) {
    throw new TypeError("A session can only be issued for a user ID and a session epoch");
  }
  const body = `${session.userId}.${String(session.epoch)}.${String(nowMs + sessionLifetimeMs)}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token: string, secret: string, nowMs: number): Session | null {
  const parts = token.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [userId = "", epoch = "", expiresAt = "", signature = ""] = parts;
  if (!userIdShape.test(userId) || !epochShape.test(epoch) || !expiryShape.test(expiresAt)) {
    return null;
  }
  const expected = Buffer.from(sign(`${userId}.${epoch}.${expiresAt}`, secret));
  const given = Buffer.from(signature);
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) {
    return null;
  }
  return nowMs < Number(expiresAt) ? { userId, epoch: Number(epoch) } : null;
}
