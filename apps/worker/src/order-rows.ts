import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import {
  canonicalJson,
  sha256Hex,
  type ExchangeOrderSnapshot,
  type OrderRole,
} from "@cadence/core";
import { exchangeOrders, type ExchangeOrderRow, type Executor } from "@cadence/db";
import {
  reduceOnlyCloseBody,
  strategyRequestBody,
  type ReduceOnlyClose,
  type StrategyOrder,
} from "@cadence/strike";

export type NewOrderRow = {
  intentId: string;
  role: OrderRole;
  clientOrderId: string;
  payload: unknown;
  payloadDigest: string;
};

const digestOf = (payload: unknown) => sha256Hex(canonicalJson(payload));

export function strategyRows(intentId: string, order: StrategyOrder): NewOrderRow[] {
  const payload = strategyRequestBody(order);
  const payloadDigest = digestOf(payload);
  const roles: readonly (readonly [OrderRole, string])[] = [
    ["entry", order.entryClientOrderId],
    ["stop", order.stopClientOrderId],
    ["target", order.targetClientOrderId],
  ];
  return roles.map(([role, clientOrderId]) => ({
    intentId,
    role,
    clientOrderId,
    payload,
    payloadDigest,
  }));
}

export function closingRow(
  intentId: string,
  role: "recovery_close" | "close",
  close: ReduceOnlyClose,
): NewOrderRow {
  const payload = reduceOnlyCloseBody(close);
  return {
    intentId,
    role,
    clientOrderId: close.clientOrderId,
    payload,
    payloadDigest: digestOf(payload),
  };
}

export const rowFor = (rows: readonly ExchangeOrderRow[], role: OrderRole) =>
  rows.find((row) => row.role === role) ?? null;

export const loadOrderRows = (db: Executor, intentId: string): Promise<ExchangeOrderRow[]> =>
  db.select().from(exchangeOrders).where(eq(exchangeOrders.intentId, intentId));

const sameSnapshot = (row: ExchangeOrderRow, snapshot: ExchangeOrderSnapshot) =>
  row.exchangeOrderId === snapshot.orderId &&
  row.lastStatus === snapshot.status &&
  new Decimal(row.filledSize).equals(snapshot.filled);

export async function recordSnapshot(
  db: Executor,
  row: ExchangeOrderRow,
  snapshot: ExchangeOrderSnapshot,
): Promise<boolean> {
  if (sameSnapshot(row, snapshot)) {
    return false;
  }
  await db
    .update(exchangeOrders)
    .set({
      exchangeOrderId: snapshot.orderId,
      lastStatus: snapshot.status,
      filledSize: snapshot.filled,
    })
    .where(eq(exchangeOrders.id, row.id));
  return true;
}
