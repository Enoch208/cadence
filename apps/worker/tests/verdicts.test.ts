import type { ExchangeFill, ExchangeOrderSnapshot } from "@cadence/core";
import type { ExchangeOrderRow } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { entryVerdict } from "../src/entry-verdict";
import { heldPosition, summarizeExits, type LegExpectation } from "../src/exits";
import { attributeFills, fillFacts } from "../src/fills";
import { openVerdict, type OpenEvidence } from "../src/open-verdict";

const order = (change: Partial<ExchangeOrderSnapshot> = {}): ExchangeOrderSnapshot => ({
  orderId: "1000001",
  clientOrderId: "cad-i-e",
  symbol: "BTC-USD",
  side: "buy",
  type: "limit",
  status: "filled",
  size: "0.012",
  filled: "0.012",
  price: "84218",
  stopPrice: null,
  reduceOnly: false,
  strategyId: "cad-i",
  isStrategyPrimary: true,
  closeReason: null,
  ...change,
});

const stop: LegExpectation = {
  clientOrderId: "cad-i-s",
  strategyId: "cad-i",
  side: "sell",
  triggerPrice: "83200",
};
const target: LegExpectation = { ...stop, clientOrderId: "cad-i-t", triggerPrice: "86800" };

const leg = (expected: LegExpectation, change: Partial<ExchangeOrderSnapshot> = {}) =>
  order({
    clientOrderId: expected.clientOrderId,
    side: "sell",
    type: "stop",
    status: "untriggered",
    filled: "0",
    price: null,
    stopPrice: expected.triggerPrice,
    reduceOnly: true,
    isStrategyPrimary: false,
    ...change,
  });

const events = (steps: readonly { event: string }[]) => steps.map(({ event }) => event);

describe("judging the entry from exchange evidence", () => {
  const base = { state: "submitted" as const, sinceSubmitMs: 0, traced: false };

  it.each([
    ["submitted", order(), ["fill_observed"]],
    ["unknown", order(), ["acknowledged", "fill_observed"]],
    ["submitted", order({ status: "expired", filled: "0" }), ["entry_unfilled"]],
    ["unknown", order({ status: "expired", filled: "0" }), ["acknowledged", "entry_unfilled"]],
    ["submitted", order({ status: "canceled", filled: "0" }), ["entry_canceled"]],
    ["submitted", order({ status: "rejected", filled: "0" }), ["exchange_rejected"]],
    ["submitted", order({ status: "canceled", filled: "0.004" }), ["fill_observed"]],
    ["submitted", order({ status: "pending", filled: "0" }), []],
    ["unknown", order({ status: "open", filled: "0" }), ["acknowledged"]],
  ] as const)("%s with the entry %o takes %o", (state, entry, expected) => {
    expect(events(entryVerdict({ ...base, state, entry }).steps)).toEqual(expected);
  });

  it("waits while the entry has not appeared within the grace period", () => {
    expect(entryVerdict({ ...base, entry: null, sinceSubmitMs: 9_999 })).toEqual({
      steps: [],
      pause: false,
    });
  });

  it("keeps waiting until 30 s pass with no order, position or fill, then rejects on that evidence", () => {
    expect(entryVerdict({ ...base, entry: null, sinceSubmitMs: 29_999 }).steps).toEqual([]);
    const verdict = entryVerdict({ ...base, entry: null, sinceSubmitMs: 30_000 });
    expect(verdict.steps).toEqual([
      { event: "exchange_rejected", data: { evidence: "no order, position or fill" } },
    ]);
    expect(
      entryVerdict({ ...base, state: "unknown", entry: null, sinceSubmitMs: 60_000 }).steps,
    ).toHaveLength(1);
  });

  it("never rejects when anything on the account could be the order, and pauses new entries", () => {
    const submitted = entryVerdict({ ...base, entry: null, sinceSubmitMs: 120_000, traced: true });
    expect(events(submitted.steps)).toEqual(["submit_timed_out"]);
    expect(submitted.pause).toBe(true);
    const unknown = entryVerdict({
      ...base,
      state: "unknown",
      entry: null,
      sinceSubmitMs: 120_000,
      traced: true,
    });
    expect(unknown).toMatchObject({ steps: [], pause: true });
  });
});

describe("checking the exits against the actual position", () => {
  it("arms only when both legs carry the strategy, the plan's prices and enough size", () => {
    const armed = (legs: (ExchangeOrderSnapshot | null)[], size = "0.012") =>
      summarizeExits(
        [
          { leg: legs[0] ?? null, expected: stop },
          { leg: legs[1] ?? null, expected: target },
        ],
        size,
      ).armed;
    expect(armed([leg(stop), leg(target)])).toBe(true);
    expect(armed([leg(stop), leg(target)], "0.013")).toBe(false);
    expect(armed([leg(stop), null])).toBe(false);
    expect(armed([leg(stop, { status: "pending" }), leg(target)])).toBe(false);
    expect(armed([leg(stop, { strategyId: "cad-other" }), leg(target)])).toBe(false);
    expect(armed([leg(stop, { stopPrice: "83100" }), leg(target)])).toBe(false);
    expect(armed([leg(stop, { reduceOnly: false }), leg(target)])).toBe(false);
    expect(armed([leg(stop, { side: "buy" }), leg(target)])).toBe(false);
    expect(armed([leg(stop, { stopPrice: "83200.0" }), leg(target)])).toBe(true);
  });

  it("tells an exit in progress from a missing one", () => {
    const summary = summarizeExits(
      [
        { leg: leg(stop, { status: "expired" }), expected: stop },
        { leg: leg(target, { status: "filled", filled: "0.012" }), expected: target },
      ],
      "0.012",
    );
    expect(summary).toEqual({ armed: false, live: false, exiting: true });
  });

  it("reads the position along the plan's direction and flags one held the other way", () => {
    expect(heldPosition("0.012", true)).toEqual({ size: "0.012", opposite: false });
    expect(heldPosition("-0.012", true)).toEqual({ size: "0", opposite: true });
    expect(heldPosition("-0.012", false)).toEqual({ size: "0.012", opposite: false });
    expect(heldPosition("0", true)).toEqual({ size: "0", opposite: false });
  });
});

describe("judging an open position", () => {
  const armed = { armed: true, live: true, exiting: false };
  const missing = { armed: false, live: false, exiting: false };
  const base: OpenEvidence = {
    state: "open_verifying",
    positionSize: "0.012",
    oppositePosition: false,
    exits: armed,
    flatByFills: false,
    sinceFillMs: 0,
  };

  it("verifies armed exits once, then holds", () => {
    expect(events(openVerdict(base).steps)).toEqual(["exits_verified"]);
    expect(events(openVerdict({ ...base, state: "open_verified" }).steps)).toEqual([]);
    expect(events(openVerdict({ ...base, state: "recovery_required" }).steps)).toEqual([
      "exits_verified",
    ]);
  });

  it("gives the exits 10 s after the fill to appear, then starts recovery", () => {
    expect(openVerdict({ ...base, exits: missing, sinceFillMs: 9_999 })).toMatchObject({
      steps: [],
      recover: false,
    });
    const late = openVerdict({ ...base, exits: missing, sinceFillMs: 10_000 });
    expect(events(late.steps)).toEqual(["exits_missing"]);
    expect(late.recover).toBe(true);
    expect(openVerdict({ ...base, state: "open_verified", exits: missing }).recover).toBe(true);
  });

  it("lets an exit that already triggered finish instead of recovering over it", () => {
    const exiting = { armed: false, live: false, exiting: true };
    expect(openVerdict({ ...base, state: "open_verified", exits: exiting })).toMatchObject({
      steps: [],
      recover: false,
    });
  });

  it("closes only when the position is zero, no exit is live and the fills net to zero", () => {
    const flat = { ...base, state: "open_verified" as const, positionSize: "0" };
    expect(openVerdict({ ...flat, exits: missing, flatByFills: false }).steps).toEqual([]);
    expect(openVerdict({ ...flat, exits: armed, flatByFills: true }).steps).toEqual([]);
    expect(events(openVerdict({ ...flat, exits: missing, flatByFills: true }).steps)).toEqual([
      "close_reconciled",
    ]);
    const recovered = { ...flat, state: "recovery_required" as const };
    expect(events(openVerdict({ ...recovered, exits: missing, flatByFills: true }).steps)).toEqual([
      "recovery_confirmed",
    ]);
  });

  it("touches nothing and pauses new entries when the position runs the other way", () => {
    expect(openVerdict({ ...base, oppositePosition: true, exits: missing })).toEqual({
      steps: [],
      recover: false,
      pause: true,
    });
  });
});

describe("attributing fills", () => {
  const row = (
    role: ExchangeOrderRow["role"],
    clientOrderId: string,
    exchangeOrderId: string | null,
  ): ExchangeOrderRow => ({
    id: `row-${clientOrderId}`,
    intentId: "i",
    role,
    clientOrderId,
    exchangeOrderId,
    payload: {},
    payloadDigest: "0".repeat(64),
    lastStatus: null,
    filledSize: "0",
  });
  const fill = (change: Partial<ExchangeFill>): ExchangeFill => ({
    fillId: "f1",
    orderId: "1000001",
    clientOrderId: "cad-i-e",
    symbol: "BTC-USD",
    side: "buy",
    price: "84050",
    size: "0.012",
    fee: "0.5",
    filledAt: 100,
    ...change,
  });
  const rows = [row("entry", "cad-i-e", null), row("target", "cad-i-t", "1000003")];
  const claim = { openingSide: "buy" as const, submittedAt: 100_000, quantity: "0.012" };

  it("claims fills by client ID or exchange order ID and counts every fill toward flatness", () => {
    const observed = [
      fill({ fillId: "f0", clientOrderId: "someone-else", orderId: "9", filledAt: 50 }),
      fill({}),
      fill({ fillId: "f2", side: "sell", clientOrderId: "", orderId: "1000003", filledAt: 200 }),
    ];
    const ours = attributeFills(observed, rows, { ...claim, submittedAt: 90 });
    expect(ours.map(({ fill: f, row: r }) => [f.fillId, r.role])).toEqual([
      ["f1", "entry"],
      ["f2", "target"],
    ]);
    expect(fillFacts(observed, ours, "buy")).toEqual({ openSize: "0", flatByFills: true });
  });

  it("stays open while the fills leave size on the account, whoever placed them", () => {
    const observed = [
      fill({}),
      fill({
        fillId: "f3",
        side: "sell",
        size: "0.005",
        clientOrderId: "x",
        orderId: "8",
        filledAt: 300,
      }),
    ];
    expect(
      fillFacts(observed, attributeFills(observed, rows, { ...claim, submittedAt: 90 }), "buy"),
    ).toEqual({
      openSize: "0.012",
      flatByFills: false,
    });
  });

  const orphan = (change: Partial<ExchangeFill> = {}) =>
    fill({
      fillId: "o1",
      clientOrderId: null,
      orderId: "11516191287",
      filledAt: 101_000,
      ...change,
    });
  const roles = (observed: ExchangeFill[], withRows = rows) =>
    attributeFills(observed, withRows, claim).map(({ fill: f, row: r }) => [f.fillId, r.role]);

  it("claims as the entry a fill whose order Strike no longer serves, when it can only be ours", () => {
    expect(roles([orphan()])).toEqual([["o1", "entry"]]);
    expect(
      roles([
        orphan({ size: "0.007" }),
        orphan({ fillId: "o2", size: "0.005", filledAt: 101_500 }),
      ]),
    ).toEqual([
      ["o1", "entry"],
      ["o2", "entry"],
    ]);
    expect(roles([orphan({ filledAt: 100_000 - 4_000 })])).toEqual([["o1", "entry"]]);
  });

  it.each([
    ["on the closing side", { side: "sell" as const }],
    ["from before the order was sent", { filledAt: 100_000 - 6_000 }],
    ["larger than the approved quantity", { size: "0.013" }],
  ])("never claims an orphan fill %s", (_, change) => {
    expect(roles([orphan(change)])).toEqual([]);
  });

  it("never claims orphans from two different orders, or once the entry is already known", () => {
    expect(
      roles([orphan({ size: "0.006" }), orphan({ fillId: "o2", orderId: "777", size: "0.006" })]),
    ).toEqual([]);
    expect(roles([fill({}), orphan({ fillId: "o2", size: "0.001" })])).toEqual([["f1", "entry"]]);
    const known = [row("entry", "cad-i-e", "555"), row("target", "cad-i-t", "1000003")];
    expect(roles([orphan()], known)).toEqual([]);
    expect(roles([orphan({ orderId: "555" })], known)).toEqual([["o1", "entry"]]);
  });

  it("gives a fill on a leg's order to that leg, never to the entry", () => {
    expect(roles([orphan({ orderId: "1000003", side: "buy" })])).toEqual([["o1", "target"]]);
  });
});
