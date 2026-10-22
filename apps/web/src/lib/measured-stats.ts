export type MeasuredStats = {
  plansPublished: number;
  ordersPlaced: number;
  exitsVerified: number;
  lateEntriesDeclined: number;
  duplicateOrders: number;
};

const measuredKeys = [
  "plansPublished",
  "ordersPlaced",
  "exitsVerified",
  "lateEntriesDeclined",
  "duplicateOrders",
] as const satisfies readonly (keyof MeasuredStats)[];

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function readMeasuredStats(value: unknown): MeasuredStats | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const counts = measuredKeys.map((key) => record[key]);
  if (!counts.every(isCount)) {
    return null;
  }
  const [plansPublished, ordersPlaced, exitsVerified, lateEntriesDeclined, duplicateOrders] =
    counts;
  return {
    plansPublished: plansPublished ?? 0,
    ordersPlaced: ordersPlaced ?? 0,
    exitsVerified: exitsVerified ?? 0,
    lateEntriesDeclined: lateEntriesDeclined ?? 0,
    duplicateOrders: duplicateOrders ?? 0,
  };
}

export const notYetMeasured = "—";

export function displayCount(stats: MeasuredStats | null, key: keyof MeasuredStats): string {
  if (stats === null) {
    return notYetMeasured;
  }
  if (key === "duplicateOrders") {
    return stats.ordersPlaced > 0 ? String(stats.duplicateOrders) : notYetMeasured;
  }
  return stats[key] > 0 ? String(stats[key]) : notYetMeasured;
}

export async function loadMeasuredStats(signal: AbortSignal): Promise<MeasuredStats | null> {
  try {
    const response = await fetch("/api/stats", { headers: { Accept: "application/json" }, signal });
    return response.ok ? readMeasuredStats(await response.json()) : null;
  } catch {
    return null;
  }
}
