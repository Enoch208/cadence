import { eq } from "drizzle-orm";
import { planVersionDigest, publishedPlanSchema } from "@cadence/core";
import { events } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, testApp, testEnv } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { groupChatId, planFields, planWithDraft, publish } from "./support/flows";

resetDatabaseBetweenTests();

describe("publishing", () => {
  it("publishes version 1 with its digest and posts the card to the group", async () => {
    const { app, telegram, cookie, draft } = await planWithDraft();
    const reply = await publish(app, cookie, draft.id);
    const plan = publishedPlanSchema.parse({ ...planFields(), environment: "live" });
    expect(reply).toMatchObject({
      status: 201,
      body: { publicId: draft.publicId, version: 1, digest: planVersionDigest(plan) },
    });
    expect(reply.body).toMatchObject({ card: { posted: true } });
    const [card] = telegram.cards;
    expect(telegram.cards).toHaveLength(1);
    expect(card?.chatId).toBe(groupChatId);
    expect(card?.button).toEqual({
      label: "Preview for me",
      url: `${testEnv.PUBLIC_WEB_ORIGIN}/p/${draft.publicId}`,
    });
    for (const fragment of ["BTC-USD long", "84,000 – 84,400", "Stop 83,200", "Target 86,800"]) {
      expect(card?.text).toContain(fragment);
    }
    expect(card?.text).toContain("23 Oct, 18:00 UTC");
    expect(card?.text).not.toContain("Replay");
  });

  it("labels the card of a replay plan before anything else", async () => {
    const { app, telegram, cookie, draft } = await planWithDraft({
      ...planFields(),
      environment: "replay",
    });
    await publish(app, cookie, draft.id);
    expect(telegram.cards[0]?.text).toMatch(/^Replay: /);
  });

  it("publishes a correction as version 2 and keeps version 1 readable", async () => {
    const { app, cookie, draft } = await planWithDraft();
    await publish(app, cookie, draft.id);
    const corrected = await publish(app, cookie, draft.id, {
      fields: planFields({ stopPrice: "83300" }),
    });
    expect(corrected).toMatchObject({ status: 201, body: { version: 2 } });
    expect((await call(app, "GET", `/api/plans/${draft.publicId}`)).body).toMatchObject({
      status: "published",
      current: { version: 2, plan: { stopPrice: "83300" } },
      versions: [{ version: 2 }, { version: 1 }],
    });
    expect(await call(app, "GET", `/api/plans/${draft.publicId}/versions/1`)).toMatchObject({
      status: 200,
      body: { version: 1, plan: { stopPrice: "83200" } },
    });
  });

  it("keeps a plan in the environment it was created for", async () => {
    const { app, cookie, draft } = await planWithDraft({ ...planFields(), environment: "replay" });
    await publish(app, cookie, draft.id);
    const corrected = await publish(app, cookie, draft.id, {
      fields: planFields({ stopPrice: "83300" }),
    });
    expect(corrected).toMatchObject({ status: 201, body: { version: 2 } });
    const read = await call(app, "GET", `/api/plans/${draft.publicId}`);
    expect(read.body).toMatchObject({ current: { plan: { environment: "replay" } } });
    const switched = await publish(app, cookie, draft.id, {
      fields: { ...planFields({ stopPrice: "83400" }), environment: "live" },
    });
    expect(switched).toMatchObject({ status: 422, body: { code: "ENVIRONMENT_FIXED" } });
  });

  it("refuses to publish the same terms twice, so a double click supersedes nobody", async () => {
    const { app, telegram, cookie, draft } = await planWithDraft();
    await publish(app, cookie, draft.id);
    expect(await publish(app, cookie, draft.id)).toMatchObject({
      status: 409,
      body: { code: "PLAN_UNCHANGED" },
    });
    expect(telegram.cards).toHaveLength(1);
  });

  it("keeps the published version when Telegram refuses the card", async () => {
    const { app, telegram, cookie, draft } = await planWithDraft();
    telegram.failTheNextPost();
    const reply = await publish(app, cookie, draft.id);
    expect(reply).toMatchObject({ status: 201, body: { version: 1, card: { posted: false } } });
    expect((await call(app, "GET", `/api/plans/${draft.publicId}`)).status).toBe(200);
    const recorded = await db.select().from(events).where(eq(events.type, "plan_card_failed"));
    expect(recorded).toHaveLength(1);
  });

  it("refuses to publish once the entry window has closed", async () => {
    const { cookie, draft } = await planWithDraft();
    const afterExpiry = testApp({ now: () => Date.parse("2026-10-23T18:00:00Z") });
    expect(await publish(afterExpiry.app, cookie, draft.id)).toMatchObject({
      status: 422,
      body: { code: "ENTRY_WINDOW_CLOSED" },
    });
  });
});

describe("revoking and the public read", () => {
  it("reads a revoked plan as revoked and refuses to publish it again", async () => {
    const { app, cookie, draft } = await planWithDraft();
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
    const { app, cookie, draft } = await planWithDraft();
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
