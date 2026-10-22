import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { RiskPolicy } from "@cadence/core";
import { id, instant } from "./columns";
import { connectionStatusEnum, credentialSourceEnum, environmentEnum } from "./enums";
import { users } from "./people";

export const accountConnections = pgTable(
  "account_connections",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    environment: environmentEnum("environment").notNull(),
    strikeAccountId: text("strike_account_id").notNull(),
    publicKey: text("public_key"),
    keyCiphertext: text("key_ciphertext"),
    keyIv: text("key_iv"),
    keyTag: text("key_tag"),
    keyVersion: integer("key_version"),
    credentialSource: credentialSourceEnum("credential_source"),
    replayScenario: text("replay_scenario"),
    status: connectionStatusEnum("status").notNull().default("active"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("account_connections_environment_account_unique").on(
      table.environment,
      table.strikeAccountId,
    ),
    index("account_connections_user_idx").on(table.userId),
    check(
      "account_connections_credentials_match_environment",
      sql`(${table.environment} = 'live'
        and ${table.publicKey} is not null and ${table.keyCiphertext} is not null
        and ${table.keyIv} is not null and ${table.keyTag} is not null
        and ${table.keyVersion} is not null and ${table.credentialSource} is not null
        and ${table.replayScenario} is null)
      or (${table.environment} = 'replay'
        and ${table.publicKey} is null and ${table.keyCiphertext} is null
        and ${table.keyIv} is null and ${table.keyTag} is null
        and ${table.keyVersion} is null and ${table.credentialSource} is null
        and ${table.replayScenario} is not null)`,
    ),
  ],
);

export const riskPolicies = pgTable(
  "risk_policies",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<RiskPolicy>().notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("risk_policies_user_version_unique").on(table.userId, table.version),
    check("risk_policies_version_positive", sql`${table.version} >= 1`),
  ],
);

export type AccountConnectionRow = typeof accountConnections.$inferSelect;
export type RiskPolicyRow = typeof riskPolicies.$inferSelect;
