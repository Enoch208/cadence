import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { strategyIdFor, type Decision, type IntentState } from "@cadence/core";
import { executionIntents, previews, riskPolicies } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp, type TestApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { readyProposal, testNow } from "./support/fixtures";
import { curator, member, planFields, planWithDraft, publish } from "./support/flows";

resetDatabaseBetweenTests();

type PreviewReply = { previewId: string; expiresAt: number; decision: Decision };

async function replayPlan(environment: "live" | "replay" = "replay") {
  const context = await planWithDraft({ ...planFields(), environment });
  await publish(context.app, context.cookie, context.draft.id);
  return context;
}

async function replayAccount(app: TestApp, cookie: string, scenario: string) {
  const reply = await call(app, "POST", "/api/accounts/replay", { cookie, body: { scenario } });
  return (reply.body as { id: string }).id;
}

async function previewFor(scenario: string) {
  const { app, draft } = await replayPlan();
  const cookie = await signIn(app, member);
  const accountId = await replayAccount(app, cookie, scenario);
  const ask = () =>
    call(app, "POST", "/api/previews", {
      cookie,
      body: { planPublicId: draft.publicId, accountId },
    });
  return { app, cookie, accountId, draft, ask, reply: await ask() };
}

async function intentFromPreview(previewId: string, state: IntentState) {
  const [preview] = await db.select().from(previews).where(eq(previews.id, previewId));
  if (preview === undefined) throw new Error("The preview was not stored");
  const id = randomUUID();
  await db.insert(executionIntents).values({
    id,
    userId: preview.userId,
    accountConnectionId: preview.accountConnectionId,
    planVersionId: preview.planVersionId,
    previewId,
    policyId: preview.policyId,
    market: "BTC-USD",
    approved: readyProposal,
    approvedDigest: "e".repeat(64),
    state,
    strategyId: strategyIdFor(id),
    createdAt: testNow,
    updatedAt: testNow,
  });
}

const decisionOf = (reply: { body: unknown }) => (reply.body as PreviewReply).decision;

describe("previewing a plan against the member's own account", () => {
  it("is ready on the happy path, stored with its inputs' digest and valid for 15 seconds", async () => {
    const { reply } = await previewFor("happy_path");
    expect(reply.status).toBe(201);
    const body = reply.body as PreviewReply;
    expect(body.expiresAt).toBe(testNow + 15_000);
    expect(body.decision).toMatchObject({ outcome: "READY", proposal: { limitedBy: "budget" } });
    const [stored] = await db.select().from(previews).where(eq(previews.id, body.previewId));
    expect(stored?.decision).toEqual(body.decision);
    expect(stored?.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    const [policy] = await db.select().from(riskPolicies);
    expect(policy).toMatchObject({ id: stored?.policyId, version: 1 });
  });

  it.each([
    ["late_entry", "OUTSIDE_ENTRY_RANGE"],
    ["stale_data", "STALE_DATA"],
  ])("declines the %s scenario with %s", async (scenario, reason) => {
    const decision = decisionOf((await previewFor(scenario)).reply);
    expect(decision.outcome).toBe("BLOCKED");
    expect(decision.reasons).toContain(reason);
  });

  it("runs a live plan only on a live account", async () => {
    const { app, draft } = await replayPlan("live");
    const cookie = await signIn(app, member);
    const accountId = await replayAccount(app, cookie, "happy_path");
    const reply = await call(app, "POST", "/api/previews", {
      cookie,
      body: { planPublicId: draft.publicId, accountId },
    });
    expect(decisionOf(reply)).toMatchObject({
      outcome: "BLOCKED",
      reasons: ["UNSUPPORTED_CAPABILITY"],
    });
  });

  it("previews under the member's saved budgets", async () => {
    const { app, draft } = await replayPlan();
    const cookie = await signIn(app, member);
    await call(app, "PUT", "/api/policies", {
      cookie,
      body: {
        perTradeBudget: "10",
        aggregateBudget: "60",
        sessionBudget: "40",
        leverageCap: 5,
        minRewardRisk: "1.5",
      },
    });
    const accountId = await replayAccount(app, cookie, "happy_path");
    const reply = await call(app, "POST", "/api/previews", {
      cookie,
      body: { planPublicId: draft.publicId, accountId },
    });
    expect(decisionOf(reply)).toMatchObject({ proposal: { admissibleBudget: "10.00" } });
  });

  it("blocks while an earlier order is unresolved, and while the market is already in use", async () => {
    const unresolved = await previewFor("happy_path");
    await intentFromPreview((unresolved.reply.body as PreviewReply).previewId, "unknown");
    expect(decisionOf(await unresolved.ask())).toMatchObject({
      outcome: "BLOCKED",
      reasons: ["ACCOUNT_UNRECONCILED"],
    });
    await db.update(executionIntents).set({ state: "open_verified" });
    expect(decisionOf(await unresolved.ask())).toMatchObject({
      outcome: "BLOCKED",
      reasons: ["SYMBOL_BUSY"],
    });
  });

  it("refuses a paused account", async () => {
    const { app, cookie, accountId, ask } = await previewFor("happy_path");
    await call(app, "POST", `/api/accounts/${accountId}/pause`, { cookie });
    expect(await ask()).toMatchObject({ status: 409, body: { code: "ACCOUNT_PAUSED" } });
  });

  it("treats another member's account and an unknown plan as missing", async () => {
    const { app, accountId, draft } = await previewFor("happy_path");
    const other = await signIn(app, curator);
    const theirs = await call(app, "POST", "/api/previews", {
      cookie: other,
      body: { planPublicId: draft.publicId, accountId },
    });
    expect(theirs).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    const ownAccount = await replayAccount(app, other, "happy_path");
    const unknown = await call(app, "POST", "/api/previews", {
      cookie: other,
      body: { planPublicId: "zzzzzzzzzzzz", accountId: ownAccount },
    });
    expect(unknown).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });

  it("needs a signed-in member", async () => {
    const { app } = testApp();
    const reply = await call(app, "POST", "/api/previews", {
      body: { planPublicId: "zzzzzzzzzzzz", accountId: randomUUID() },
    });
    expect(reply.status).toBe(401);
  });
});
