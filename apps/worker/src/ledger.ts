import { and, eq, inArray } from "drizzle-orm";
import type { Environment } from "@cadence/core";
import { accountConnections, reservations, type Tx } from "@cadence/db";
import { recordEvent } from "./events";

export async function releaseReservation(tx: Tx, intentId: string, at: number): Promise<void> {
  await tx
    .update(reservations)
    .set({ status: "released", releasedAt: at })
    .where(and(eq(reservations.intentId, intentId), eq(reservations.status, "active")));
}

export async function pauseConnection(
  tx: Tx,
  args: {
    connectionId: string;
    intentId: string;
    environment: Environment;
    at: number;
    cause: string;
  },
): Promise<void> {
  const paused = await tx
    .update(accountConnections)
    .set({ status: "paused" })
    .where(
      and(eq(accountConnections.id, args.connectionId), eq(accountConnections.status, "active")),
    )
    .returning({ id: accountConnections.id });
  if (paused.length > 0) {
    await recordEvent(tx, {
      at: args.at,
      correlationId: args.intentId,
      environment: args.environment,
      type: "connection_paused",
      data: { connectionId: args.connectionId, cause: args.cause },
    });
  }
}

export async function disconnectConnection(
  tx: Tx,
  args: {
    connectionId: string;
    intentId: string;
    environment: Environment;
    at: number;
    cause: string;
  },
): Promise<void> {
  const disconnected = await tx
    .update(accountConnections)
    .set({ status: "disconnected" })
    .where(
      and(
        eq(accountConnections.id, args.connectionId),
        inArray(accountConnections.status, ["active", "paused"]),
      ),
    )
    .returning({ id: accountConnections.id });
  if (disconnected.length > 0) {
    await recordEvent(tx, {
      at: args.at,
      correlationId: args.intentId,
      environment: args.environment,
      type: "connection_disconnected",
      data: { connectionId: args.connectionId, cause: args.cause },
    });
  }
}
