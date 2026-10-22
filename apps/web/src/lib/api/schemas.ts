import { z } from "zod";
import {
  decimalStringSchema,
  decisionOutcomes,
  environments,
  intentStates,
  limitingFactors,
  orderRoles,
  planFieldsSchema,
  reasonCodes,
  type Decision,
  type DecisionEvidence,
  type Proposal,
} from "@cadence/core";

const decimal = decimalStringSchema;

const proposalSchema: z.ZodType<Proposal> = z.object({
  quantity: decimal,
  limitPrice: decimal,
  notional: decimal,
  priceLoss: decimal,
  costs: z.object({
    entryFee: decimal,
    exitFee: decimal,
    stopSlippageReserve: decimal,
    fundingReserve: decimal,
  }),
  plannedLoss: decimal,
  rewardRiskNet: decimal,
  leverage: z.number(),
  initialMargin: decimal,
  estimatedLiquidationPrice: decimal,
  admissibleBudget: decimal,
  limitedBy: z.enum(limitingFactors),
});

const evidenceSchema: z.ZodType<DecisionEvidence> = z.object({
  bestBid: decimal.nullable(),
  bestAsk: decimal.nullable(),
  markPrice: decimal,
  accountObservedAt: z.number(),
  bookObservedAt: z.number(),
  markObservedAt: z.number(),
  evaluatedAt: z.number(),
});

const reasons = z.array(z.enum(reasonCodes));

export const decisionSchema: z.ZodType<Decision> = z.union([
  z.object({ outcome: z.literal("BLOCKED"), reasons, evidence: evidenceSchema }),
  z.object({
    outcome: z.enum(decisionOutcomes).exclude(["BLOCKED"]),
    reasons,
    proposal: proposalSchema,
    evidence: evidenceSchema,
  }),
]);

const versionSummary = z.object({
  version: z.number().int().positive(),
  digest: z.string(),
  publishedAt: z.number(),
});

export const publicPlanSchema = z.object({
  publicId: z.string(),
  status: z.enum(["draft", "published", "revoked"]),
  communityName: z.string(),
  current: versionSummary.extend({ plan: planFieldsSchema }),
  versions: z.array(versionSummary),
});
export type PublicPlan = z.infer<typeof publicPlanSchema>;

export const meSchema = z.object({
  user: z.object({ id: z.string(), displayName: z.string() }),
});

export const accountSchema = z.object({
  id: z.string(),
  environment: z.enum(environments),
  strikeAccountId: z.string(),
  status: z.enum(["active", "paused", "disconnected"]),
});
export type ConnectedAccount = z.infer<typeof accountSchema>;

export const accountsSchema = z.object({ accounts: z.array(accountSchema) });

export const previewSchema = z.object({
  previewId: z.string(),
  expiresAt: z.number(),
  decision: decisionSchema,
});
export type PreviewResult = z.infer<typeof previewSchema>;

const orderSchema = z.object({
  role: z.enum(orderRoles),
  clientOrderId: z.string(),
  exchangeOrderId: z.string().nullable(),
  lastStatus: z.string().nullable(),
  filledSize: decimal,
});

const eventSchema = z.object({ at: z.number(), type: z.string() });

export const intentSchema = z.object({
  id: z.string(),
  state: z.enum(intentStates),
  environment: z.enum(environments),
  planPublicId: z.string(),
  planVersion: z.number().int().positive(),
  market: z.string(),
  approved: proposalSchema,
  orders: z.array(orderSchema),
  events: z.array(eventSchema),
});
export type IntentView = z.infer<typeof intentSchema>;

export const createdIntentSchema = z.object({ id: z.string() });

export const communitiesSchema = z.object({
  communities: z.array(z.object({ id: z.string(), name: z.string(), telegramChatId: z.string() })),
});

export const createdCommunitySchema = z.object({ community: z.object({ id: z.string() }) });

export const createdPlanSchema = z.object({
  plan: z.object({ id: z.string(), publicId: z.string() }),
});

export const publishedPlanVersionSchema = z.object({
  publicId: z.string(),
  version: z.number().int().positive(),
  digest: z.string(),
});

export const policyVersionSchema = z.object({ version: z.number().int().positive() });
