import type { DecisionOutcome, Environment, IntentState } from "@cadence/core";

export const outcomeLabel: Record<DecisionOutcome, string> = {
  READY: "Ready",
  RESIZED: "Smaller size",
  BLOCKED: "Cannot execute",
};

export const venueName: Record<Environment, string> = {
  live: "Strike",
  replay: "the replay exchange",
};

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const labels: Record<IntentState, (venue: string) => string> = {
  prepared: () => "Preparing",
  blocked: () => "Declined at the final check",
  reserved: () => "Reserved",
  submitted: (venue) => `Sent to ${venue}`,
  unknown: (venue) => `Confirming with ${venue}`,
  rejected: (venue) => `Rejected by ${venue}`,
  unfilled: () => "Not filled",
  canceled: () => "Entry canceled",
  expired: () => "Entry window closed",
  open_verifying: () => "Filled, checking exits",
  open_verified: () => "Exits verified",
  recovery_required: () => "Recovery required",
  closed: () => "Closed",
};

const details: Record<IntentState, (venue: string) => string> = {
  prepared: () => "Cadence is preparing your order.",
  blocked: () => "Conditions changed before the order left, so nothing was sent.",
  reserved: (venue) => `Your risk is reserved and the order is queued for ${venue}.`,
  submitted: (venue) => `${capitalised(venue)} acknowledged the order. Waiting for the fill.`,
  unknown: (venue) =>
    `${capitalised(venue)}’s answer did not arrive. Cadence is asking ${venue} what happened before doing anything else.`,
  rejected: (venue) => `${capitalised(venue)} refused the order. Nothing was placed.`,
  unfilled: () => "The entry could not fill in full at the plan’s price, so it was cancelled.",
  canceled: () => "The unfilled entry was cancelled.",
  expired: () => "The entry window closed before the order was sent.",
  open_verifying: (venue) =>
    `The entry filled. Cadence is confirming the stop and target on ${venue}.`,
  open_verified: (venue) => `Your stop and target are confirmed on ${venue} for the filled size.`,
  recovery_required: () =>
    "The exits could not be confirmed. Cadence is closing the position with a reduce-only order.",
  closed: (venue) => `The position is closed and reconciled with ${venue}.`,
};

export const intentStateLabel = (state: IntentState, environment: Environment) =>
  labels[state](venueName[environment]);

export const intentStateDetail = (state: IntentState, environment: Environment) =>
  details[state](venueName[environment]);
