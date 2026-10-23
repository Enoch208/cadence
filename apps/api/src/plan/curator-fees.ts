import { Decimal } from "decimal.js";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { curatorFeeCharge, type DecimalString } from "@cadence/core";
import { executionIntents, fills, planVersions, type Executor } from "@cadence/db";

export type CuratorFeesEarned = { computed: DecimalString; fills: number };

export const noCuratorFees: CuratorFeesEarned = { computed: "0.00", fills: 0 };

export async function curatorFeesEarned(
  db: Executor,
  planIds: string[],
): Promise<ReadonlyMap<string, CuratorFeesEarned>> {
  if (planIds.length === 0) {
    return new Map();
  }
  const feeBps = sql<
    number | null
  >`(${executionIntents.approved} -> 'curatorFee' ->> 'feeBps')::int`;
  const rows = await db
    .select({ planId: planVersions.planId, price: fills.price, size: fills.size, feeBps })
    .from(fills)
    .innerJoin(executionIntents, eq(executionIntents.id, fills.intentId))
    .innerJoin(planVersions, eq(planVersions.id, executionIntents.planVersionId))
    .where(and(inArray(planVersions.planId, planIds), ne(fills.role, "recovery_close")));
  const totals = new Map<string, { computed: Decimal; fills: number }>();
  for (const row of rows) {
    if (row.feeBps === null) {
      continue;
    }
    const known = totals.get(row.planId) ?? { computed: new Decimal(0), fills: 0 };
    const charge = curatorFeeCharge(row.price, row.size, row.feeBps);
    totals.set(row.planId, { computed: known.computed.plus(charge), fills: known.fills + 1 });
  }
  return new Map(
    [...totals].map(([planId, total]) => [
      planId,
      { computed: total.computed.toFixed(2), fills: total.fills },
    ]),
  );
}
