import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, instant } from "./columns";

export const users = pgTable(
  "users",
  {
    id: id(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    displayName: text("display_name").notNull(),
    telegramUsername: text("telegram_username"),
    sessionEpoch: integer("session_epoch").notNull().default(0),
    botStartedAt: instant("bot_started_at"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("users_telegram_user_id_unique").on(table.telegramUserId),
    check("users_session_epoch_not_negative", sql`${table.sessionEpoch} >= 0`),
    check("users_telegram_user_id_positive", sql`${table.telegramUserId} > 0`),
  ],
);

export const communities = pgTable(
  "communities",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("communities_telegram_chat_id_unique").on(table.telegramChatId),
    check("communities_name_present", sql`length(trim(${table.name})) > 0`),
  ],
);

export const communityPublishers = pgTable(
  "community_publishers",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ name: "community_publishers_pk", columns: [table.communityId, table.userId] }),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
