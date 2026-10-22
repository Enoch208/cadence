import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { instant } from "./columns";
import { intentStateEnum, notificationStatusEnum } from "./enums";
import { executionIntents } from "./intents";
import { users } from "./people";

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    state: intentStateEnum("state").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: instant("next_attempt_at").notNull(),
    claimedAt: instant("claimed_at"),
    sentAt: instant("sent_at"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    failure: text("failure"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("notifications_intent_state_unique").on(table.intentId, table.state),
    index("notifications_pending_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    check("notifications_attempts_not_negative", sql`${table.attempts} >= 0`),
    check(
      "notifications_claimed_has_claim_time",
      sql`${table.status} <> 'claimed' or ${table.claimedAt} is not null`,
    ),
    check(
      "notifications_sent_when_sent",
      sql`(${table.status} = 'sent') = (${table.sentAt} is not null and ${table.telegramMessageId} is not null)`,
    ),
    check(
      "notifications_failed_has_failure",
      sql`${table.status} <> 'failed' or ${table.failure} is not null`,
    ),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
