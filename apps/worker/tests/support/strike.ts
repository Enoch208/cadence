import { decide, type BuilderApproval, type Decision, type PublishedPlan } from "@cadence/core";
import { replayClientForConnection, type AccountConnectionRow } from "@cadence/db";
import {
  readDecisionSnapshot,
  StrikeRejectedError,
  type ReplayStrikeClient,
  type StrikeClient,
} from "@cadence/strike";
import type { WorkerDeps } from "../../src/deps";
import { db } from "./database";
import { testPolicy, type TestClock } from "./fixtures";

export const replayOf = (connection: AccountConnectionRow, clock: TestClock): ReplayStrikeClient =>
  replayClientForConnection(connection, clock.now);

export function asLive(replay: ReplayStrikeClient): ReplayStrikeClient {
  return {
    ...replay,
    environment: "live",
    accountState: async (symbol) => {
      const state = await replay.accountState(symbol);
      return { ...state, account: { ...state.account, environment: "live" } };
    },
  };
}

export function rejectingStrategies(client: ReplayStrikeClient): ReplayStrikeClient {
  return {
    ...client,
    placeStrategy: () =>
      Promise.reject(
        new StrikeRejectedError({
          operation: "placeStrategy",
          status: 400,
          code: "insufficient_margin",
          message: "not enough margin",
        }),
      ),
  };
}

export async function previewOn(
  client: StrikeClient,
  plan: PublishedPlan,
  now: number,
  builderApproval: BuilderApproval | null = null,
): Promise<Decision> {
  const snapshot = await readDecisionSnapshot(client, plan.market);
  return decide({
    plan,
    admission: { status: "published", isCurrentVersion: true },
    policy: testPolicy,
    quantityCeiling: null,
    ...snapshot,
    accountReconciled: true,
    builderApproval,
    exposure: {
      busySymbols: [],
      knownClientOrderIds: [],
      committedRisk: "0",
      realizedSessionLoss: "0",
    },
    now,
  });
}

export function workerDeps(
  clock: TestClock,
  clientFor: (connection: AccountConnectionRow) => StrikeClient,
  liveMaxNotional = "25",
): WorkerDeps {
  return { db, now: clock.now, strikeFor: clientFor, liveMaxNotional };
}
