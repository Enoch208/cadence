import { eq } from "drizzle-orm";
import { accountConnections, executionIntents, fills, outbox } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { correctedPlan, longPlan, testNow } from "./support/fixtures";
import {
  insertCommunity,
  insertIntent,
  insertMember,
  insertOrder,
  insertPlanVersion,
  insertPublishedPlan,
  insertUser,
} from "./support/rows";

resetDatabaseBetweenTests();

const violation = (code: string, constraint: string) => ({
  cause: { code, constraint_name: constraint },
});

async function memberWithPlan() {
  const curator = await insertUser(1001);
  const community = await insertCommunity(curator.id, -1001234567890n);
  const plan = await insertPublishedPlan(curator.id, community.id);
  const version = await insertPlanVersion(plan.id, 1, longPlan);
  const member = await insertMember(2002);
  return { plan, version, member };
}

describe("database invariants", () => {
  it("refuses a second intent for the same account and plan version, even after the first ended", async () => {
    const { version, member } = await memberWithPlan();
    const first = await insertIntent(member, version.id);
    await db
      .update(executionIntents)
      .set({ state: "closed", updatedAt: testNow + 1 })
      .where(eq(executionIntents.id, first.id));
    await expect(insertIntent(member, version.id)).rejects.toMatchObject(
      violation("23505", "execution_intents_account_plan_version_unique"),
    );
  });

  it("allows one open intent per account and market, and another once it ends", async () => {
    const { plan, version, member } = await memberWithPlan();
    const corrected = await insertPlanVersion(plan.id, 2, correctedPlan);
    const first = await insertIntent(member, version.id, "open_verified");
    await expect(insertIntent(member, corrected.id)).rejects.toMatchObject(
      violation("23505", "execution_intents_account_market_open_unique"),
    );
    await db
      .update(executionIntents)
      .set({ state: "closed", updatedAt: testNow + 1 })
      .where(eq(executionIntents.id, first.id));
    await expect(insertIntent(member, corrected.id)).resolves.toMatchObject({ state: "reserved" });
  });

  it("refuses a client order ID that another order already carries", async () => {
    const { version, member } = await memberWithPlan();
    const intent = await insertIntent(member, version.id);
    const entry = await insertOrder(intent.id, "entry");
    await expect(insertOrder(intent.id, "stop", entry.clientOrderId)).rejects.toMatchObject(
      violation("23505", "exchange_orders_client_order_id_unique"),
    );
  });

  it("refuses a second order for the same intent and role", async () => {
    const { version, member } = await memberWithPlan();
    const intent = await insertIntent(member, version.id);
    await insertOrder(intent.id, "entry");
    await expect(insertOrder(intent.id, "entry", "cad-other-e")).rejects.toMatchObject(
      violation("23505", "exchange_orders_intent_role_unique"),
    );
  });

  it("records an exchange fill only once", async () => {
    const { version, member } = await memberWithPlan();
    const intent = await insertIntent(member, version.id);
    const entry = await insertOrder(intent.id, "entry");
    const fill = {
      exchangeFillId: "fill-1",
      clientOrderId: entry.clientOrderId,
      intentId: intent.id,
      role: "entry" as const,
      side: "buy" as const,
      price: "84212",
      size: "0.01208",
      fee: "0.508640",
      filledAt: testNow,
    };
    await db.insert(fills).values(fill);
    await expect(db.insert(fills).values(fill)).rejects.toMatchObject(
      violation("23505", "fills_exchange_fill_id_unique"),
    );
  });

  it("keeps one open outbox item per intent and kind, and allows another once it is done", async () => {
    const { version, member } = await memberWithPlan();
    const intent = await insertIntent(member, version.id);
    const item = {
      kind: "submit" as const,
      intentId: intent.id,
      accountConnectionId: member.connection.id,
      nextAttemptAt: testNow,
    };
    const [first] = await db.insert(outbox).values(item).returning();
    await expect(db.insert(outbox).values(item)).rejects.toMatchObject(
      violation("23505", "outbox_intent_kind_open_unique"),
    );
    await db
      .update(outbox)
      .set({ status: "done" })
      .where(eq(outbox.id, first?.id ?? 0));
    await expect(db.insert(outbox).values(item).returning()).resolves.toHaveLength(1);
  });

  it("never stores credentials on a replay connection, and always on a live one", async () => {
    const user = await insertUser(3003);
    const replay = {
      userId: user.id,
      environment: "replay" as const,
      strikeAccountId: "replay-1",
      replayScenario: "happy_path",
      createdAt: testNow,
    };
    await expect(
      db.insert(accountConnections).values({ ...replay, keyCiphertext: "c2VhbGVk" }),
    ).rejects.toMatchObject(
      violation("23514", "account_connections_credentials_match_environment"),
    );
    await expect(
      db.insert(accountConnections).values({
        ...replay,
        environment: "live",
        replayScenario: null,
      }),
    ).rejects.toMatchObject(
      violation("23514", "account_connections_credentials_match_environment"),
    );
    await expect(db.insert(accountConnections).values(replay).returning()).resolves.toHaveLength(1);
  });
});
