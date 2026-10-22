import { publishedPlanSchema, riskPolicySchema, type Decision } from "@cadence/core";
import { previews, riskPolicies } from "@cadence/db";
import { call, signIn, type TestApp } from "./app";
import { db } from "./database";
import { longPlan, readyDecision, testNow, testPolicy } from "./fixtures";
import { member, planFields, planWithDraft, publish } from "./flows";
import { insertCommunity, insertPlanVersion, insertPublishedPlan } from "./rows";

export type PreviewReply = { previewId: string; expiresAt: number; decision: Decision };

export async function replayAccount(app: TestApp, cookie: string, scenario = "happy_path") {
  const reply = await call(app, "POST", "/api/accounts/replay", { cookie, body: { scenario } });
  return (reply.body as { id: string }).id;
}

export async function previewedPlan(scenario = "happy_path") {
  const curatorSide = await planWithDraft({ ...planFields(), environment: "replay" });
  const { app, draft } = curatorSide;
  await publish(app, curatorSide.cookie, draft.id);
  const cookie = await signIn(app, member);
  const accountId = await replayAccount(app, cookie, scenario);
  const preview = async () => {
    const reply = await call(app, "POST", "/api/previews", {
      cookie,
      body: { planPublicId: draft.publicId, accountId },
    });
    return reply.body as PreviewReply;
  };
  const first = await preview();
  const approve = (previewId = first.previewId, as = cookie, on: TestApp = app) =>
    call(on, "POST", "/api/intents", { cookie: as, body: { previewId } });
  return {
    ...curatorSide,
    curatorCookie: curatorSide.cookie,
    cookie,
    accountId,
    preview,
    approve,
    ...first,
  };
}

export async function signedInUserId(app: TestApp, cookie: string): Promise<string> {
  const reply = await call(app, "GET", "/api/me", { cookie });
  return (reply.body as { user: { id: string } }).user.id;
}

export async function previewsOnTwoMarkets(
  app: TestApp,
  cookie: string,
  budgets: { aggregateBudget: string; sessionBudget: string },
) {
  const accountId = await replayAccount(app, cookie);
  const userId = await signedInUserId(app, cookie);
  const [policy] = await db
    .insert(riskPolicies)
    .values({
      userId,
      version: 1,
      policy: riskPolicySchema.parse({ ...testPolicy, ...budgets }),
      createdAt: testNow,
    })
    .returning();
  const community = await insertCommunity(userId, -1009876543210n);
  const previewIds: string[] = [];
  for (const market of ["BTC-USD", "ETH-USD"]) {
    const plan = await insertPublishedPlan(userId, community.id);
    const payload = publishedPlanSchema.parse({ ...longPlan, market, environment: "replay" });
    const version = await insertPlanVersion(plan.id, 1, payload);
    const [row] = await db
      .insert(previews)
      .values({
        userId,
        accountConnectionId: accountId,
        planVersionId: version.id,
        policyId: policy?.id ?? "",
        decision: readyDecision,
        inputDigest: "d".repeat(64),
        createdAt: testNow,
        expiresAt: testNow + 15_000,
      })
      .returning({ id: previews.id });
    previewIds.push(row?.id ?? "");
  }
  return { accountId, previewIds };
}
