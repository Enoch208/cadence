import { asc, eq } from "drizzle-orm";
import {
  accountConnections,
  events,
  exchangeOrders,
  executionIntents,
  fills,
  outbox,
  receipts,
  reservations,
} from "@cadence/db";
import { db } from "./database";

export async function intentState(intentId: string) {
  const [row] = await db
    .select({ state: executionIntents.state })
    .from(executionIntents)
    .where(eq(executionIntents.id, intentId));
  return row?.state ?? null;
}

export async function eventsOf(intentId: string) {
  return db
    .select({ type: events.type, data: events.data, actor: events.actor })
    .from(events)
    .where(eq(events.correlationId, intentId))
    .orderBy(asc(events.id));
}

export const eventTypes = async (intentId: string) =>
  (await eventsOf(intentId)).map(({ type }) => type);

export async function lastEventData(intentId: string, type: string) {
  const matching = (await eventsOf(intentId)).filter((event) => event.type === type);
  return matching.at(-1)?.data ?? null;
}

export const orderRowsOf = (intentId: string) =>
  db
    .select()
    .from(exchangeOrders)
    .where(eq(exchangeOrders.intentId, intentId))
    .orderBy(asc(exchangeOrders.role));

export async function reservationStatus(intentId: string) {
  const [row] = await db
    .select({ status: reservations.status })
    .from(reservations)
    .where(eq(reservations.intentId, intentId));
  return row?.status ?? null;
}

export const outboxOf = (intentId: string) =>
  db
    .select({ kind: outbox.kind, status: outbox.status })
    .from(outbox)
    .where(eq(outbox.intentId, intentId))
    .orderBy(asc(outbox.id));

export async function receiptOf(intentId: string) {
  const [row] = await db.select().from(receipts).where(eq(receipts.intentId, intentId));
  return row?.body ?? null;
}

export const fillsOf = (intentId: string) =>
  db.select().from(fills).where(eq(fills.intentId, intentId)).orderBy(asc(fills.filledAt));

export async function connectionStatus(connectionId: string) {
  const [row] = await db
    .select({ status: accountConnections.status })
    .from(accountConnections)
    .where(eq(accountConnections.id, connectionId));
  return row?.status ?? null;
}
