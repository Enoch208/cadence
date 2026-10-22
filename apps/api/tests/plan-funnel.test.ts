import { eq } from "drizzle-orm";
import type { Decision } from "@cadence/core";
import { fills, planVersions, previews } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, testApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { readyDecision, testNow } from "./support/fixtures";
import { curatorWithCommunity, planFields, publish } from "./support/flows";
import { insertIntent, insertMember, insertOrder, type Member } from "./support/rows";

resetDatabaseBetweenTests();

const declined: Decision = {
  outcome: "BLOCKED",
  reasons: ["OUTSIDE_ENTRY_RANGE"],
  evidence: readyDecision.evidence,
};

async function preview(member: Member, planVersionId: string, decision: Decision) {
  await db.insert(previews).values({
    userId: member.user.id,
    accountConnectionId: member.connection.id,
    planVersionId,
    policyId: member.policy.id,
    decision,
    inputDigest: "d".repeat(64),
    createdAt: testNow,
    expiresAt: testNow + 15_000,
  });
}

async function fillEntry(intentId: string) {
  const order = await insertOrder(intentId, "entry");
  await db.insert(fills).values({
    exchangeFillId: `fill-${intentId}`,
    clientOrderId: order.clientOrderId,
    intentId,
    role: "entry",
    side: "buy",
    price: "84100",
    size: "0.00025",
    fee: "0.01",
    filledAt: testNow,
  });
}

async function curatorPlans() {
  let clock = testNow;
  const { app, telegram } = testApp({ now: () => clock });
  const { cookie, communityId } = await curatorWithCommunity(app, telegram);
  const publishedPlan = async () => {
    clock += 1_000;
    const reply = await call(app, "POST", "/api/plans", {
      cookie,
      body: { communityId, fields: planFields() },
    });
    const { plan } = reply.body as { plan: { id: string } };
    await publish(app, cookie, plan.id);
    return plan.id;
  };
  const busy = await publishedPlan();
  const quiet = await publishedPlan();
  const funnels = async () => {
    const reply = await call(app, "GET", "/api/plans", { cookie });
    const { plans } = reply.body as { plans: { id: string; funnel: unknown }[] };
    return Object.fromEntries(plans.map((plan) => [plan.id, plan.funnel]));
  };
  return { busy, quiet, funnels };
}

async function versionOf(planId: string) {
  const [row] = await db
    .select({ id: planVersions.id })
    .from(planVersions)
    .where(eq(planVersions.planId, planId));
  if (row === undefined) {
    throw new Error("The plan has no published version");
  }
  return row.id;
}

describe("a curator's funnel for each plan", () => {
  it("counts distinct members who previewed, could take it, approved and filled", async () => {
    const { busy, quiet, funnels } = await curatorPlans();
    const versionId = await versionOf(busy);
    const [filled, approvedOnly, declinedOnly] = await Promise.all([
      insertMember(7001),
      insertMember(7002),
      insertMember(7003),
    ]);
    const filledIntent = await insertIntent(filled, versionId, "open_verified");
    await fillEntry(filledIntent.id);
    await preview(filled, versionId, readyDecision);
    await insertIntent(approvedOnly, versionId, "submitted");
    await preview(declinedOnly, versionId, declined);
    await preview(declinedOnly, versionId, declined);

    expect(await funnels()).toEqual({
      [busy]: { previewed: 3, couldTake: 2, approved: 2, filled: 1 },
      [quiet]: { previewed: 0, couldTake: 0, approved: 0, filled: 0 },
    });
  });

  it("counts a fill only from a recorded entry fill, not from the order's state", async () => {
    const { busy, funnels } = await curatorPlans();
    const member = await insertMember(7004);
    const intent = await insertIntent(member, await versionOf(busy), "open_verifying");
    await insertOrder(intent.id, "stop");
    expect((await funnels())[busy]).toEqual({ previewed: 1, couldTake: 1, approved: 1, filled: 0 });
    await fillEntry(intent.id);
    expect((await funnels())[busy]).toEqual({ previewed: 1, couldTake: 1, approved: 1, filled: 1 });
  });
});
