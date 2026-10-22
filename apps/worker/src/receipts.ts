import { asc, eq } from "drizzle-orm";
import {
  buildReceipt,
  type ExchangeFill,
  type ExchangeOrderSnapshot,
  type IntentState,
} from "@cadence/core";
import { exchangeOrders, fills, receipts, type Tx } from "@cadence/db";
import type { IntentContext } from "./intent-context";

async function persistedFills(tx: Tx, context: IntentContext): Promise<ExchangeFill[]> {
  const rows = await tx
    .select({ fill: fills, orderId: exchangeOrders.exchangeOrderId })
    .from(fills)
    .innerJoin(exchangeOrders, eq(exchangeOrders.clientOrderId, fills.clientOrderId))
    .where(eq(fills.intentId, context.intent.id))
    .orderBy(asc(fills.filledAt), asc(fills.exchangeFillId));
  return rows.map(({ fill, orderId }) => {
    if (orderId === null) {
      throw new Error(`Fill ${fill.exchangeFillId} belongs to an order with no exchange ID`);
    }
    return {
      fillId: fill.exchangeFillId,
      orderId,
      clientOrderId: fill.clientOrderId,
      symbol: context.intent.market,
      side: fill.side,
      price: fill.price,
      size: fill.size,
      fee: fill.fee,
      filledAt: fill.filledAt,
    };
  });
}

export async function storeReceipt(
  tx: Tx,
  args: {
    context: IntentContext;
    state: IntentState;
    orders: readonly ExchangeOrderSnapshot[];
    at: number;
  },
): Promise<void> {
  const { context } = args;
  const body = buildReceipt({
    intentId: context.intent.id,
    planPublicId: context.planRow.publicId,
    planVersion: context.version.version,
    planDigest: context.version.digest,
    plan: context.plan,
    policyVersion: context.policyVersion,
    decision: context.preview.decision,
    finalState: args.state,
    orders: args.orders,
    fills: await persistedFills(tx, context),
    reconciledAt: args.at,
  });
  await tx.insert(receipts).values({ intentId: context.intent.id, body, builtAt: args.at });
}
