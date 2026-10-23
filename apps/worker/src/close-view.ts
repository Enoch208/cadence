import { Decimal } from "decimal.js";
import { z } from "zod";
import type { ExchangeFill, ExchangeOrderSnapshot, OrderRole, OrderSide } from "@cadence/core";
import type { ExchangeOrderRow } from "@cadence/db";
import { isLive } from "./exits";
import type { AttributedFill } from "./fills";
import type { IntentContext } from "./intent-context";
import type { Observation } from "./observation";

export type CloseClaim = {
  openingSide: OrderSide;
  closeAttemptedAt: number | null;
  skewMs: number;
};

const closePayloadSchema = z.object({ size: z.string() });
const legRoles: readonly OrderRole[] = ["stop", "target"];

const closeRowOf = (rows: readonly ExchangeOrderRow[]) => rows.find((row) => row.role === "close");

function closeSize(row: ExchangeOrderRow): Decimal | null {
  const payload = closePayloadSchema.safeParse(row.payload);
  return payload.success ? new Decimal(payload.data.size) : null;
}

export function orphanCloseFills(
  observed: readonly ExchangeFill[],
  rows: readonly ExchangeOrderRow[],
  known: readonly AttributedFill[],
  claim: CloseClaim,
): AttributedFill[] {
  const close = closeRowOf(rows);
  const size = close === undefined ? null : closeSize(close);
  const since = claim.closeAttemptedAt;
  if (close === undefined || size === null || since === null) {
    return [];
  }
  if (known.some(({ row }) => row.role === "close")) {
    return [];
  }
  const claimed = new Set(known.map(({ fill }) => fill.fillId));
  const otherOrders = new Set(
    rows.flatMap((row) =>
      row.role === "close" || row.exchangeOrderId === null ? [] : [row.exchangeOrderId],
    ),
  );
  const orphans = observed.filter(
    (fill) =>
      !claimed.has(fill.fillId) &&
      fill.clientOrderId === null &&
      fill.side !== claim.openingSide &&
      fill.filledAt >= since - claim.skewMs &&
      !otherOrders.has(fill.orderId) &&
      (close.exchangeOrderId === null || close.exchangeOrderId === fill.orderId),
  );
  const orders = new Set(orphans.map((fill) => fill.orderId));
  const filled = orphans.reduce((total, fill) => total.plus(fill.size), new Decimal(0));
  if (orphans.length === 0 || orders.size !== 1 || filled.greaterThan(size)) {
    return [];
  }
  return orphans.map((fill) => ({ fill, row: close }));
}

function closeFromFills(
  row: ExchangeOrderRow,
  ours: readonly AttributedFill[],
  context: IntentContext,
): ExchangeOrderSnapshot | null {
  const fills = ours.filter((attributed) => attributed.row.role === "close");
  const [first] = fills;
  const size = closeSize(row);
  if (first === undefined || size === null) {
    return null;
  }
  const filled = fills.reduce((total, { fill }) => total.plus(fill.size), new Decimal(0));
  return {
    orderId: first.fill.orderId,
    clientOrderId: row.clientOrderId,
    symbol: context.intent.market,
    side: first.fill.side,
    type: "market",
    status: filled.greaterThanOrEqualTo(size) ? "filled" : "open",
    size: size.toFixed(),
    filled: filled.toFixed(),
    price: null,
    stopPrice: null,
    reduceOnly: true,
    strategyId: null,
    isStrategyPrimary: false,
    closeReason: null,
  };
}

export function closeView(
  observation: Observation,
  args: {
    rows: readonly ExchangeOrderRow[];
    ours: readonly AttributedFill[];
    context: IntentContext;
  },
): Observation {
  const close = closeRowOf(args.rows);
  if (close === undefined) {
    return observation;
  }
  const orders = new Map(observation.orders);
  const synthesized = orders.has("close") ? null : closeFromFills(close, args.ours, args.context);
  if (synthesized !== null) {
    orders.set("close", synthesized);
  }
  const held = observation.account.positions.some(
    (position) =>
      position.symbol === args.context.intent.market && !new Decimal(position.signedSize).isZero(),
  );
  if (!held) {
    const resting = new Set(observation.account.openOrders.map((order) => order.clientOrderId));
    for (const role of legRoles) {
      const leg = orders.get(role);
      if (leg !== undefined && isLive(leg) && !resting.has(leg.clientOrderId)) {
        orders.set(role, { ...leg, status: "canceled", closeReason: "position_closed" });
      }
    }
  }
  return { ...observation, orders };
}
