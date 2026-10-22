import type { DecisionOutcome, IntentState } from "@cadence/core";

export const outcomeLabel: Record<DecisionOutcome, string> = {
  READY: "Ready",
  RESIZED: "Smaller size",
  BLOCKED: "Cannot execute",
};

export const intentStateLabel: Record<IntentState, string> = {
  prepared: "Preparing",
  blocked: "Declined at the final check",
  reserved: "Reserved",
  submitted: "Sent to Strike",
  unknown: "Confirming with Strike",
  rejected: "Rejected by Strike",
  unfilled: "Not filled",
  canceled: "Entry canceled",
  expired: "Entry window closed",
  open_verifying: "Filled, checking exits",
  open_verified: "Exits verified",
  recovery_required: "Recovery required",
  closed: "Closed",
};

export const intentStateDetail: Record<IntentState, string> = {
  prepared: "Cadence is preparing your order.",
  blocked: "Conditions changed before the order left, so nothing was sent.",
  reserved: "Your risk is reserved and the order is queued for Strike.",
  submitted: "Strike acknowledged the order. Waiting for the fill.",
  unknown:
    "Strike’s answer did not arrive. Cadence is asking Strike what happened before doing anything else.",
  rejected: "Strike refused the order. Nothing was placed.",
  unfilled: "The entry could not fill in full at the plan’s price, so it was cancelled.",
  canceled: "The unfilled entry was cancelled.",
  expired: "The entry window closed before the order was sent.",
  open_verifying: "The entry filled. Cadence is confirming the stop and target on Strike.",
  open_verified: "Your stop and target are confirmed on Strike for the filled size.",
  recovery_required:
    "The exits could not be confirmed. Cadence is closing the position with a reduce-only order.",
  closed: "The position is closed and reconciled with Strike.",
};
