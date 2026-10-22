import { describe, expect, it } from "vitest";
import { issueSession, readSession, sessionLifetimeMs } from "../src/auth/session";

const secret = "a-session-secret-that-is-long-enough-1234";
const userId = "5f0c8a52-0f39-4c2e-9d67-3a1f3b2a8e11";
const now = 1_792_670_400_000;
const session = { userId, epoch: 3 };

describe("sessions", () => {
  it("reads back the user and epoch it was issued for", () => {
    expect(readSession(issueSession(session, secret, now), secret, now + 1)).toEqual(session);
  });

  it("expires after seven days", () => {
    const token = issueSession(session, secret, now);
    expect(sessionLifetimeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(readSession(token, secret, now + sessionLifetimeMs - 1)).toEqual(session);
    expect(readSession(token, secret, now + sessionLifetimeMs)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = issueSession(session, "another-secret-that-is-long-enough-5678", now);
    expect(readSession(token, secret, now)).toBeNull();
  });

  it("refuses a token whose user, epoch or expiry was changed", () => {
    const [, epoch = "", expiresAt = "", signature = ""] = issueSession(session, secret, now).split(
      ".",
    );
    const otherUser = "0b7e7c8e-1d4f-4f5e-8a2b-6c9d0e1f2a3b";
    const later = String(Number(expiresAt) + 86_400_000);
    for (const forged of [
      `${otherUser}.${epoch}.${expiresAt}.${signature}`,
      `${userId}.4.${expiresAt}.${signature}`,
      `${userId}.${epoch}.${later}.${signature}`,
    ]) {
      expect(readSession(forged, secret, now)).toBeNull();
    }
  });

  it.each(["", "garbage", "a.b.c.d", `${userId}.1.1.`, `${userId}..1.sig`, "x".repeat(4096)])(
    "refuses the malformed token %#",
    (token) => {
      expect(readSession(token, secret, now)).toBeNull();
    },
  );

  it("refuses to issue a session for something that is not a user ID or epoch", () => {
    expect(() => issueSession({ userId: "user.1", epoch: 0 }, secret, now)).toThrow();
    expect(() => issueSession({ userId, epoch: -1 }, secret, now)).toThrow();
  });
});
