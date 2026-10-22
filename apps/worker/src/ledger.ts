import { and, eq } from "drizzle-orm";
import { reservations, type Tx } from "@cadence/db";

export async function releaseReservation(tx: Tx, intentId: string, at: number): Promise<void> {
  await tx
    .update(reservations)
    .set({ status: "released", releasedAt: at })
    .where(and(eq(reservations.intentId, intentId), eq(reservations.status, "active")));
}
