import { describe, expect, it } from "vitest";
import { createReplayStrikeClient } from "../src/replay-client";
import { replayScenarios } from "../src/replay-scenarios";
import { readDecisionSnapshot } from "../src/snapshot";
import { StrikeReadError } from "../src/errors";

const now = () => 1_792_600_000_000;

describe("readDecisionSnapshot", () => {
  it("reads everything a decision needs for one market in one pass", async () => {
    const client = createReplayStrikeClient(replayScenarios.happy_path, now);
    const snapshot = await readDecisionSnapshot(client, "BTC-USD");
    expect(snapshot.market.symbol).toBe("BTC-USD");
    expect(snapshot.book.symbol).toBe("BTC-USD");
    expect(snapshot.mark.symbol).toBe("BTC-USD");
    expect(snapshot.accountState.account.environment).toBe("replay");
    expect(snapshot.fees.takerRate).toMatch(/^\d/);
  });

  it("names a market Strike does not list instead of deciding against nothing", async () => {
    const client = createReplayStrikeClient(replayScenarios.happy_path, now);
    await expect(readDecisionSnapshot(client, "NOPE-USD")).rejects.toBeInstanceOf(StrikeReadError);
  });
});
