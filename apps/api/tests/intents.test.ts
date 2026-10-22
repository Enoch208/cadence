import { canonicalJson, sha256Hex } from "@cadence/core";
import { events, executionIntents, outbox, reservations } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { curator, member, planFields, publish } from "./support/flows";
import { previewedPlan, previewsOnTwoMarkets } from "./support/member-flows";

resetDatabaseBetweenTests();

const counts = async () => ({
  intents: (await db.select().from(executionIntents)).length,
  reservations: (await db.select().from(reservations)).length,
  outbox: (await db.select().from(outbox)).length,
});

describe("approving a preview", () => {
  it("reserves before any order: one intent, one reservation, one submit item and an event", async () => {
    const { approve, decision, accountId, previewId } = await previewedPlan();
    const reply = await approve();
    expect(reply.status).toBe(201);
    const { id } = reply.body as { id: string };
    const [intent] = await db.select().from(executionIntents);
    if (decision.outcome === "BLOCKED") throw new Error("The happy path preview was blocked");
    expect(intent).toMatchObject({
      id,
      state: "reserved",
      market: "BTC-USD",
      previewId,
      accountConnectionId: accountId,
      approved: decision.proposal,
      strategyId: `cad-${id}`,
    });
    expect(intent?.approvedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(intent?.approvedDigest).not.toBe(sha256Hex(canonicalJson(decision.proposal)));
    expect(await db.select().from(reservations)).toMatchObject([
      { intentId: id, status: "active", plannedLoss: decision.proposal.plannedLoss },
    ]);
    expect(await db.select().from(outbox)).toMatchObject([
      { intentId: id, kind: "submit", status: "pending", nextAttemptAt: testNow },
    ]);
    expect(await db.select().from(events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ correlationId: id, type: "intent_reserved" }),
      ]),
    );
  });

  it("returns the same intent for a double click, even a simultaneous one", async () => {
    const { approve } = await previewedPlan();
    const [first, second] = await Promise.all([approve(), approve()]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body).toEqual(second.body);
    expect((await approve()).status).toBe(200);
    expect(await counts()).toEqual({ intents: 1, reservations: 1, outbox: 1 });
  });

  it("admits only what the aggregate budget allows when two plans race on one account", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    const { previewIds } = await previewsOnTwoMarkets(app, cookie, {
      aggregateBudget: "30",
      sessionBudget: "40",
    });
    const replies = await Promise.all(
      previewIds.map((previewId) =>
        call(app, "POST", "/api/intents", { cookie, body: { previewId } }),
      ),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
    expect(replies.find((reply) => reply.status === 409)?.body).toMatchObject({
      code: "RISK_BUDGET_EXHAUSTED",
    });
    expect(await counts()).toEqual({ intents: 1, reservations: 1, outbox: 1 });
  });

  it("counts the session budget too", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    const { previewIds } = await previewsOnTwoMarkets(app, cookie, {
      aggregateBudget: "60",
      sessionBudget: "30",
    });
    const [first = "", second = ""] = previewIds;
    expect(
      (await call(app, "POST", "/api/intents", { cookie, body: { previewId: first } })).status,
    ).toBe(201);
    expect(
      await call(app, "POST", "/api/intents", { cookie, body: { previewId: second } }),
    ).toMatchObject({
      status: 409,
      body: { code: "RISK_BUDGET_EXHAUSTED" },
    });
  });
});

describe("refusing an approval", () => {
  it("refuses a preview older than 15 seconds", async () => {
    const { approve, previewId, cookie } = await previewedPlan();
    const later = testApp({ now: () => testNow + 15_000 });
    expect(await approve(previewId, cookie, later.app)).toMatchObject({
      status: 409,
      body: { code: "PREVIEW_EXPIRED" },
    });
    expect(await counts()).toEqual({ intents: 0, reservations: 0, outbox: 0 });
  });

  it("refuses a preview the engine declined", async () => {
    const { approve } = await previewedPlan("late_entry");
    expect(await approve()).toMatchObject({ status: 409, body: { code: "PREVIEW_BLOCKED" } });
  });

  it("refuses a paused account", async () => {
    const { app, approve, cookie, accountId } = await previewedPlan();
    await call(app, "POST", `/api/accounts/${accountId}/pause`, { cookie });
    expect(await approve()).toMatchObject({ status: 409, body: { code: "ACCOUNT_PAUSED" } });
  });

  it("asks for a new preview once the curator has corrected the plan", async () => {
    const { app, approve, curatorCookie, draft } = await previewedPlan();
    await publish(app, curatorCookie, draft.id, {
      fields: { ...planFields({ stopPrice: "83300" }), environment: "replay" },
    });
    expect(await approve()).toMatchObject({ status: 409, body: { code: "PLAN_SUPERSEDED" } });
  });

  it("treats another member's preview as missing", async () => {
    const { app, approve, previewId } = await previewedPlan();
    const other = await signIn(app, curator);
    expect(await approve(previewId, other)).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    expect(await counts()).toEqual({ intents: 0, reservations: 0, outbox: 0 });
  });
});
