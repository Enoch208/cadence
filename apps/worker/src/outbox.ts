import { and, asc, eq, lte, notInArray, sql } from "drizzle-orm";
import { outbox, type Db, type Executor, type OutboxKind, type OutboxRow } from "@cadence/db";

export const leaseMs = 60_000;

const candidateWindow = 16;
const maxBackoffMs = 30_000;

export type OutboxItem = Pick<
  OutboxRow,
  "id" | "kind" | "intentId" | "accountConnectionId" | "attempts"
>;

const itemColumns = {
  id: outbox.id,
  kind: outbox.kind,
  intentId: outbox.intentId,
  accountConnectionId: outbox.accountConnectionId,
  attempts: outbox.attempts,
};

async function accountIsFree(tx: Executor, accountConnectionId: string): Promise<boolean> {
  const [lock] = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${`outbox:${accountConnectionId}`}, 0)) as locked`,
  );
  if (lock?.locked !== true) {
    return false;
  }
  const [inFlight] = await tx
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.accountConnectionId, accountConnectionId), eq(outbox.status, "claimed")))
    .limit(1);
  return inFlight === undefined;
}

export function claimNext(db: Db, now: number): Promise<OutboxItem | null> {
  return db.transaction(async (tx) => {
    const passedOver: string[] = [];
    for (let looked = 0; looked < candidateWindow; looked += 1) {
      const [candidate] = await tx
        .select({ id: outbox.id, accountConnectionId: outbox.accountConnectionId })
        .from(outbox)
        .where(
          and(
            eq(outbox.status, "pending"),
            lte(outbox.nextAttemptAt, now),
            passedOver.length > 0 ? notInArray(outbox.accountConnectionId, passedOver) : undefined,
          ),
        )
        .orderBy(asc(outbox.nextAttemptAt), asc(outbox.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) {
        return null;
      }
      if (await accountIsFree(tx, candidate.accountConnectionId)) {
        const [claimed] = await tx
          .update(outbox)
          .set({ status: "claimed", claimedAt: now, attempts: sql`${outbox.attempts} + 1` })
          .where(eq(outbox.id, candidate.id))
          .returning(itemColumns);
        return claimed ?? null;
      }
      passedOver.push(candidate.accountConnectionId);
    }
    return null;
  });
}

export async function reclaimExpiredClaims(db: Db, now: number): Promise<number> {
  const reclaimed = await db
    .update(outbox)
    .set({ status: "pending", claimedAt: null, nextAttemptAt: now })
    .where(and(eq(outbox.status, "claimed"), lte(outbox.claimedAt, now - leaseMs)))
    .returning({ id: outbox.id });
  return reclaimed.length;
}

export async function completeItem(db: Executor, item: OutboxItem): Promise<void> {
  await db
    .update(outbox)
    .set({ status: "done" })
    .where(and(eq(outbox.id, item.id), eq(outbox.status, "claimed")));
}

export const backoffMs = (attempts: number) =>
  Math.min(maxBackoffMs, 1_000 * 2 ** Math.max(0, attempts - 1));

export async function deferItem(db: Executor, item: OutboxItem, now: number): Promise<void> {
  await db
    .update(outbox)
    .set({ status: "pending", claimedAt: null, nextAttemptAt: now + backoffMs(item.attempts) })
    .where(and(eq(outbox.id, item.id), eq(outbox.status, "claimed")));
}

export async function enqueue(
  db: Executor,
  item: { kind: OutboxKind; intentId: string; accountConnectionId: string; at: number },
): Promise<void> {
  await db
    .insert(outbox)
    .values({
      kind: item.kind,
      intentId: item.intentId,
      accountConnectionId: item.accountConnectionId,
      nextAttemptAt: item.at,
    })
    .onConflictDoNothing();
}
