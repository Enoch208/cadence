import { eq } from "drizzle-orm";
import { clientOrderIdFor, type Proposal, type Receipt } from "@cadence/core";
import { accountConnections, replayClientForConnection } from "@cadence/db";
import type { ReplayStrikeClient, StrategyAck } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/deps";
import { leaseMs } from "../src/outbox";
import { runPass } from "../src/pass";
import { submitIntent } from "../src/submit";
import {
  cadenceApi,
  call,
  previewFor,
  publishReplayPlan,
  replayMember,
  type CadenceApi,
} from "./support/api";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testClock, type TestClock } from "./support/fixtures";
import { reservationStatus } from "./support/read";
import { workerDeps } from "./support/strike";
import { until } from "./support/wait";

resetDatabaseBetweenTests();

type IntentView = {
  state: string;
  environment: string;
  approved: Proposal;
  orders: {
    role: string;
    clientOrderId: string;
    exchangeOrderId: string | null;
    lastStatus: string | null;
  }[];
  events: { at: number; type: string }[];
};

const worker = (
  clock: TestClock,
  wrap: (exchange: ReplayStrikeClient) => ReplayStrikeClient = (exchange) => exchange,
): WorkerDeps =>
  workerDeps(clock, (connection) => wrap(replayClientForConnection(connection, clock.now)));

async function exchangeOf(accountId: string, clock: TestClock) {
  const [connection] = await db
    .select()
    .from(accountConnections)
    .where(eq(accountConnections.id, accountId));
  if (connection === undefined) {
    throw new Error("The replay account was not stored");
  }
  return replayClientForConnection(connection, clock.now);
}

async function approvedPlan(scenario: string) {
  const clock = testClock();
  const app = cadenceApi(clock);
  const planPublicId = await publishReplayPlan(app, clock);
  const member = await replayMember(app, clock, scenario);
  const preview = await previewFor(app, member, planPublicId);
  const approve = () =>
    call(app, "POST", "/api/intents", {
      cookie: member.cookie,
      body: { previewId: preview.previewId },
    });
  const approval = await approve();
  const intentId = (approval.body as { id?: string } | null)?.id ?? "";
  const exchange = await exchangeOf(member.accountId, clock);
  const view = async () =>
    (await call(app, "GET", `/api/intents/${intentId}`, { cookie: member.cookie }))
      .body as IntentView;
  const receipt = (on: CadenceApi = app) =>
    call(on, "GET", `/api/receipts/${intentId}`, { cookie: member.cookie });
  return { clock, app, preview, approve, approval, intentId, exchange, view, receipt };
}

const typesOf = (view: IntentView) => view.events.map(({ type }) => type);

describe("a replay plan from approval to receipt", () => {
  it("places a bounded entry, verifies both exits, reconciles the close and builds the receipt", async () => {
    const { clock, approval, intentId, exchange, view, receipt } = await approvedPlan("happy_path");
    expect(approval.status).toBe(201);
    const deps = worker(clock);

    await runPass(deps);

    const open = await view();
    expect(open.state).toBe("open_verified");
    expect(open.environment).toBe("replay");
    expect(open.orders.map((order) => [order.role, order.lastStatus])).toEqual([
      ["entry", "filled"],
      ["stop", "untriggered"],
      ["target", "untriggered"],
    ]);
    expect(open.orders.every((order) => order.exchangeOrderId !== null)).toBe(true);
    expect(typesOf(open)).toEqual([
      "intent_reserved",
      "submit_attempted",
      "acknowledged",
      "fill_observed",
      "exits_verified",
    ]);
    expect((await receipt()).body).toMatchObject({ code: "RECEIPT_NOT_READY" });

    clock.advance(3_600_000);
    await exchange.closeReduceOnly({
      clientOrderId: clientOrderIdFor(intentId, "target"),
      symbol: "BTC-USD",
      side: "sell",
      size: open.approved.quantity,
    });
    await runPass(deps);

    expect((await view()).state).toBe("closed");
    const { receipt: body } = (await receipt()).body as { receipt: Receipt };
    expect(body).toMatchObject({
      state: "closed",
      approved: open.approved,
      entry: { size: open.approved.quantity, averagePrice: "84050" },
      exit: { size: open.approved.quantity, averagePrice: "84040" },
      incomplete: [],
    });
    expect(body.realizedPnl).not.toBeNull();
    expect(body.exchangeOrderIds).toContain(open.orders[0]?.exchangeOrderId);
    expect(await reservationStatus(intentId)).toBe("released");
    expect(exchange.submittedStrategies()).toHaveLength(1);
  });

  it("declines a late entry in the preview, so nothing can be approved or sent", async () => {
    const { clock, preview, approval, exchange } = await approvedPlan("late_entry");
    expect(preview.decision).toMatchObject({
      outcome: "BLOCKED",
      reasons: ["OUTSIDE_ENTRY_RANGE"],
    });
    expect(approval).toMatchObject({ status: 409, body: { code: "PREVIEW_BLOCKED" } });

    await expect(runPass(worker(clock))).resolves.toMatchObject({ processed: 0 });
    expect(exchange.submittedStrategies()).toEqual([]);
  });

  it("declines stale market data in the preview", async () => {
    const { clock, preview, approval, exchange } = await approvedPlan("stale_data");
    expect(preview.decision).toMatchObject({ outcome: "BLOCKED", reasons: ["STALE_DATA"] });
    expect(approval.status).toBe(409);

    await runPass(worker(clock));
    expect(exchange.submittedStrategies()).toEqual([]);
  });

  it("turns duplicate approvals into one intent and one order", async () => {
    const { clock, approve, intentId, exchange, view } = await approvedPlan("happy_path");
    const again = await Promise.all([approve(), approve()]);
    expect(again.map((reply) => [reply.status, reply.body])).toEqual([
      [200, { id: intentId }],
      [200, { id: intentId }],
    ]);
    const deps = worker(clock);

    await runPass(deps);
    await runPass(deps);

    expect(exchange.submittedStrategies()).toHaveLength(1);
    expect((await view()).orders).toHaveLength(3);
  });
});

describe("failures that must never become a second exposure", () => {
  it("reconciles a lost response by client ID and sends the order exactly once", async () => {
    const { clock, intentId, exchange, view } = await approvedPlan("ambiguous_response");
    const deps = worker(clock);

    await expect(submitIntent(deps, intentId)).resolves.toBe("unknown");
    expect((await view()).state).toBe("unknown");
    await runPass(deps);

    const resolved = await view();
    expect(typesOf(resolved)).toEqual([
      "intent_reserved",
      "submit_attempted",
      "submit_timed_out",
      "acknowledged",
      "fill_observed",
      "exits_verified",
    ]);
    expect(resolved.state).toBe("open_verified");
    expect(exchange.submittedStrategies()).toHaveLength(1);
  });

  it("recovers missing exits with a reduce-only close and closes the intent", async () => {
    const { clock, intentId, exchange, view, receipt } = await approvedPlan("exits_missing");
    const deps = worker(clock);

    await runPass(deps);
    expect((await view()).state).toBe("open_verifying");
    clock.advance(10_000);
    await runPass(deps);
    expect((await view()).state).toBe("recovery_required");
    await runPass(deps);

    const closed = await view();
    expect(closed.state).toBe("closed");
    expect(typesOf(closed).slice(-4)).toEqual([
      "exits_missing",
      "recovery_close_attempted",
      "recovery_close_acknowledged",
      "recovery_confirmed",
    ]);
    expect(closed.orders.map((order) => order.role)).toEqual([
      "entry",
      "stop",
      "target",
      "recovery_close",
    ]);
    expect(
      await exchange.order("BTC-USD", clientOrderIdFor(intentId, "recovery_close")),
    ).toMatchObject({ reduceOnly: true, status: "filled" });
    expect((await receipt()).body).toMatchObject({ receipt: { state: "closed", incomplete: [] } });
    expect(exchange.submittedStrategies()).toHaveLength(1);
  });

  it("survives a worker killed after the order left: a fresh worker reconciles it and sends nothing", async () => {
    const { clock, exchange, view } = await approvedPlan("happy_path");
    let reachedStrike: () => void = () => undefined;
    const sent = new Promise<void>((resolve) => {
      reachedStrike = resolve;
    });
    const dying = (inner: ReplayStrikeClient): ReplayStrikeClient => ({
      ...inner,
      placeStrategy: async (order) => {
        await inner.placeStrategy(order);
        reachedStrike();
        return new Promise<StrategyAck>(() => undefined);
      },
    });

    void runPass(worker(clock, dying));
    await sent;
    const killed = await view();
    expect(killed.state).toBe("submitted");
    expect(killed.orders.map((order) => order.role)).toEqual(["entry", "stop", "target"]);

    clock.advance(leaseMs + 1);
    await runPass(worker(clock));

    expect((await view()).state).toBe("open_verified");
    expect(exchange.submittedStrategies()).toHaveLength(1);
  });

  it("survives a worker killed before the order left: a fresh worker rejects it on evidence and sends nothing", async () => {
    const { clock, intentId, exchange, view } = await approvedPlan("happy_path");
    const neverSends = (inner: ReplayStrikeClient): ReplayStrikeClient => ({
      ...inner,
      placeStrategy: () => new Promise<StrategyAck>(() => undefined),
    });

    void runPass(worker(clock, neverSends));
    await until(async () => (await view()).state === "submitted");

    clock.advance(leaseMs + 1);
    await runPass(worker(clock));

    const ended = await view();
    expect(ended.state).toBe("rejected");
    expect(typesOf(ended).filter((type) => type === "submit_attempted")).toHaveLength(1);
    expect(typesOf(ended).at(-1)).toBe("exchange_rejected");
    expect(exchange.submittedStrategies()).toEqual([]);
    expect(await reservationStatus(intentId)).toBe("released");
  });
});
