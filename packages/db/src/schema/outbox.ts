import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accountConnections } from "./accounts";
import { instant } from "./columns";
import { environmentEnum, outboxKindEnum, outboxStatusEnum } from "./enums";
import { executionIntents } from "./intents";

export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: outboxKindEnum("kind").notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    accountConnectionId: uuid("account_connection_id")
      .notNull()
      .references(() => accountConnections.id),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: instant("next_attempt_at").notNull(),
    claimedAt: instant("claimed_at"),
  },
  (table) => [
    uniqueIndex("outbox_intent_kind_open_unique")
      .on(table.intentId, table.kind)
      .where(sql`${table.status} <> 'done'`),
    index("outbox_pending_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    check("outbox_attempts_not_negative", sql`${table.attempts} >= 0`),
    check(
      "outbox_claimed_has_claim_time",
      sql`${table.status} <> 'claimed' or ${table.claimedAt} is not null`,
    ),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: instant("at").notNull(),
    actor: text("actor").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    environment: environmentEnum("environment"),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
  },
  (table) => [index("events_correlation_idx").on(table.correlationId, table.id)],
);

export type OutboxRow = typeof outbox.$inferSelect;
export type EventRow = typeof events.$inferSelect;
