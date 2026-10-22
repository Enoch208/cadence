import { loadExposure } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { correctedPlan, longPlan, testNow } from "./support/fixtures";
import {
  insertCommunity,
  insertIntent,
  insertMember,
  insertOrder,
  insertPlanVersion,
  insertPublishedPlan,
  insertReceipt,
  insertReservation,
  insertUser,
} from "./support/rows";

resetDatabaseBetweenTests();

const midnight = Date.parse("2026-10-22T00:00:00Z");

async function planVersions(count: number) {
  const curator = await insertUser(1001);
  const community = await insertCommunity(curator.id, -1001234567890n);
  const plan = await insertPublishedPlan(curator.id, community.id);
  const versions = [];
  for (let version = 1; version <= count; version += 1) {
    versions.push(
      await insertPlanVersion(plan.id, version, version % 2 === 0 ? correctedPlan : longPlan),
    );
  }
  return versions.map((row) => row.id);
}

describe("an account's Cadence exposure", () => {
  it("is empty for an account with no intents", async () => {
    const member = await insertMember(2002);
    expect(await loadExposure(db, member.connection.id, testNow)).toEqual({
      busySymbols: [],
      knownClientOrderIds: [],
      committedRisk: "0",
      realizedSessionLoss: "0",
    });
  });

  it("marks only the markets of open intents as busy and knows every order Cadence placed", async () => {
    const [first = "", second = "", third = ""] = await planVersions(3);
    const member = await insertMember(2002);
    const open = await insertIntent(member, first, "open_verified", "BTC-USD");
    const closed = await insertIntent(member, second, "closed", "ETH-USD");
    await insertIntent(member, third, "unfilled", "SOL-USD");
    await insertOrder(open.id, "entry");
    await insertOrder(closed.id, "entry");
    await insertOrder(closed.id, "stop");
    const exposure = await loadExposure(db, member.connection.id, testNow);
    expect(exposure.busySymbols).toEqual(["BTC-USD"]);
    expect(exposure.knownClientOrderIds).toEqual(
      [`cad-${open.id}-e`, `cad-${closed.id}-e`, `cad-${closed.id}-s`].sort(),
    );
  });

  it("sums only this account's active reservations as committed risk", async () => {
    const [first = "", second = "", third = ""] = await planVersions(3);
    const member = await insertMember(2002);
    const other = await insertMember(3003);
    await insertReservation(await insertIntent(member, first, "open_verified", "BTC-USD"), "19.99");
    await insertReservation(await insertIntent(member, second, "reserved", "ETH-USD"), "5.01");
    await insertReservation(await insertIntent(member, third, "closed", "SOL-USD"), "7", testNow);
    await insertReservation(await insertIntent(other, first, "reserved", "BTC-USD"), "11");
    const { committedRisk } = await loadExposure(db, member.connection.id, testNow);
    expect(Number(committedRisk)).toBe(25);
    expect(committedRisk).toMatch(/^25(\.0+)?$/);
  });

  it("counts the size of today's realized losses, never offset by gains or older losses", async () => {
    const versions = await planVersions(4);
    const member = await insertMember(2002);
    const markets = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
    const intents = [];
    for (const [index, version] of versions.entries()) {
      intents.push(await insertIntent(member, version, "closed", markets[index]));
    }
    const [lossToday, gainToday, lossYesterday, openReceipt] = intents;
    await insertReceipt(lossToday?.id ?? "", "-3.5", midnight + 60_000);
    await insertReceipt(gainToday?.id ?? "", "10.25", midnight + 120_000);
    await insertReceipt(lossYesterday?.id ?? "", "-2", midnight - 1);
    await insertReceipt(openReceipt?.id ?? "", null, midnight + 180_000);
    const { realizedSessionLoss } = await loadExposure(db, member.connection.id, testNow);
    expect(Number(realizedSessionLoss)).toBe(3.5);
  });
});
