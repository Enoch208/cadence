import { sql } from "drizzle-orm";
import type { Db } from "@cadence/db";

export type MeasuredStats = {
  measuredAt: number;
  plansPublished: number;
  ordersPlaced: number;
  exitsVerified: number;
  lateEntriesDeclined: number;
  duplicateOrders: number;
};

type CountRow = {
  plans_published: string;
  orders_placed: string;
  exits_verified: string;
  late_entries_declined: string;
  duplicate_orders: string;
};

export async function measuredStats(db: Db, now: number): Promise<MeasuredStats> {
  const [row] = await db.execute<CountRow>(sql`
    with live as (select correlation_id, type, data from events where environment = 'live'),
    submissions as (
      select correlation_id from live where type = 'submit_attempted'
      group by correlation_id having count(*) > 1
    )
    select
      count(distinct correlation_id) filter (where type = 'plan_published') as plans_published,
      count(distinct correlation_id) filter (where type = 'submit_attempted') as orders_placed,
      count(distinct correlation_id) filter (where type = 'exits_verified') as exits_verified,
      count(*) filter (
        where type = 'preview_decided' and data ->> 'reasons' like '%OUTSIDE_ENTRY_RANGE%'
      ) as late_entries_declined,
      (select count(*) from submissions) as duplicate_orders
    from live
  `);
  if (row === undefined) {
    throw new Error("The measured statistics query returned no row");
  }
  return {
    measuredAt: now,
    plansPublished: Number(row.plans_published),
    ordersPlaced: Number(row.orders_placed),
    exitsVerified: Number(row.exits_verified),
    lateEntriesDeclined: Number(row.late_entries_declined),
    duplicateOrders: Number(row.duplicate_orders),
  };
}
