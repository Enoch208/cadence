import { eq } from "drizzle-orm";
import { publishedPlanSchema } from "@cadence/core";
import { executionIntents } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { longPlan, readyProposal, testNow } from "./support/fixtures";
import { curatorWithCommunity, member, planFields, publish } from "./support/flows";
import {
  insertCommunity,
  insertIntent,
  insertMember,
  insertPlanVersion,
  insertPublishedPlan,
  insertReceipt,
  insertUser,
} from "./support/rows";

resetDatabaseBetweenTests();

const shortPlan = publishedPlanSchema.parse({
  ...longPlan,
  direction: "short",
  stopPrice: "85200",
  targetPrice: "81600",
});

async function publishedVersions(count: number) {
  const author = await insertUser(9009);
  const community = await insertCommunity(author.id, -1005555555555n);
  const plan = await insertPublishedPlan(author.id, community.id);
  const versions = [];
  for (let version = 1; version <= count; version += 1) {
    versions.push(await insertPlanVersion(plan.id, version, version === 2 ? shortPlan : longPlan));
  }
  return { plan, versions };
}

async function stamp(intentId: string, createdAt: number) {
  await db
    .update(executionIntents)
    .set({ createdAt, updatedAt: createdAt + 5 })
    .where(eq(executionIntents.id, intentId));
}

describe("a member's orders", () => {
  it("lists only the member's own intents, newest first, with receipt readiness", async () => {
    const { plan, versions } = await publishedVersions(2);
    const [first, second] = versions;
    const mine = await insertMember(member.id);
    const theirs = await insertMember(3003);
    const closed = await insertIntent(mine, first?.id ?? "", "closed", "BTC-USD");
    const open = await insertIntent(mine, second?.id ?? "", "open_verified", "ETH-USD");
    await insertIntent(theirs, first?.id ?? "", "reserved", "BTC-USD");
    await stamp(closed.id, testNow - 60_000);
    await stamp(open.id, testNow);
    await insertReceipt(closed.id, "-3.5", testNow - 1_000);
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/intents", { cookie: await signIn(app, member) });
    const row = (
      id: string,
      state: string,
      market: string,
      direction: string,
      version: number,
    ) => ({
      id,
      state,
      environment: "live",
      market,
      direction,
      planPublicId: plan.publicId,
      planVersion: version,
      quantity: readyProposal.quantity,
      limitPrice: readyProposal.limitPrice,
      plannedLoss: readyProposal.plannedLoss,
    });
    expect(reply).toMatchObject({ status: 200 });
    expect(reply.body).toEqual({
      intents: [
        {
          ...row(open.id, "open_verified", "ETH-USD", "short", 2),
          createdAt: testNow,
          updatedAt: testNow + 5,
          receiptReady: false,
        },
        {
          ...row(closed.id, "closed", "BTC-USD", "long", 1),
          createdAt: testNow - 60_000,
          updatedAt: testNow - 59_995,
          receiptReady: true,
        },
      ],
    });
  });

  it("returns at most the 50 newest", async () => {
    const { versions } = await publishedVersions(51);
    const mine = await insertMember(member.id);
    const ids: string[] = [];
    for (const [index, version] of versions.entries()) {
      const intent = await insertIntent(mine, version.id, "closed", "BTC-USD");
      await stamp(intent.id, testNow + index);
      ids.push(intent.id);
    }
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/intents", { cookie: await signIn(app, member) });
    const listed = (reply.body as { intents: { id: string }[] }).intents.map(({ id }) => id);
    expect(listed).toEqual(ids.slice(1).reverse());
  });
});

describe("a curator's plans", () => {
  it("lists only the plans the caller authored, newest first, drafts from their fields", async () => {
    let clock = testNow;
    const { app, telegram } = testApp({ now: () => clock });
    const { cookie, communityId } = await curatorWithCommunity(app, telegram);
    const create = async (fields: Record<string, unknown>) => {
      clock += 1_000;
      const reply = await call(app, "POST", "/api/plans", {
        cookie,
        body: { communityId, fields },
      });
      return (reply.body as { plan: { id: string; publicId: string } }).plan;
    };
    const published = await create(planFields());
    await publish(app, cookie, published.id);
    const draft = await create({
      ...planFields({ direction: "short", stopPrice: "85200", targetPrice: "81600" }),
      environment: "replay",
      entryExpiresAt: "2026-10-23T20:00:00Z",
    });
    const outsider = await signIn(app, member);
    const reply = await call(app, "GET", "/api/plans", { cookie });
    expect(reply).toMatchObject({ status: 200 });
    expect(reply.body).toEqual({
      plans: [
        {
          id: draft.id,
          publicId: draft.publicId,
          status: "draft",
          environment: "replay",
          market: "BTC-USD",
          direction: "short",
          currentVersion: null,
          entryExpiresAt: "2026-10-23T20:00:00Z",
          communityName: "Range Traders",
        },
        {
          id: published.id,
          publicId: published.publicId,
          status: "published",
          environment: "live",
          market: "BTC-USD",
          direction: "long",
          currentVersion: 1,
          entryExpiresAt: "2026-10-23T18:00:00Z",
          communityName: "Range Traders",
        },
      ],
    });
    expect((await call(app, "GET", "/api/plans", { cookie: outsider })).body).toEqual({
      plans: [],
    });
  });

  it("still serves a published plan by its public ID beside the list", async () => {
    const { app, telegram } = testApp();
    const { cookie, communityId } = await curatorWithCommunity(app, telegram);
    const reply = await call(app, "POST", "/api/plans", {
      cookie,
      body: { communityId, fields: planFields() },
    });
    const { plan } = reply.body as { plan: { id: string; publicId: string } };
    await publish(app, cookie, plan.id);
    expect((await call(app, "GET", `/api/plans/${plan.publicId}`)).status).toBe(200);
  });
});

describe("signed out", () => {
  it.each(["/api/intents", "/api/plans"])("refuses %s", async (path) => {
    const { app } = testApp();
    expect(await call(app, "GET", path)).toMatchObject({
      status: 401,
      body: { code: "UNAUTHENTICATED" },
    });
  });
});
