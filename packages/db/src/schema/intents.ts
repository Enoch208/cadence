import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Decision, IntentState, Proposal, Receipt } from "@cadence/core";
import { accountConnections, riskPolicies } from "./accounts";
import { decimal, id, instant, oneOf, sha256Hex } from "./columns";
import { intentStateEnum, reservationStatusEnum } from "./enums";
import { users } from "./people";
import { planVersions } from "./plans";

const terminalStates = [
  "blocked",
  "rejected",
  "unfilled",
  "canceled",
  "expired",
  "closed",
] as const satisfies readonly IntentState[];

export const previews = pgTable(
  "previews",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountConnectionId: uuid("account_connection_id")
      .notNull()
      .references(() => accountConnections.id),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => riskPolicies.id),
    quantityCeiling: decimal("quantity_ceiling"),
    decision: jsonb("decision").$type<Decision>().notNull(),
    inputDigest: text("input_digest").notNull(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (table) => [
    check("previews_expire_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "previews_quantity_ceiling_positive",
      sql`${table.quantityCeiling} is null or ${table.quantityCeiling} > 0`,
    ),
    check("previews_input_digest_is_sha256", sha256Hex(table.inputDigest)),
  ],
);

export const executionIntents = pgTable(
  "execution_intents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountConnectionId: uuid("account_connection_id").notNull(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id),
    previewId: uuid("preview_id")
      .notNull()
      .references(() => previews.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => riskPolicies.id),
    market: text("market").notNull(),
    approved: jsonb("approved").$type<Proposal>().notNull(),
    approvedDigest: text("approved_digest").notNull(),
    state: intentStateEnum("state").notNull(),
    strategyId: text("strategy_id").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "execution_intents_account_connection_fk",
      columns: [table.accountConnectionId],
      foreignColumns: [accountConnections.id],
    }),
    unique("execution_intents_strategy_id_unique").on(table.strategyId),
    unique("execution_intents_account_plan_version_unique").on(
      table.accountConnectionId,
      table.planVersionId,
    ),
    uniqueIndex("execution_intents_account_market_open_unique")
      .on(table.accountConnectionId, table.market)
      .where(sql`not (${oneOf(table.state, terminalStates)})`),
    index("execution_intents_user_idx").on(table.userId),
    check("execution_intents_approved_digest_is_sha256", sha256Hex(table.approvedDigest)),
    check(
      "execution_intents_updated_after_creation",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    accountConnectionId: uuid("account_connection_id")
      .notNull()
      .references(() => accountConnections.id),
    plannedLoss: decimal("planned_loss").notNull(),
    initialMargin: decimal("initial_margin").notNull(),
    status: reservationStatusEnum("status").notNull().default("active"),
    releasedAt: instant("released_at"),
  },
  (table) => [
    unique("reservations_intent_unique").on(table.intentId),
    index("reservations_account_active_idx")
      .on(table.accountConnectionId)
      .where(sql`${table.status} = 'active'`),
    check("reservations_planned_loss_not_negative", sql`${table.plannedLoss} >= 0`),
    check("reservations_initial_margin_not_negative", sql`${table.initialMargin} >= 0`),
    check(
      "reservations_released_when_released",
      sql`(${table.status} = 'released') = (${table.releasedAt} is not null)`,
    ),
  ],
);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    body: jsonb("body").$type<Receipt>().notNull(),
    builtAt: instant("built_at").notNull(),
  },
  (table) => [unique("receipts_intent_unique").on(table.intentId)],
);

export type PreviewRow = typeof previews.$inferSelect;
export type ExecutionIntentRow = typeof executionIntents.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
