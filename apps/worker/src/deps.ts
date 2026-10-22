import type { DecimalString } from "@cadence/core";
import type { AccountConnectionRow, Db } from "@cadence/db";
import type { StrikeClient } from "@cadence/strike";

export type WorkerDeps = {
  db: Db;
  strikeFor: (connection: AccountConnectionRow) => StrikeClient;
  now: () => number;
  liveMaxNotional: DecimalString;
};

export const workerActor = "worker";
