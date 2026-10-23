import { eq } from "drizzle-orm";
import {
  accountConnections,
  builderChallenges,
  executionIntents,
  fills,
  outbox,
} from "@cadence/db";
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

  it("records how every live key was made, and never a source for a replay account", async () => {
    const user = await insertUser(3004);
    const sealedKey = {
      publicKey: "b".repeat(64),
      keyCiphertext: "c2VhbGVk",
      keyIv: "AAAAAAAAAAAAAAAA",
      keyTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
    };
    const live = {
      userId: user.id,
      environment: "live" as const,
      strikeAccountId: "strike-main-9",
      createdAt: testNow,
      ...sealedKey,
    };
    await expect(db.insert(accountConnections).values(live)).rejects.toMatchObject(
      violation("23514", "account_connections_credentials_match_environment"),
    );
    await expect(
      db.insert(accountConnections).values({
        userId: user.id,
        environment: "replay",
        strikeAccountId: "replay-2",
        replayScenario: "happy_path",
        credentialSource: "api_key",
        createdAt: testNow,
      }),
    ).rejects.toMatchObject(
      violation("23514", "account_connections_credentials_match_environment"),
    );
    await expect(
      db
        .insert(accountConnections)
        .values({ ...live, credentialSource: "builder" })
        .returning(),
    ).resolves.toMatchObject([{ credentialSource: "builder" }]);
  });

  it("keeps a builder approval whole, in Strike's range and on a builder or replay account", async () => {
    const user = await insertUser(3006);
    const live = {
      userId: user.id,
      environment: "live" as const,
      createdAt: testNow,
      publicKey: "d".repeat(64),
      keyCiphertext: "c2VhbGVk",
      keyIv: "AAAAAAAAAAAAAAAA",
      keyTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
    };
    const refused: [Record<string, unknown>, string][] = [
      [{ credentialSource: "api_key", builderCode: "kemi", builderFeeBps: 5 }, "needs_builder"],
      [{ credentialSource: "builder", builderCode: "kemi" }, "approval_whole"],
      [{ credentialSource: "builder", builderFeeBps: 5 }, "approval_whole"],
      [{ credentialSource: "builder", builderCode: "kemi", builderFeeBps: 101 }, "bps_range"],
    ];
    for (const [index, [fields, constraint]] of refused.entries()) {
      await expect(
        db.insert(accountConnections).values({
          ...live,
          credentialSource: "builder",
          strikeAccountId: `strike-main-${String(index)}`,
          ...fields,
        }),
      ).rejects.toMatchObject(
        violation(
          "23514",
          {
            needs_builder: "account_connections_builder_code_needs_builder_connect",
            approval_whole: "account_connections_builder_approval_whole",
            bps_range: "account_connections_builder_fee_bps_range",
          }[constraint] ?? constraint,
        ),
      );
    }
    const kept = [
      { ...live, strikeAccountId: "strike-main-ok", credentialSource: "builder" as const },
      {
        userId: user.id,
        environment: "replay" as const,
        strikeAccountId: "replay-builder",
        replayScenario: "happy_path",
        createdAt: testNow,
      },
    ];
    for (const row of kept) {
      await expect(
        db
          .insert(accountConnections)
          .values({ ...row, builderCode: "kemi", builderFeeBps: 5 })
          .returning(),
      ).resolves.toMatchObject([{ builderCode: "kemi", builderFeeBps: 5 }]);
    }
  });

  it("keeps a pending wallet connection to one lowercase key and one Strike nonce", async () => {
    const user = await insertUser(3005);
    const challenge = {
      userId: user.id,
      walletChain: "solana" as const,
      walletAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      publicKey: "c".repeat(64),
      keyCiphertext: "c2VhbGVk",
      keyIv: "AAAAAAAAAAAAAAAA",
      keyTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: 1,
      strikeNonce: "0192f0c1-7b8e-7c3a-9d61-2f1e4b5a6c7d",
      consentMessage: "Connect to Strike via builder",
      expiresAt: testNow + 270_000,
      createdAt: testNow,
    };
    await expect(
      db.insert(builderChallenges).values({ ...challenge, publicKey: "C".repeat(64) }),
    ).rejects.toMatchObject(violation("23514", "builder_challenges_public_key_hex"));
    await expect(
      db.insert(builderChallenges).values({ ...challenge, expiresAt: testNow }),
    ).rejects.toMatchObject(violation("23514", "builder_challenges_expires_after_creation"));
    await db.insert(builderChallenges).values(challenge);
    await expect(
      db.insert(builderChallenges).values({ ...challenge, publicKey: "d".repeat(64) }),
    ).rejects.toMatchObject(violation("23505", "builder_challenges_strike_nonce_unique"));
    await expect(
      db.insert(builderChallenges).values({ ...challenge, strikeNonce: "another-nonce" }),
    ).rejects.toMatchObject(violation("23505", "builder_challenges_public_key_unique"));
  });
});
