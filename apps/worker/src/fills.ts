import { Decimal } from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import type { DecimalString, ExchangeFill, OrderSide } from "@cadence/core";
import { exchangeOrders, fills, type ExchangeOrderRow, type Tx } from "@cadence/db";

export type AttributedFill = { fill: ExchangeFill; row: ExchangeOrderRow };

export function attributeFills(
  observed: readonly ExchangeFill[],
  rows: readonly ExchangeOrderRow[],
): AttributedFill[] {
  const byClientId = new Map(rows.map((row) => [row.clientOrderId, row]));
  const byOrderId = new Map(
    rows.flatMap((row) => (row.exchangeOrderId === null ? [] : [[row.exchangeOrderId, row]])),
  );
  return observed.flatMap((fill) => {
    const row = byClientId.get(fill.clientOrderId) ?? byOrderId.get(fill.orderId);
    return row === undefined ? [] : [{ fill, row }];
  });
}

export type FillFacts = {
  openSize: DecimalString;
  flatByFills: boolean;
};

const sizeOf = (entries: readonly AttributedFill[]) =>
  entries.reduce((total, { fill }) => total.plus(fill.size), new Decimal(0));

export function fillFacts(
  observed: readonly ExchangeFill[],
  ours: readonly AttributedFill[],
  openingSide: OrderSide,
): FillFacts {
  const entries = ours.filter(({ row }) => row.role === "entry");
  const exits = ours.filter(({ row }) => row.role !== "entry");
  const openSize = Decimal.max(0, sizeOf(entries).minus(sizeOf(exits)));
  if (entries.length === 0) {
    return { openSize: openSize.toFixed(), flatByFills: false };
  }
  const openedAt = Math.min(...entries.map(({ fill }) => fill.filledAt));
  const net = observed
    .filter((fill) => fill.filledAt >= openedAt)
    .reduce(
      (total, fill) => (fill.side === openingSide ? total.plus(fill.size) : total.minus(fill.size)),
      new Decimal(0),
    );
  return { openSize: openSize.toFixed(), flatByFills: net.isZero() };
}

export async function storeFills(
  tx: Tx,
  intentId: string,
  attributed: readonly AttributedFill[],
): Promise<void> {
  for (const { fill, row } of attributed) {
    if (row.exchangeOrderId === null) {
      await tx
        .update(exchangeOrders)
        .set({ exchangeOrderId: fill.orderId })
        .where(and(eq(exchangeOrders.id, row.id), isNull(exchangeOrders.exchangeOrderId)));
    }
    await tx
      .insert(fills)
      .values({
        exchangeFillId: fill.fillId,
        clientOrderId: row.clientOrderId,
        intentId,
        role: row.role,
        side: fill.side,
        price: fill.price,
        size: fill.size,
        fee: fill.fee,
        filledAt: fill.filledAt,
      })
      .onConflictDoNothing({ target: fills.exchangeFillId });
  }
}
