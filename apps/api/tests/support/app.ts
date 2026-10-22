import { Buffer } from "node:buffer";
import type { MarketRules } from "@cadence/core";
import { clientForConnection } from "@cadence/db";
import { createApp } from "../../src/app";
import { loadApiEnv } from "../../src/env";
import { db } from "./database";
import { testNow } from "./fixtures";
import { RecordingTelegram } from "./recording-telegram";
import { btcUsd, dogeUsdPreTrading, ethUsd, stubLiveExchange, stubStrikeClient } from "./strike";
import { signWebAppInitData, testBotToken, webAppFields } from "./telegram";

export const testEnv = loadApiEnv({
  DATABASE_URL: "postgres://cadence:cadence@127.0.0.1:54340/cadence_test",
  PUBLIC_WEB_ORIGIN: "https://cadence.test",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
  KEY_ENCRYPTION_KEY: "0f".repeat(32),
  KEY_ENCRYPTION_KEY_VERSION: "1",
  TELEGRAM_BOT_TOKEN: testBotToken,
  TELEGRAM_BOT_USERNAME: "CadenceTestBot",
  CADENCE_LIVE_MAX_NOTIONAL: "25",
});

const refuseNetwork: typeof fetch = () =>
  Promise.reject(new Error("Tests never reach the network"));

export const testKeyEncryptionKey = Uint8Array.from(Buffer.from(testEnv.KEY_ENCRYPTION_KEY, "hex"));

export function testApp(options: { markets?: readonly MarketRules[]; now?: () => number } = {}) {
  const now = options.now ?? (() => testNow);
  const markets = options.markets ?? [btcUsd, ethUsd, dogeUsdPreTrading];
  const telegram = new RecordingTelegram();
  const publicStrike = stubStrikeClient(markets);
  const live = stubLiveExchange(markets, now);
  const replayDeps = {
    keyEncryptionKey: testKeyEncryptionKey,
    strikeApiBase: "https://strike.test",
    fetch: refuseNetwork,
    now,
  };
  const app = createApp({
    db,
    env: testEnv,
    strike: {
      public: () => publicStrike,
      forConnection: (connection) =>
        connection.environment === "replay"
          ? clientForConnection(connection, replayDeps)
          : live.client,
      forSigner: (signer) => {
        live.state.signedBy.push(signer.publicKeyHex);
        return live.client;
      },
    },
    telegram,
    now,
  });
  return { app, telegram, live: live.state };
}

export type TestApp = ReturnType<typeof testApp>["app"];

type CallOptions = {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  marked?: boolean;
};

export async function call(app: TestApp, method: string, path: string, options: CallOptions = {}) {
  const origin = options.origin === undefined ? testEnv.PUBLIC_WEB_ORIGIN : options.origin;
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  if (options.marked ?? true) headers.set("x-cadence-request", "1");
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  const response = await app.request(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const body: unknown = text.length === 0 ? null : JSON.parse(text);
  return { status: response.status, body, headers: response.headers };
}

export function sessionCookie(headers: Headers): string {
  const cookie = headers.getSetCookie().find((value) => value.startsWith("cadence_session="));
  if (cookie === undefined) {
    throw new Error("The response did not set a session cookie");
  }
  return cookie.split(";")[0] ?? "";
}

export async function signIn(
  app: TestApp,
  user: { id: number; first_name: string; last_name?: string; username?: string },
): Promise<string> {
  const initData = signWebAppInitData(webAppFields(user, Math.floor(testNow / 1000) - 30));
  const reply = await call(app, "POST", "/api/auth/telegram/webapp", { body: { initData } });
  if (reply.status !== 200) {
    throw new Error(`Signing in failed with ${String(reply.status)}`);
  }
  return sessionCookie(reply.headers);
}
