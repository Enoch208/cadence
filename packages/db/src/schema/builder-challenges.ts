import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, instant } from "./columns";
import { walletChainEnum } from "./enums";
import { users } from "./people";

export const builderChallenges = pgTable(
  "builder_challenges",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    walletChain: walletChainEnum("wallet_chain").notNull(),
    walletAddress: text("wallet_address").notNull(),
    publicKey: text("public_key").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    strikeNonce: text("strike_nonce").notNull(),
    consentMessage: text("consent_message").notNull(),
    builderCode: text("builder_code"),
    builderFeeBps: integer("builder_fee_bps").notNull().default(0),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("builder_challenges_public_key_unique").on(table.publicKey),
    unique("builder_challenges_strike_nonce_unique").on(table.strikeNonce),
    index("builder_challenges_user_idx").on(table.userId),
    check("builder_challenges_public_key_hex", sql`${table.publicKey} ~ '^[0-9a-f]{64}$'`),
    check(
      "builder_challenges_builder_fee_bps_range",
      sql`${table.builderFeeBps} between 0 and 100`,
    ),
    check(
      "builder_challenges_expires_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type BuilderChallengeRow = typeof builderChallenges.$inferSelect;
