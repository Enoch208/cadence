import { and, eq, sql } from "drizzle-orm";
import { users, type Executor, type UserRow } from "@cadence/db";
import type { Session } from "./session";
import type { TelegramIdentity } from "./telegram";

export async function upsertTelegramUser(
  db: Executor,
  identity: TelegramIdentity,
  now: number,
): Promise<UserRow> {
  const displayName = [identity.firstName, identity.lastName ?? ""].join(" ").trim();
  const [row] = await db
    .insert(users)
    .values({
      telegramUserId: identity.telegramUserId,
      displayName,
      telegramUsername: identity.username,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: { displayName, telegramUsername: identity.username },
    })
    .returning();
  if (row === undefined) {
    throw new Error("Upserting a Telegram user returned no row");
  }
  return row;
}

export async function findUser(db: Executor, userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row ?? null;
}

export const userView = (user: UserRow) => ({ id: user.id, displayName: user.displayName });

export async function endSessions(db: Executor, session: Session): Promise<void> {
  await db
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(and(eq(users.id, session.userId), eq(users.sessionEpoch, session.epoch)));
}
