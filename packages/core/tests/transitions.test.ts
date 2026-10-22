import { describe, expect, it } from "vitest";
import { intentEvents, intentStates, type IntentEvent, type IntentState } from "../src/contract";
import {
  nextIntentState,
  reservationHoldingStates,
  terminalIntentStates,
} from "../src/transitions";

const allowed: Partial<Record<IntentState, Partial<Record<IntentEvent, IntentState>>>> = {
  prepared: { validation_failed: "blocked", approved: "reserved" },
  reserved: {
    submit_attempted: "submitted",
    validation_failed: "blocked",
    entry_window_closed: "expired",
  },
  submitted: {
    acknowledged: "submitted",
    submit_timed_out: "unknown",
    exchange_rejected: "rejected",
    entry_unfilled: "unfilled",
    entry_canceled: "canceled",
    fill_observed: "open_verifying",
  },
  unknown: {
    acknowledged: "submitted",
    exchange_rejected: "rejected",
    entry_unfilled: "unfilled",
    fill_observed: "open_verifying",
  },
  open_verifying: {
    exits_verified: "open_verified",
    exits_missing: "recovery_required",
    close_reconciled: "closed",
  },
  open_verified: { close_reconciled: "closed", exits_missing: "recovery_required" },
  recovery_required: { exits_verified: "open_verified", recovery_confirmed: "closed" },
};

const matrix = intentStates.flatMap((state) =>
  intentEvents.map((event) => [state, event, allowed[state]?.[event] ?? null] as const),
);

const exchangeEvidence: readonly IntentEvent[] = [
  "acknowledged",
  "exchange_rejected",
  "entry_unfilled",
  "entry_canceled",
  "fill_observed",
  "exits_verified",
  "exits_missing",
  "recovery_confirmed",
  "close_reconciled",
];

function reachableWithout(evidence: readonly IntentEvent[], from: IntentState) {
  const silentEvents = intentEvents.filter((event) => !evidence.includes(event));
  const seen = new Set<IntentState>([from]);
  const queue = [from];
  for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
    for (const event of silentEvents) {
      const next = nextIntentState(state, event);
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe("nextIntentState", () => {
  it("covers every state and event pair", () => {
    expect(matrix).toHaveLength(intentStates.length * intentEvents.length);
  });

  it.each(matrix)("%s on %s goes to %s", (state, event, next) => {
    expect(nextIntentState(state, event)).toBe(next);
  });
});

describe("terminal and holding states", () => {
  it("names the six terminal states", () => {
    expect([...terminalIntentStates].sort()).toEqual(
      ["blocked", "canceled", "closed", "expired", "rejected", "unfilled"].sort(),
    );
  });

  it.each(terminalIntentStates)("accepts nothing once %s", (state) => {
    for (const event of intentEvents) {
      expect(nextIntentState(state, event)).toBeNull();
    }
  });

  it("holds the reservation in every live state after approval", () => {
    expect([...reservationHoldingStates].sort()).toEqual(
      intentStates
        .filter((state) => state !== "prepared" && !terminalIntentStates.includes(state))
        .sort(),
    );
  });

  it("puts every state in exactly one of prepared, holding or terminal", () => {
    for (const state of intentStates) {
      const groups = [
        state === "prepared",
        reservationHoldingStates.includes(state),
        terminalIntentStates.includes(state),
      ];
      expect(groups.filter(Boolean)).toHaveLength(1);
    }
  });
});

describe("silence never becomes an outcome", () => {
  it("lets an unknown submission reach rejected or unfilled only through those exchange events", () => {
    for (const event of intentEvents) {
      const next = nextIntentState("unknown", event);
      if (next === "rejected") {
        expect(event).toBe("exchange_rejected");
      }
      if (next === "unfilled") {
        expect(event).toBe("entry_unfilled");
      }
    }
  });

  it.each(["submitted", "unknown"] as const)(
    "never leaves %s for a terminal state without exchange evidence",
    (from) => {
      const reachable = reachableWithout(exchangeEvidence, from);
      expect([...reachable].filter((state) => terminalIntentStates.includes(state))).toEqual([]);
      expect([...reachable].every((state) => state === "submitted" || state === "unknown")).toBe(
        true,
      );
    },
  );

  it.each([
    "submitted",
    "unknown",
    "open_verifying",
    "open_verified",
    "recovery_required",
  ] as const)("never drops %s for a failed re-validation or a closed entry window", (state) => {
    expect(nextIntentState(state, "validation_failed")).toBeNull();
    expect(nextIntentState(state, "entry_window_closed")).toBeNull();
  });

  it("treats a second timeout as no transition, so the intent stays unknown", () => {
    expect(nextIntentState("submitted", "submit_timed_out")).toBe("unknown");
    expect(nextIntentState("unknown", "submit_timed_out")).toBeNull();
  });
});
