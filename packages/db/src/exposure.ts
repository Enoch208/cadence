import { and, asc, eq, gte, notInArray, sql } from "drizzle-orm";
import { terminalIntentStates, type CadenceExposure } from "@cadence/core";
import type { Executor } from "./client";
import { executionIntents, receipts, reservations } from "./schema/intents";
import { exchangeOrders } from "./schema/orders";

const dayMs = 86_400_000;

export const sessionStartUtc = (nowMs: number) => Math.floor(nowMs / dayMs) * dayMs;

export async function loadExposure(
  db: Executor,
  accountConnectionId: string,
  nowMs: number,
): Promise<CadenceExposure> {
  const ofAccount = eq(executionIntents.accountConnectionId, accountConnectionId);
  const busy = await db
    .selectDistinct({ market: executionIntents.market })
    .from(executionIntents)
    .where(and(ofAccount, notInArray(executionIntents.state, [...terminalIntentStates])))
    .orderBy(asc(executionIntents.market));
  const orders = await db
    .select({ clientOrderId: exchangeOrders.clientOrderId })
    .from(exchangeOrders)
    .innerJoin(executionIntents, eq(executionIntents.id, exchangeOrders.intentId))
    .where(ofAccount)
    .orderBy(asc(exchangeOrders.clientOrderId));
  const [committed] = await db
    .select({ total: sql<string>`coalesce(sum(${reservations.plannedLoss}), 0)::text` })
    .from(reservations)
    .where(
      and(
        eq(reservations.accountConnectionId, accountConnectionId),
        eq(reservations.status, "active"),
      ),
    );
  const realizedPnl = sql`(${receipts.body} ->> 'realizedPnl')::numeric`;
  const [session] = await db
    .select({ loss: sql<string>`coalesce(-sum(least(${realizedPnl}, 0)), 0)::text` })
    .from(receipts)
    .innerJoin(executionIntents, eq(executionIntents.id, receipts.intentId))
    .where(and(ofAccount, gte(receipts.builtAt, sessionStartUtc(nowMs))));
  return {
    busySymbols: busy.map(({ market }) => market),
    knownClientOrderIds: orders.map(({ clientOrderId }) => clientOrderId),
    committedRisk: committed?.total ?? "0",
    realizedSessionLoss: session?.loss ?? "0",
  };
}
