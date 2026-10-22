import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { decimal, id, instant, sha256Hex } from "./columns";
import { exchangeOrderStatusEnum, orderRoleEnum, orderSideEnum } from "./enums";
import { executionIntents } from "./intents";

export const exchangeOrders = pgTable(
  "exchange_orders",
  {
    id: id(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    role: orderRoleEnum("role").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    exchangeOrderId: text("exchange_order_id"),
    payload: jsonb("payload").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    lastStatus: exchangeOrderStatusEnum("last_status"),
    filledSize: decimal("filled_size").notNull().default("0"),
  },
  (table) => [
    unique("exchange_orders_client_order_id_unique").on(table.clientOrderId),
    unique("exchange_orders_intent_role_unique").on(table.intentId, table.role),
    unique("exchange_orders_exchange_order_id_unique").on(table.exchangeOrderId),
    check("exchange_orders_payload_digest_is_sha256", sha256Hex(table.payloadDigest)),
    check("exchange_orders_filled_size_not_negative", sql`${table.filledSize} >= 0`),
  ],
);

export const fills = pgTable(
  "fills",
  {
    id: id(),
    exchangeFillId: text("exchange_fill_id").notNull(),
    clientOrderId: text("client_order_id")
      .notNull()
      .references(() => exchangeOrders.clientOrderId),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => executionIntents.id),
    role: orderRoleEnum("role").notNull(),
    side: orderSideEnum("side").notNull(),
    price: decimal("price").notNull(),
    size: decimal("size").notNull(),
    fee: decimal("fee").notNull(),
    filledAt: instant("filled_at").notNull(),
  },
  (table) => [
    unique("fills_exchange_fill_id_unique").on(table.exchangeFillId),
    index("fills_intent_idx").on(table.intentId),
    check("fills_price_positive", sql`${table.price} > 0`),
    check("fills_size_positive", sql`${table.size} > 0`),
  ],
);

export type ExchangeOrderRow = typeof exchangeOrders.$inferSelect;
export type FillRow = typeof fills.$inferSelect;
