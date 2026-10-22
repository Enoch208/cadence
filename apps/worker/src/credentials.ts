import { eq } from "drizzle-orm";
import { accountConnections, executionIntents } from "@cadence/db";
import { StrikeReadError, StrikeRejectedError } from "@cadence/strike";
import type { WorkerDeps } from "./deps";
import { disconnectConnection } from "./ledger";

const refusedKeyStatuses: ReadonlySet<number> = new Set([401, 403]);

export function isCredentialFailure(
  error: unknown,
): error is StrikeRejectedError | StrikeReadError {
  return (
    (error instanceof StrikeRejectedError || error instanceof StrikeReadError) &&
    error.status !== null &&
    refusedKeyStatuses.has(error.status)
  );
}

export const credentialCause = (error: StrikeRejectedError | StrikeReadError) =>
  `Strike refused this account's API key (HTTP ${String(error.status)}); it may have expired or been revoked`;

export async function disconnectForRefusedKey(
  deps: WorkerDeps,
  intentId: string,
  error: StrikeRejectedError | StrikeReadError,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ connectionId: accountConnections.id, environment: accountConnections.environment })
      .from(executionIntents)
      .innerJoin(
        accountConnections,
        eq(accountConnections.id, executionIntents.accountConnectionId),
      )
      .where(eq(executionIntents.id, intentId));
    if (row === undefined) {
      return;
    }
    await disconnectConnection(tx, {
      connectionId: row.connectionId,
      intentId,
      environment: row.environment,
      at: deps.now(),
      cause: credentialCause(error),
    });
  });
}
