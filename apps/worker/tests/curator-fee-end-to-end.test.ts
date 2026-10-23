import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { clientOrderIdFor, type Proposal, type Receipt } from "@cadence/core";
import { accountConnections, replayClientForConnection } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { runPass } from "../src/pass";
import { cadenceApi, call, previewFor, publishReplayPlan, replayMember } from "./support/api";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testClock } from "./support/fixtures";
import { workerDeps } from "./support/strike";

resetDatabaseBetweenTests();

const curatorFee = { builderCode: "range_traders", feeBps: 5 };

describe("a replay plan with a curator fee, from preview to receipt", () => {
  it("prices, binds, sends, charges and receipts the fee for a member under the curator's code", async () => {
    const clock = testClock();
    const app = cadenceApi(clock);
    const planPublicId = await publishReplayPlan(app, clock, {
      targetPrice: "88000",
      curatorFee,
    });
    const member = await replayMember(app, clock, "happy_path", { planPublicId });

    const preview = await previewFor(app, member, planPublicId);
    expect(preview.decision.outcome).toBe("READY");
    const priced = preview.decision.outcome === "BLOCKED" ? null : preview.decision.proposal;
    expect(priced?.curatorFee).toEqual(curatorFee);
    expect(new Decimal(priced?.costs.curatorFee ?? "0").greaterThan(0)).toBe(true);

    const approval = await call(app, "POST", "/api/intents", {
      cookie: member.cookie,
      body: { previewId: preview.previewId },
    });
    const intentId = (approval.body as { id: string }).id;
    const [connection] = await db
      .select()
      .from(accountConnections)
      .where(eq(accountConnections.id, member.accountId));
    if (connection === undefined) {
      throw new Error("The replay account was not stored");
    }
    const exchange = replayClientForConnection(connection, clock.now);
    const deps = workerDeps(clock, (row) => replayClientForConnection(row, clock.now));

    await runPass(deps);
    expect(exchange.submittedStrategies().map((order) => order.builderFeeBps)).toEqual([5]);

    const view = await call(app, "GET", `/api/intents/${intentId}`, { cookie: member.cookie });
    const approved = (view.body as { approved: Proposal }).approved;
    clock.advance(3_600_000);
    await exchange.closeReduceOnly({
      clientOrderId: clientOrderIdFor(intentId, "target"),
      symbol: "BTC-USD",
      side: "sell",
      size: approved.quantity,
    });
    await runPass(deps);

    const reply = await call(app, "GET", `/api/receipts/${intentId}`, { cookie: member.cookie });
    const { receipt } = reply.body as { receipt: Receipt };
    expect(receipt.state).toBe("closed");
    expect(receipt.curatorFee).toEqual({
      ...curatorFee,
      computedCharge: exchange.builderFeesPaid(),
    });
    const curatorCharge = new Decimal(receipt.curatorFee?.computedCharge ?? "0");
    expect(curatorCharge.greaterThan(0)).toBe(true);
    const gross = new Decimal(receipt.exit?.averagePrice ?? "0")
      .minus(receipt.entry?.averagePrice ?? "0")
      .times(approved.quantity);
    const net = gross.minus(receipt.feesPaid).minus(curatorCharge);
    expect(receipt.realizedPnl).toBe(net.toFixed());
  });
});
