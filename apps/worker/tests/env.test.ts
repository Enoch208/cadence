import { describe, expect, it } from "vitest";
import { loadWorkerEnv, WorkerEnvError } from "../src/env";

const encryptionKey = "cd".repeat(32);
const botToken = "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

const complete = {
  DATABASE_URL: "postgres://cadence:cadence@127.0.0.1:54340/cadence",
  KEY_ENCRYPTION_KEY: encryptionKey,
  KEY_ENCRYPTION_KEY_VERSION: "1",
  CADENCE_LIVE_MAX_NOTIONAL: "25",
};

function failure(source: Record<string, string | undefined>): string {
  try {
    loadWorkerEnv(source);
  } catch (error) {
    if (error instanceof WorkerEnvError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("The environment parsed when it should not have");
}

describe("worker environment", () => {
  it("parses a complete environment against Strike mainnet by default", () => {
    expect(loadWorkerEnv(complete)).toMatchObject({
      STRIKE_API_BASE: "https://api.strikefinance.org",
      KEY_ENCRYPTION_KEY_VERSION: 1,
      CADENCE_LIVE_MAX_NOTIONAL: "25",
    });
  });

  it("refuses to start without a live notional ceiling", () => {
    expect(failure({ ...complete, CADENCE_LIVE_MAX_NOTIONAL: undefined })).toBe(
      "The worker environment is incomplete. Missing: CADENCE_LIVE_MAX_NOTIONAL.",
    );
  });

  it("names a malformed variable without printing its value", () => {
    const message = failure({ ...complete, KEY_ENCRYPTION_KEY: "not-a-key-but-a-secret" });
    expect(message).toBe("The worker environment is incomplete. Invalid: KEY_ENCRYPTION_KEY.");
    expect(message).not.toContain("not-a-key-but-a-secret");
  });

  it("leaves order messages off without a bot token", () => {
    const env = loadWorkerEnv(complete);
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.PUBLIC_WEB_ORIGIN).toBeUndefined();
  });

  it("needs the web origin once a bot token is set, and keeps only the origin", () => {
    expect(failure({ ...complete, TELEGRAM_BOT_TOKEN: botToken })).toBe(
      "The worker environment is incomplete. Missing: PUBLIC_WEB_ORIGIN.",
    );
    expect(
      loadWorkerEnv({
        ...complete,
        TELEGRAM_BOT_TOKEN: botToken,
        PUBLIC_WEB_ORIGIN: "https://cadence.test",
      }),
    ).toMatchObject({ TELEGRAM_BOT_TOKEN: botToken, PUBLIC_WEB_ORIGIN: "https://cadence.test" });
    expect(
      failure({
        ...complete,
        TELEGRAM_BOT_TOKEN: botToken,
        PUBLIC_WEB_ORIGIN: "https://cadence.test/app",
      }),
    ).toBe("The worker environment is incomplete. Invalid: PUBLIC_WEB_ORIGIN.");
  });

  it("names a malformed bot token without printing it", () => {
    const message = failure({
      ...complete,
      TELEGRAM_BOT_TOKEN: "not-a-token-but-a-secret",
      PUBLIC_WEB_ORIGIN: "https://cadence.test",
    });
    expect(message).toBe("The worker environment is incomplete. Invalid: TELEGRAM_BOT_TOKEN.");
    expect(message).not.toContain("not-a-token-but-a-secret");
  });

  it("refuses a Strike base that is not HTTPS", () => {
    expect(failure({ ...complete, STRIKE_API_BASE: "http://api.strikefinance.org" })).toBe(
      "The worker environment is incomplete. Invalid: STRIKE_API_BASE.",
    );
  });
});
