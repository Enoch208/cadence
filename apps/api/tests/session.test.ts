import { describe, expect, it } from "vitest";
import { issueSession, readSession, sessionLifetimeMs } from "../src/auth/session";

const secret = "a-session-secret-that-is-long-enough-1234";
const userId = "5f0c8a52-0f39-4c2e-9d67-3a1f3b2a8e11";
const now = 1_792_670_400_000;

describe("sessions", () => {
  it("reads back the user it was issued for", () => {
    expect(readSession(issueSession(userId, secret, now), secret, now + 1)).toBe(userId);
  });

  it("expires after seven days", () => {
    const token = issueSession(userId, secret, now);
    expect(sessionLifetimeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(readSession(token, secret, now + sessionLifetimeMs - 1)).toBe(userId);
    expect(readSession(token, secret, now + sessionLifetimeMs)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = issueSession(userId, "another-secret-that-is-long-enough-5678", now);
    expect(readSession(token, secret, now)).toBeNull();
  });

  it("refuses a token whose user or expiry was changed", () => {
    const [, expiresAt, signature] = issueSession(userId, secret, now).split(".");
    const otherUser = "0b7e7c8e-1d4f-4f5e-8a2b-6c9d0e1f2a3b";
    const later = String(Number(expiresAt) + 86_400_000);
    expect(
      readSession(`${otherUser}.${expiresAt ?? ""}.${signature ?? ""}`, secret, now),
    ).toBeNull();
    expect(readSession(`${userId}.${later}.${signature ?? ""}`, secret, now)).toBeNull();
  });

  it.each(["", "garbage", "a.b.c", `${userId}.1.`, `${userId}..sig`, "x".repeat(4096)])(
    "refuses the malformed token %#",
    (token) => {
      expect(readSession(token, secret, now)).toBeNull();
    },
  );

  it("refuses to issue a session for something that is not a user ID", () => {
    expect(() => issueSession("user.1", secret, now)).toThrow();
  });
});
