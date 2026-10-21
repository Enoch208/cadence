import { z } from "zod";

export const environments = ["live", "replay"] as const;
export type Environment = (typeof environments)[number];

export const directions = ["long", "short"] as const;
export type Direction = (typeof directions)[number];

export const triggerSources = ["mark_price"] as const;
export type TriggerSource = (typeof triggerSources)[number];

export const decisionOutcomes = ["READY", "RESIZED", "BLOCKED"] as const;
export type DecisionOutcome = (typeof decisionOutcomes)[number];

export const reasonCodes = [
  "PLAN_EXPIRED",
  "PLAN_REVOKED",
  "PLAN_SUPERSEDED",
  "OUTSIDE_ENTRY_RANGE",
  "STALE_DATA",
  "ACCOUNT_CHANGED",
  "ACCOUNT_UNRECONCILED",
  "SYMBOL_BUSY",
  "UNKNOWN_EXPOSURE",
  "RISK_BUDGET_EXHAUSTED",
  "BELOW_MARKET_MINIMUM",
  "INSUFFICIENT_MARGIN",
  "INSUFFICIENT_DEPTH",
  "RR_BELOW_POLICY",
  "LIQUIDATION_BUFFER_FAILED",
  "DUPLICATE_INTENT",
  "UNSUPPORTED_CAPABILITY",
] as const;
export type ReasonCode = (typeof reasonCodes)[number];

export const intentStates = [
  "prepared",
  "blocked",
  "reserved",
  "submitted",
  "unknown",
  "rejected",
  "unfilled",
  "canceled",
  "expired",
  "open_verifying",
  "open_verified",
  "recovery_required",
  "closed",
] as const;
export type IntentState = (typeof intentStates)[number];

export const orderRoles = ["entry", "stop", "target", "recovery_close"] as const;
export type OrderRole = (typeof orderRoles)[number];

const positiveDecimalPattern = /^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/;

export const positiveDecimalSchema = z
  .string()
  .regex(positiveDecimalPattern, "Use a positive plain decimal such as 100 or 0.25")
  .brand<"PositiveDecimal">();
export type PositiveDecimal = z.infer<typeof positiveDecimalSchema>;

export const planFieldsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  market: z.string().min(1).max(64),
  direction: z.enum(directions),
  entryMin: positiveDecimalSchema,
  entryMax: positiveDecimalSchema,
  stopPrice: positiveDecimalSchema,
  targetPrice: positiveDecimalSchema,
  triggerSource: z.enum(triggerSources),
  entryExpiresAt: z.iso.datetime({ offset: false }),
  rationale: z.string().max(2000),
  environment: z.enum(environments),
});
export type PlanFields = z.infer<typeof planFieldsSchema>;
