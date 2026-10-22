import { call, signIn, testApp, type TestApp } from "./app";
import type { RecordingTelegram } from "./recording-telegram";

export const groupChatId = "-1001234567890";
export const curator = { id: 1001, first_name: "Kemi", username: "kemi_ranges" };
export const member = { id: 2002, first_name: "Tobi" };

export const planFields = (overrides: Record<string, string> = {}) => ({
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
  ...overrides,
});

export async function curatorWithCommunity(app: TestApp, telegram: RecordingTelegram) {
  telegram.makeAdministrator(groupChatId, curator.id);
  const cookie = await signIn(app, curator);
  const reply = await call(app, "POST", "/api/communities", {
    cookie,
    body: { name: "Range Traders", telegramChatId: groupChatId },
  });
  if (reply.status !== 201) {
    throw new Error(`Registering the community failed with ${String(reply.status)}`);
  }
  const { community } = reply.body as { community: { id: string } };
  return { cookie, communityId: community.id };
}

export type Draft = { id: string; publicId: string };

export async function createDraft(
  app: TestApp,
  cookie: string,
  communityId: string,
  fields: Record<string, unknown> = planFields(),
): Promise<Draft> {
  const reply = await call(app, "POST", "/api/plans", { cookie, body: { communityId, fields } });
  if (reply.status !== 201) {
    throw new Error(`Creating the draft failed with ${String(reply.status)}`);
  }
  return (reply.body as { plan: Draft }).plan;
}

export async function planWithDraft(fields: Record<string, unknown> = planFields()) {
  const { app, telegram } = testApp();
  const { cookie, communityId } = await curatorWithCommunity(app, telegram);
  const draft = await createDraft(app, cookie, communityId, fields);
  return { app, telegram, cookie, communityId, draft };
}

export const publish = (app: TestApp, cookie: string, id: string, body?: unknown) =>
  call(app, "POST", `/api/plans/${id}/publish`, {
    cookie,
    ...(body === undefined ? {} : { body }),
  });
