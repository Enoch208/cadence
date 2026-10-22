import { eq, sql } from "drizzle-orm";
import { users, type Db } from "@cadence/db";
import type { TelegramIdentity } from "../auth/telegram";
import { upsertTelegramUser } from "../auth/users";

export function recordBotStart(db: Db, identity: TelegramIdentity, now: number): Promise<void> {
  return db.transaction(async (tx) => {
    const user = await upsertTelegramUser(tx, identity, now);
    await tx
      .update(users)
      .set({ botStartedAt: sql`coalesce(${users.botStartedAt}, ${now})` })
      .where(eq(users.id, user.id));
  });
}

export async function recordBotStop(db: Db, telegramUserId: number): Promise<void> {
  await db
    .update(users)
    .set({ botStartedAt: null })
    .where(eq(users.telegramUserId, telegramUserId));
}
