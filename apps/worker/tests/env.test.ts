import { describe, expect, it } from "vitest";
import { loadWorkerEnv, WorkerEnvError } from "../src/env";

const encryptionKey = "cd".repeat(32);

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

  it("refuses a Strike base that is not HTTPS", () => {
    expect(failure({ ...complete, STRIKE_API_BASE: "http://api.strikefinance.org" })).toBe(
      "The worker environment is incomplete. Invalid: STRIKE_API_BASE.",
    );
  });
});
