import { eq } from "drizzle-orm";
import { planVersionDigest, publishedPlanSchema } from "@cadence/core";
import { events } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp, testEnv } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import {
  createDraft,
  curatorWithCommunity,
  groupChatId,
  member,
  planFields,
} from "./support/flows";

resetDatabaseBetweenTests();

async function publishedDraft() {
  const { app, telegram } = testApp();
  const { cookie, communityId } = await curatorWithCommunity(app, telegram);
  const draft = await createDraft(app, cookie, communityId);
  return { app, telegram, cookie, communityId, draft };
}

const publish = (
  app: ReturnType<typeof testApp>["app"],
  cookie: string,
  id: string,
  body?: unknown,
) =>
  call(app, "POST", `/api/plans/${id}/publish`, {
    cookie,
    ...(body === undefined ? {} : { body }),
  });

describe("plan drafts", () => {
  it("creates a draft for live trading whatever environment was sent", async () => {
    const { app, telegram } = testApp();
    const { cookie, communityId } = await curatorWithCommunity(app, telegram);
    const fields = { ...planFields(), environment: "replay" };
    const reply = await call(app, "POST", "/api/plans", { cookie, body: { communityId, fields } });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({
      plan: { status: "draft", currentVersion: 0, draft: { ...planFields(), environment: "live" } },
    });
  });

  it.each([
    ["an unknown market", { market: "PEPE-USD" }, "UNKNOWN_MARKET"],
    ["a market that is not trading", { market: "DOGE-USD" }, "MARKET_NOT_TRADING"],
    [
      "an entry window that already closed",
      { entryExpiresAt: "2026-10-22T11:59:59Z" },
      "ENTRY_WINDOW_CLOSED",
    ],
    ["a stop above a long entry", { stopPrice: "84100" }, "PLAN_INVALID"],
  ])("refuses %s", async (_, overrides, code) => {
    const { app, telegram } = testApp();
    const { cookie, communityId } = await curatorWithCommunity(app, telegram);
    const fields = planFields(overrides);
    const reply = await call(app, "POST", "/api/plans", { cookie, body: { communityId, fields } });
    expect(reply).toMatchObject({ status: 422, body: { code } });
  });

  it("lets only the community's publishers create and publish", async () => {
    const { app, communityId, draft } = await publishedDraft();
    const outsider = await signIn(app, member);
    const created = await call(app, "POST", "/api/plans", {
      cookie: outsider,
      body: { communityId, fields: planFields() },
    });
    expect(created).toMatchObject({ status: 403, body: { code: "NOT_A_PUBLISHER" } });
    expect(await publish(app, outsider, draft.id)).toMatchObject({
      status: 403,
      body: { code: "NOT_A_PUBLISHER" },
    });
  });
});

describe("publishing", () => {
  it("publishes version 1 with its digest and posts the card to the group", async () => {
    const { app, telegram, cookie, draft } = await publishedDraft();
    const reply = await publish(app, cookie, draft.id);
    const digest = planVersionDigest(
      publishedPlanSchema.parse({ ...planFields(), environment: "live" }),
    );
    expect(reply).toMatchObject({
      status: 201,
      body: { publicId: draft.publicId, version: 1, digest, card: { posted: true } },
    });
    expect(telegram.cards).toHaveLength(1);
    const [card] = telegram.cards;
    expect(card?.chatId).toBe(groupChatId);
    expect(card?.button).toEqual({
      label: "Preview for me",
      url: `${testEnv.PUBLIC_WEB_ORIGIN}/p/${draft.publicId}`,
    });
    for (const fragment of [
      "BTC-USD long",
      "84000 to 84400",
      "Stop 83200",
      "Target 86800",
      "2026-10-23 18:00 UTC",
    ]) {
      expect(card?.text).toContain(fragment);
    }
  });

  it("publishes a correction as version 2 and keeps version 1 readable", async () => {
    const { app, cookie, draft } = await publishedDraft();
    await publish(app, cookie, draft.id);
    const corrected = await publish(app, cookie, draft.id, {
      fields: planFields({ stopPrice: "83300" }),
    });
    expect(corrected).toMatchObject({ status: 201, body: { version: 2 } });
    const read = await call(app, "GET", `/api/plans/${draft.publicId}`);
    expect(read.body).toMatchObject({
      status: "published",
      current: { version: 2, plan: { stopPrice: "83300" } },
      versions: [{ version: 2 }, { version: 1 }],
    });
    const first = await call(app, "GET", `/api/plans/${draft.publicId}/versions/1`);
    expect(first).toMatchObject({
      status: 200,
      body: { version: 1, plan: { stopPrice: "83200" } },
    });
  });

  it("refuses to publish the same terms twice, so a double click supersedes nobody", async () => {
    const { app, telegram, cookie, draft } = await publishedDraft();
    await publish(app, cookie, draft.id);
    expect(await publish(app, cookie, draft.id)).toMatchObject({
      status: 409,
      body: { code: "PLAN_UNCHANGED" },
    });
    expect(telegram.cards).toHaveLength(1);
  });

  it("keeps the published version when Telegram refuses the card", async () => {
    const { app, telegram, cookie, draft } = await publishedDraft();
    telegram.failTheNextPost();
    const reply = await publish(app, cookie, draft.id);
    expect(reply).toMatchObject({ status: 201, body: { version: 1, card: { posted: false } } });
    expect((await call(app, "GET", `/api/plans/${draft.publicId}`)).status).toBe(200);
    const recorded = await db.select().from(events).where(eq(events.type, "plan_card_failed"));
    expect(recorded).toHaveLength(1);
  });

  it("refuses to publish once the entry window has closed", async () => {
    const { cookie, draft } = await publishedDraft();
    const afterExpiry = testApp({ now: () => Date.parse("2026-10-23T18:00:00Z") });
    expect(await publish(afterExpiry.app, cookie, draft.id)).toMatchObject({
      status: 422,
      body: { code: "ENTRY_WINDOW_CLOSED" },
    });
  });
});

describe("revoking and the public read", () => {
  it("reads a revoked plan as revoked and refuses to publish it again", async () => {
    const { app, cookie, draft } = await publishedDraft();
    await publish(app, cookie, draft.id);
    const revoked = await call(app, "POST", `/api/plans/${draft.id}/revoke`, { cookie });
    expect(revoked).toMatchObject({
      status: 200,
      body: { publicId: draft.publicId, status: "revoked" },
    });
    expect((await call(app, "GET", `/api/plans/${draft.publicId}`)).body).toMatchObject({
      status: "revoked",
      current: { version: 1 },
    });
    const again = await publish(app, cookie, draft.id, {
      fields: planFields({ stopPrice: "83300" }),
    });
    expect(again).toMatchObject({ status: 409, body: { code: "PLAN_REVOKED" } });
  });

  it("serves the public plan with no user data and hides drafts", async () => {
    const { app, cookie, draft } = await publishedDraft();
    expect((await call(app, "GET", `/api/plans/${draft.publicId}`)).status).toBe(404);
    await publish(app, cookie, draft.id);
    const read = await call(app, "GET", `/api/plans/${draft.publicId}`, { origin: null });
    expect(Object.keys(read.body as object).sort()).toEqual(
      ["communityName", "current", "publicId", "status", "versions"].sort(),
    );
    expect(read.body).toMatchObject({
      communityName: "Range Traders",
      current: { publishedAt: testNow },
    });
    const text = JSON.stringify(read.body);
    expect(text).not.toContain(draft.id);
    expect(text).not.toContain("1001");
    expect(text).not.toContain("kemi");
  });
});
