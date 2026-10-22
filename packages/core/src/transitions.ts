import type { IntentEvent, IntentState } from "./contract";

type Transitions = Readonly<
  Record<IntentState, Readonly<Partial<Record<IntentEvent, IntentState>>>>
>;

const transitions: Transitions = {
  prepared: { validation_failed: "blocked", approved: "reserved" },
  blocked: {},
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
  rejected: {},
  unfilled: {},
  canceled: {},
  expired: {},
  open_verifying: {
    exits_verified: "open_verified",
    exits_missing: "recovery_required",
    close_reconciled: "closed",
  },
  open_verified: { close_reconciled: "closed", exits_missing: "recovery_required" },
  recovery_required: { exits_verified: "open_verified", recovery_confirmed: "closed" },
  closed: {},
};

export const nextIntentState = (state: IntentState, event: IntentEvent): IntentState | null =>
  transitions[state][event] ?? null;

export const terminalIntentStates: readonly IntentState[] = [
  "blocked",
  "rejected",
  "unfilled",
  "canceled",
  "expired",
  "closed",
];

export const reservationHoldingStates: readonly IntentState[] = [
  "reserved",
  "submitted",
  "unknown",
  "open_verifying",
  "open_verified",
  "recovery_required",
];
