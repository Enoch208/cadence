import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { createApp } from "@cadence/api/app";
import { positiveDecimalSchema, type Decision } from "@cadence/core";
import { clientForConnection } from "@cadence/db";
import { createReplayStrikeClient, replayScenarios } from "@cadence/strike";
import { db } from "./database";
import type { TestClock } from "./fixtures";

type AppDeps = Parameters<typeof createApp>[0];
type PlanCard = Parameters<AppDeps["telegram"]["postPlanCard"]>[0];
export type CadenceApi = ReturnType<typeof createApp>;

const botToken = "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const origin = "https://cadence.test";
const groupChatId = "-1001234567890";
const curator = { id: 1001, first_name: "Kemi" };

const env: AppDeps["env"] = {
  DATABASE_URL: "postgres://cadence:cadence@127.0.0.1:54340/cadence_test",
  PORT: 8810,
  PUBLIC_WEB_ORIGIN: origin,
  SESSION_SECRET: "worker-end-to-end-session-secret-long-enough",
  KEY_ENCRYPTION_KEY: "0f".repeat(32),
  KEY_ENCRYPTION_KEY_VERSION: 1,
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_BOT_USERNAME: "CadenceTestBot",
  STRIKE_API_BASE: "https://strike.test",
  CADENCE_LIVE_MAX_NOTIONAL: positiveDecimalSchema.parse("25"),
};

const refuseNetwork: typeof fetch = () =>
  Promise.reject(new Error("End-to-end tests never reach the network"));

export const exchangeDeps = (clock: TestClock) => ({
  keyEncryptionKey: Uint8Array.from(Buffer.from(env.KEY_ENCRYPTION_KEY, "hex")),
  strikeApiBase: env.STRIKE_API_BASE,
  fetch: refuseNetwork,
  now: clock.now,
});

export function cadenceApi(clock: TestClock): CadenceApi {
  const cards: PlanCard[] = [];
  return createApp({
    db,
    env,
    strike: {
      public: () => createReplayStrikeClient(replayScenarios.happy_path, clock.now),
      forConnection: (connection) => clientForConnection(connection, exchangeDeps(clock)),
      forSigner: () => {
        throw new Error("End-to-end tests connect replay accounts only");
      },
    },
    telegram: {
      isChatAdministrator: (chatId, telegramUserId) =>
        Promise.resolve(chatId === groupChatId && telegramUserId === curator.id),
      postPlanCard: (card) => {
        cards.push(card);
        return Promise.resolve({ messageId: cards.length });
      },
    },
    drafter: null,
    builderConnect: null,
    now: clock.now,
  });
}

export type Reply = { status: number; body: unknown; cookie: string | null };

export async function call(
  app: CadenceApi,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Reply> {
  const headers = new Headers({
    "content-type": "application/json",
    origin,
    "x-cadence-request": "1",
  });
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  const response = await app.request(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const session = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("cadence_session="));
  return {
    status: response.status,
    body: text.length === 0 ? null : JSON.parse(text),
    cookie: session?.split(";")[0] ?? null,
  };
}

function signedInitData(user: { id: number; first_name: string }, authDate: number): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify(user),
  };
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ""}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

export async function signIn(
  app: CadenceApi,
  clock: TestClock,
  user: { id: number; first_name: string },
): Promise<string> {
  const initData = signedInitData(user, Math.floor(clock.now() / 1000) - 30);
  const reply = await call(app, "POST", "/api/auth/telegram/webapp", { body: { initData } });
  if (reply.status !== 200 || reply.cookie === null) {
    throw new Error(`Signing in failed with ${String(reply.status)}`);
  }
  return reply.cookie;
}

function expect2xx(reply: Reply, what: string): Reply {
  if (reply.status < 200 || reply.status > 299) {
    throw new Error(`${what} failed with ${String(reply.status)}: ${JSON.stringify(reply.body)}`);
  }
  return reply;
}

export async function publishReplayPlan(app: CadenceApi, clock: TestClock): Promise<string> {
  const cookie = await signIn(app, clock, curator);
  const community = expect2xx(
    await call(app, "POST", "/api/communities", {
      cookie,
      body: { name: "Range Traders", telegramChatId: groupChatId },
    }),
    "Registering the community",
  ).body as { community: { id: string } };
  const fields = {
    schemaVersion: 1,
    market: "BTC-USD",
    direction: "long",
    entryMin: "84000",
    entryMax: "84400",
    stopPrice: "83200",
    targetPrice: "86800",
    triggerSource: "mark_price",
    entryExpiresAt: "2026-10-23T18:00:00Z",
    rationale: "Reclaim of the weekly open with a stop under the range low.",
    environment: "replay",
  };
  const draft = expect2xx(
    await call(app, "POST", "/api/plans", {
      cookie,
      body: { communityId: community.community.id, fields },
    }),
    "Drafting the plan",
  ).body as { plan: { id: string; publicId: string } };
  expect2xx(
    await call(app, "POST", `/api/plans/${draft.plan.id}/publish`, { cookie }),
    "Publishing the plan",
  );
  return draft.plan.publicId;
}

let nextMember = 3000;

export async function replayMember(app: CadenceApi, clock: TestClock, scenario: string) {
  nextMember += 1;
  const cookie = await signIn(app, clock, { id: nextMember, first_name: "Tobi" });
  const account = expect2xx(
    await call(app, "POST", "/api/accounts/replay", { cookie, body: { scenario } }),
    "Connecting the replay account",
  ).body as { id: string };
  return { cookie, accountId: account.id };
}

export type Preview = { previewId: string; expiresAt: number; decision: Decision };

export async function previewFor(
  app: CadenceApi,
  member: { cookie: string; accountId: string },
  planPublicId: string,
): Promise<Preview> {
  const reply = await call(app, "POST", "/api/previews", {
    cookie: member.cookie,
    body: { planPublicId, accountId: member.accountId },
  });
  return expect2xx(reply, "Previewing").body as Preview;
}
