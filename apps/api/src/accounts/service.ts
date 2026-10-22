import { and, asc, eq } from "drizzle-orm";
import {
  accountConnections,
  type AccountConnectionRow,
  type ConnectionStatus,
  type Executor,
} from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict, notFound } from "../http/errors";

export const accountView = (row: AccountConnectionRow) => ({
  id: row.id,
  environment: row.environment,
  strikeAccountId: row.strikeAccountId,
  credentialSource: row.credentialSource,
  status: row.status,
});

export const missingAccount = () => notFound("That account does not exist.");

export async function listAccounts(db: Executor, userId: string) {
  const rows = await db
    .select()
    .from(accountConnections)
    .where(eq(accountConnections.userId, userId))
    .orderBy(asc(accountConnections.createdAt), asc(accountConnections.id));
  return rows.map(accountView);
}

export async function ownedAccount(
  db: Executor,
  userId: string,
  accountId: string,
  lock = false,
): Promise<AccountConnectionRow> {
  const query = db
    .select()
    .from(accountConnections)
    .where(and(eq(accountConnections.id, accountId), eq(accountConnections.userId, userId)));
  const [row] = await (lock ? query.for("update") : query);
  if (row === undefined) {
    throw missingAccount();
  }
  return row;
}

export function setAccountStatus(
  deps: AppDeps,
  userId: string,
  accountId: string,
  status: Exclude<ConnectionStatus, "disconnected">,
) {
  return deps.db.transaction(async (tx) => {
    const row = await ownedAccount(tx, userId, accountId, true);
    if (row.status === "disconnected") {
      throw conflict(
        "ACCOUNT_DISCONNECTED",
        "This account is disconnected. Connect it again first.",
      );
    }
    if (row.status === status) {
      return accountView(row);
    }
    const [updated] = await tx
      .update(accountConnections)
      .set({ status })
      .where(eq(accountConnections.id, accountId))
      .returning();
    await recordEvent(tx, {
      at: deps.now(),
      actor: userActor(userId),
      correlationId: accountId,
      environment: row.environment,
      type: status === "paused" ? "account_paused" : "account_resumed",
      data: {},
    });
    return accountView(updated ?? row);
  });
}
