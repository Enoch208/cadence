import { randomUUID } from "node:crypto";
import {
  clientOrderIdFor,
  planVersionDigest,
  strategyIdFor,
  type IntentState,
  type OrderRole,
  type PublishedPlan,
} from "@cadence/core";
import {
  accountConnections,
  communities,
  communityPublishers,
  executionIntents,
  exchangeOrders,
  planVersions,
  plans,
  previews,
  receipts,
  reservations,
  riskPolicies,
  users,
} from "@cadence/db";
import { db } from "./database";
import {
  longPlan,
  readyDecision,
  readyProposal,
  receiptBody,
  testNow,
  testPolicy,
} from "./fixtures";

function only<Row>(rows: Row[], what: string): Row {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Inserting ${what} returned no row`);
  }
  return row;
}

export async function insertUser(telegramUserId: number) {
  const rows = await db
    .insert(users)
    .values({ telegramUserId, displayName: `Trader ${String(telegramUserId)}`, createdAt: testNow })
    .returning();
  return only(rows, "a user");
}

export async function insertCommunity(ownerUserId: string, telegramChatId: bigint) {
  const community = only(
    await db
      .insert(communities)
      .values({ ownerUserId, name: "Range Traders", telegramChatId, createdAt: testNow })
      .returning(),
    "a community",
  );
  await db.insert(communityPublishers).values({ communityId: community.id, userId: ownerUserId });
  return community;
}

export async function insertPublishedPlan(authorUserId: string, communityId: string) {
  const rows = await db
    .insert(plans)
    .values({
      publicId: randomUUID().slice(0, 12),
      communityId,
      authorUserId,
      status: "published",
      currentVersion: 1,
      draft: longPlan,
      createdAt: testNow,
    })
    .returning();
  return only(rows, "a plan");
}

export async function insertPlanVersion(planId: string, version: number, plan: PublishedPlan) {
  const rows = await db
    .insert(planVersions)
    .values({
      planId,
      version,
      payload: plan,
      digest: planVersionDigest(plan),
      publishedAt: testNow,
      entryExpiresAt: Date.parse(plan.entryExpiresAt),
    })
    .returning();
  return only(rows, "a plan version");
}

export async function insertLiveConnection(userId: string, strikeAccountId: string) {
  const rows = await db
    .insert(accountConnections)
    .values({
      userId,
      environment: "live",
      strikeAccountId,
      publicKey: "a".repeat(64),
      keyCiphertext: "c2VhbGVk",
      keyIv: "AAAAAAAAAAAAAAAA",
      keyTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
      createdAt: testNow,
    })
    .returning();
  return only(rows, "a live connection");
}

export type Member = Awaited<ReturnType<typeof insertMember>>;

export async function insertMember(telegramUserId: number) {
  const user = await insertUser(telegramUserId);
  const connection = await insertLiveConnection(user.id, `strike-${String(telegramUserId)}`);
  const policy = only(
    await db
      .insert(riskPolicies)
      .values({ userId: user.id, version: 1, policy: testPolicy, createdAt: testNow })
      .returning(),
    "a policy",
  );
  return { user, connection, policy };
}

export async function insertIntent(
  member: Member,
  planVersionId: string,
  state: IntentState = "reserved",
  market = "BTC-USD",
) {
  const preview = only(
    await db
      .insert(previews)
      .values({
        userId: member.user.id,
        accountConnectionId: member.connection.id,
        planVersionId,
        policyId: member.policy.id,
        decision: readyDecision,
        inputDigest: "d".repeat(64),
        createdAt: testNow,
        expiresAt: testNow + 15_000,
      })
      .returning(),
    "a preview",
  );
  const id = randomUUID();
  const rows = await db
    .insert(executionIntents)
    .values({
      id,
      userId: member.user.id,
      accountConnectionId: member.connection.id,
      planVersionId,
      previewId: preview.id,
      policyId: member.policy.id,
      market,
      approved: readyProposal,
      approvedDigest: "e".repeat(64),
      state,
      strategyId: strategyIdFor(id),
      createdAt: testNow,
      updatedAt: testNow,
    })
    .returning();
  return only(rows, "an intent");
}

export async function insertOrder(intentId: string, role: OrderRole, clientOrderId?: string) {
  const rows = await db
    .insert(exchangeOrders)
    .values({
      intentId,
      role,
      clientOrderId: clientOrderId ?? clientOrderIdFor(intentId, role),
      payload: { role },
      payloadDigest: "f".repeat(64),
    })
    .returning();
  return only(rows, "an exchange order");
}

export async function insertReservation(
  intent: { id: string; accountConnectionId: string },
  plannedLoss: string,
  releasedAt: number | null = null,
) {
  await db.insert(reservations).values({
    intentId: intent.id,
    accountConnectionId: intent.accountConnectionId,
    plannedLoss,
    initialMargin: "203.59",
    status: releasedAt === null ? "active" : "released",
    releasedAt,
  });
}

export async function insertReceipt(intentId: string, realizedPnl: string | null, builtAt: number) {
  await db.insert(receipts).values({ intentId, body: receiptBody(intentId, realizedPnl), builtAt });
}
