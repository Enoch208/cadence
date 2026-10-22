import { describe, expect, it } from "vitest";
import { EnvError, loadApiEnv } from "../src/env";

const sessionSecret = "s".repeat(40);
const encryptionKey = "ab".repeat(32);
const botToken = "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

const complete = {
  DATABASE_URL: "postgres://cadence:cadence@127.0.0.1:54340/cadence",
  PUBLIC_WEB_ORIGIN: "https://cadence.example",
  SESSION_SECRET: sessionSecret,
  KEY_ENCRYPTION_KEY: encryptionKey,
  KEY_ENCRYPTION_KEY_VERSION: "1",
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_BOT_USERNAME: "CadencePlansBot",
  CADENCE_LIVE_MAX_NOTIONAL: "25",
};

function failure(source: Record<string, string | undefined>): string {
  try {
    loadApiEnv(source);
  } catch (error) {
    if (error instanceof EnvError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("The environment parsed when it should not have");
}

describe("API environment", () => {
  it("parses a complete environment with the API port and Strike mainnet by default", () => {
    expect(loadApiEnv(complete)).toMatchObject({
      PORT: 8810,
      STRIKE_API_BASE: "https://api.strikefinance.org",
      KEY_ENCRYPTION_KEY_VERSION: 1,
      CADENCE_LIVE_MAX_NOTIONAL: "25",
    });
  });

  it("treats an empty value as unset", () => {
    expect(loadApiEnv({ ...complete, PORT: "", STRIKE_API_BASE: "" }).PORT).toBe(8810);
    expect(failure({ ...complete, CADENCE_LIVE_MAX_NOTIONAL: "" })).toContain(
      "Missing: CADENCE_LIVE_MAX_NOTIONAL",
    );
  });

  it("requires a live notional ceiling, with no default", () => {
    expect(failure({ ...complete, CADENCE_LIVE_MAX_NOTIONAL: undefined })).toBe(
      "The API environment is incomplete. Missing: CADENCE_LIVE_MAX_NOTIONAL.",
    );
    expect(failure({ ...complete, CADENCE_LIVE_MAX_NOTIONAL: "0" })).toContain(
      "Invalid: CADENCE_LIVE_MAX_NOTIONAL",
    );
  });

  it("names missing and invalid variables without printing any value", () => {
    const message = failure({
      ...complete,
      SESSION_SECRET: "short-secret-value",
      KEY_ENCRYPTION_KEY: "zz-not-hex-zz",
      TELEGRAM_BOT_TOKEN: undefined,
    });
    expect(message).toBe(
      "The API environment is incomplete. Missing: TELEGRAM_BOT_TOKEN. Invalid: SESSION_SECRET, KEY_ENCRYPTION_KEY.",
    );
    expect(message).not.toContain("short-secret-value");
    expect(message).not.toContain("zz-not-hex-zz");
  });

  it("keeps only the origin of the web address and refuses one with a path", () => {
    expect(
      loadApiEnv({ ...complete, PUBLIC_WEB_ORIGIN: "https://cadence.example/" }).PUBLIC_WEB_ORIGIN,
    ).toBe("https://cadence.example");
    expect(failure({ ...complete, PUBLIC_WEB_ORIGIN: "https://cadence.example/app" })).toContain(
      "Invalid: PUBLIC_WEB_ORIGIN",
    );
  });

  it("leaves drafting off without an OpenAI key and refuses a malformed one", () => {
    expect(loadApiEnv({ ...complete, OPENAI_API_KEY: "" }).OPENAI_API_KEY).toBeUndefined();
    const key = `sk-proj-${"a".repeat(40)}`;
    expect(loadApiEnv({ ...complete, OPENAI_API_KEY: key }).OPENAI_API_KEY).toBe(key);
    const message = failure({ ...complete, OPENAI_API_KEY: "not-an-openai-key-at-all" });
    expect(message).toContain("Invalid: OPENAI_API_KEY");
    expect(message).not.toContain("not-an-openai-key-at-all");
  });

  it("leaves wallet connect off without a builder code and refuses one Strike cannot hold", () => {
    expect(loadApiEnv(complete).STRIKE_BUILDER_CODE).toBeUndefined();
    expect(
      loadApiEnv({ ...complete, STRIKE_BUILDER_CODE: "" }).STRIKE_BUILDER_CODE,
    ).toBeUndefined();
    expect(loadApiEnv({ ...complete, STRIKE_BUILDER_CODE: "cadence_1" }).STRIKE_BUILDER_CODE).toBe(
      "cadence_1",
    );
    expect(failure({ ...complete, STRIKE_BUILDER_CODE: "cadence code" })).toContain(
      "Invalid: STRIKE_BUILDER_CODE",
    );
    expect(failure({ ...complete, STRIKE_BUILDER_CODE: "c".repeat(65) })).toContain(
      "Invalid: STRIKE_BUILDER_CODE",
    );
  });

  it("refuses a Strike base that is not https", () => {
    expect(failure({ ...complete, STRIKE_API_BASE: "http://api.strikefinance.org" })).toContain(
      "Invalid: STRIKE_API_BASE",
    );
  });
});
