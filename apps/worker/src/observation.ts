import { Decimal } from "decimal.js";
import { and, eq, inArray, max } from "drizzle-orm";
import type {
  AccountState,
  ExchangeFill,
  ExchangeOrderSnapshot,
  IntentState,
  OrderRole,
} from "@cadence/core";
import { events, type ExchangeOrderRow, type Executor } from "@cadence/db";
import type { StrikeClient } from "@cadence/strike";
import type { IntentContext } from "./intent-context";
import { rowFor } from "./order-rows";

export const fillLookbackMs = 60_000;

const openStates: readonly IntentState[] = ["open_verifying", "open_verified", "recovery_required"];
const followUpRoles: readonly OrderRole[] = ["stop", "target", "recovery_close"];

export type Observation = {
  account: AccountState;
  orders: ReadonlyMap<OrderRole, ExchangeOrderSnapshot>;
  fills: readonly ExchangeFill[];
};

export async function observe(
  client: StrikeClient,
  context: IntentContext,
  rows: readonly ExchangeOrderRow[],
): Promise<Observation> {
  const { market, state } = context.intent;
  const entryRow = rowFor(rows, "entry");
  if (entryRow === null) {
    throw new Error(`Intent ${context.intent.id} is ${state} with no persisted entry order`);
  }
  const [account, entry, fills] = await Promise.all([
    client.accountState(market),
    client.order(market, entryRow.clientOrderId),
    client.fills(market, context.intent.createdAt - fillLookbackMs),
  ]);
  const entered = entry !== null && new Decimal(entry.filled).greaterThan(0);
  const followUps = await Promise.all(
    followUpRoles.map(async (role) => {
      const row = rowFor(rows, role);
      if (row === null) {
        return null;
      }
      const open = account.openOrders.find((order) => order.clientOrderId === row.clientOrderId);
      const lookUp = role === "recovery_close" || entered || openStates.includes(state);
      const snapshot = open ?? (lookUp ? await client.order(market, row.clientOrderId) : null);
      return snapshot === null ? null : ([role, snapshot] as const);
    }),
  );
  const orders = new Map<OrderRole, ExchangeOrderSnapshot>(
    entry === null ? [] : [["entry", entry]],
  );
  for (const found of followUps) {
    if (found !== null) {
      orders.set(...found);
    }
  }
  return { account, orders, fills };
}

export type Milestones = { submittedAt: number; filledAt: number | null };

export async function milestones(db: Executor, intentId: string): Promise<Milestones> {
  const rows = await db
    .select({ type: events.type, at: max(events.at) })
    .from(events)
    .where(
      and(
        eq(events.correlationId, intentId),
        inArray(events.type, ["submit_attempted", "fill_observed"]),
      ),
    )
    .groupBy(events.type);
  const at = (type: string) => rows.find((row) => row.type === type)?.at ?? null;
  const submittedAt = at("submit_attempted");
  if (submittedAt === null) {
    throw new Error(`Intent ${intentId} has no record of its submission`);
  }
  return { submittedAt, filledAt: at("fill_observed") };
}
