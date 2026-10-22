import { and, eq, isNotNull } from "drizzle-orm";
import type { IntentEvent, IntentState } from "@cadence/core";
import { executionIntents, notifications, users, type Tx } from "@cadence/db";

const announcedOutcomes: readonly IntentState[] = [
  "open_verifying",
  "open_verified",
  "recovery_required",
  "closed",
  "unfilled",
  "rejected",
  "canceled",
  "expired",
];

export const worthAnnouncing = (event: IntentEvent, next: IntentState): boolean =>
  event === "acknowledged" || announcedOutcomes.includes(next);

export async function queueNotification(
  tx: Tx,
  intentId: string,
  state: IntentState,
  at: number,
): Promise<void> {
  const [recipient] = await tx
    .select({ userId: users.id })
    .from(executionIntents)
    .innerJoin(users, eq(users.id, executionIntents.userId))
    .where(and(eq(executionIntents.id, intentId), isNotNull(users.botStartedAt)));
  if (recipient === undefined) {
    return;
  }
  await tx
    .insert(notifications)
    .values({ intentId, userId: recipient.userId, state, nextAttemptAt: at, createdAt: at })
    .onConflictDoNothing({ target: [notifications.intentId, notifications.state] });
}
