import { Decimal } from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import type { DecimalString, ExchangeFill, OrderSide } from "@cadence/core";
import { exchangeOrders, fills, type ExchangeOrderRow, type Tx } from "@cadence/db";
import { orphanCloseFills } from "./close-view";

export type AttributedFill = { fill: ExchangeFill; row: ExchangeOrderRow };

export type EntryClaim = {
  openingSide: OrderSide;
  submittedAt: number;
  quantity: DecimalString;
  closeAttemptedAt: number | null;
};

export const fillClockSkewMs = 5_000;

function orphanEntryFills(
  observed: readonly ExchangeFill[],
  rows: readonly ExchangeOrderRow[],
  known: readonly AttributedFill[],
  claim: EntryClaim,
): AttributedFill[] {
  const entry = rows.find((row) => row.role === "entry");
  if (entry === undefined || known.some(({ row }) => row.role === "entry")) {
    return [];
  }
  const claimed = new Set(known.map(({ fill }) => fill.fillId));
  const legIds = new Set(
    rows.flatMap((row) =>
      row.role === "entry" || row.exchangeOrderId === null ? [] : [row.exchangeOrderId],
    ),
  );
  const orphans = observed.filter(
    (fill) =>
      !claimed.has(fill.fillId) &&
      fill.clientOrderId === null &&
      fill.side === claim.openingSide &&
      fill.filledAt >= claim.submittedAt - fillClockSkewMs &&
      !legIds.has(fill.orderId) &&
      (entry.exchangeOrderId === null || entry.exchangeOrderId === fill.orderId),
  );
  const orders = new Set(orphans.map((fill) => fill.orderId));
  const size = orphans.reduce((total, fill) => total.plus(fill.size), new Decimal(0));
  if (orphans.length === 0 || orders.size !== 1 || size.greaterThan(claim.quantity)) {
    return [];
  }
  return orphans.map((fill) => ({ fill, row: entry }));
}

export function attributeFills(
  observed: readonly ExchangeFill[],
  rows: readonly ExchangeOrderRow[],
  claim: EntryClaim,
): AttributedFill[] {
  const byClientId = new Map(rows.map((row) => [row.clientOrderId, row]));
  const byOrderId = new Map(
    rows.flatMap((row) => (row.exchangeOrderId === null ? [] : [[row.exchangeOrderId, row]])),
  );
  const known = observed.flatMap((fill) => {
    const row =
      (fill.clientOrderId === null ? undefined : byClientId.get(fill.clientOrderId)) ??
      byOrderId.get(fill.orderId);
    return row === undefined ? [] : [{ fill, row }];
  });
  return [
    ...known,
    ...orphanEntryFills(observed, rows, known, claim),
    ...orphanCloseFills(observed, rows, known, { ...claim, skewMs: fillClockSkewMs }),
  ];
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
