import { randomUUID } from "node:crypto";
import {
  canonicalJson,
  planVersionDigest,
  sha256Hex,
  strategyIdFor,
  type Decision,
  type PublishedPlan,
} from "@cadence/core";
import {
  accountConnections,
  communities,
  events,
  executionIntents,
  outbox,
  planVersions,
  plans,
  previews,
  reservations,
  riskPolicies,
  users,
  type AccountConnectionRow,
} from "@cadence/db";
import type { ReplayScenarioName } from "@cadence/strike";
import { db } from "./database";
import { testNow, testPolicy } from "./fixtures";

function only<Row>(rows: Row[], what: string): Row {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Inserting ${what} returned no row`);
  }
  return row;
}

let nextTelegramId = 5000;

async function insertUser() {
  nextTelegramId += 1;
  const rows = await db
    .insert(users)
    .values({ telegramUserId: nextTelegramId, displayName: "Trader", createdAt: testNow })
    .returning();
  return only(rows, "a user");
}

export async function insertPlan(plan: PublishedPlan) {
  const curator = await insertUser();
  const community = only(
    await db
      .insert(communities)
      .values({
        ownerUserId: curator.id,
        name: "Range Traders",
        telegramChatId: BigInt(-1_000_000_000 - nextTelegramId),
        createdAt: testNow,
      })
      .returning(),
    "a community",
  );
  const planRow = only(
    await db
      .insert(plans)
      .values({
        publicId: randomUUID().slice(0, 12),
        communityId: community.id,
        authorUserId: curator.id,
        status: "published",
        currentVersion: 1,
        draft: plan,
        createdAt: testNow,
      })
      .returning(),
    "a plan",
  );
  const version = await insertPlanVersion(planRow.id, 1, plan);
  return { planRow, version };
}

export async function insertPlanVersion(planId: string, version: number, plan: PublishedPlan) {
  return only(
    await db
      .insert(planVersions)
      .values({
        planId,
        version,
        payload: plan,
        digest: planVersionDigest(plan),
        publishedAt: testNow,
        entryExpiresAt: Date.parse(plan.entryExpiresAt),
      })
      .returning(),
    "a plan version",
  );
}

export type ConnectionSpec =
  { environment: "replay"; scenario: ReplayScenarioName } | { environment: "live" };

const connectionColumns = (spec: ConnectionSpec) =>
  spec.environment === "replay"
    ? { environment: "replay" as const, replayScenario: spec.scenario }
    : {
        environment: "live" as const,
        publicKey: "a".repeat(64),
        keyCiphertext: "c2VhbGVk",
        keyIv: "AAAAAAAAAAAAAAAA",
        keyTag: "AAAAAAAAAAAAAAAAAAAAAA==",
        keyVersion: 1,
      };

export type Member = Awaited<ReturnType<typeof insertMember>>;

export async function insertMember(spec: ConnectionSpec) {
  const user = await insertUser();
  const connection: AccountConnectionRow = only(
    await db
      .insert(accountConnections)
      .values({
        userId: user.id,
        strikeAccountId: `strike-${randomUUID()}`,
        createdAt: testNow,
        ...connectionColumns(spec),
      })
      .returning(),
    "a connection",
  );
  const policy = only(
    await db
      .insert(riskPolicies)
      .values({ userId: user.id, version: 1, policy: testPolicy, createdAt: testNow })
      .returning(),
    "a policy",
  );
  return { user, connection, policy };
}

export async function approve(member: Member, planVersionId: string, decision: Decision) {
  if (decision.outcome === "BLOCKED") {
    throw new Error(`The preview was blocked: ${decision.reasons.join(", ")}`);
  }
  const { proposal } = decision;
  return db.transaction(async (tx) => {
    const preview = only(
      await tx
        .insert(previews)
        .values({
          userId: member.user.id,
          accountConnectionId: member.connection.id,
          planVersionId,
          policyId: member.policy.id,
          decision,
          inputDigest: sha256Hex(canonicalJson(decision.evidence)),
          createdAt: testNow,
          expiresAt: testNow + 15_000,
        })
        .returning(),
      "a preview",
    );
    const id = randomUUID();
    const intent = only(
      await tx
        .insert(executionIntents)
        .values({
          id,
          userId: member.user.id,
          accountConnectionId: member.connection.id,
          planVersionId,
          previewId: preview.id,
          policyId: member.policy.id,
          market: "BTC-USD",
          approved: proposal,
          approvedDigest: sha256Hex(canonicalJson(proposal)),
          state: "reserved",
          strategyId: strategyIdFor(id),
          createdAt: testNow,
          updatedAt: testNow,
        })
        .returning(),
      "an intent",
    );
    await tx.insert(reservations).values({
      intentId: id,
      accountConnectionId: member.connection.id,
      plannedLoss: proposal.plannedLoss,
      initialMargin: proposal.initialMargin,
    });
    await tx.insert(outbox).values({
      kind: "submit",
      intentId: id,
      accountConnectionId: member.connection.id,
      nextAttemptAt: testNow,
    });
    await tx.insert(events).values({
      at: testNow,
      actor: `user:${member.user.id}`,
      correlationId: id,
      environment: member.connection.environment,
      type: "approved",
      data: { from: "prepared", to: "reserved" },
    });
    return intent;
  });
}
