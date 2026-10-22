import { z } from "zod";
import { positiveDecimalSchema } from "./contract";

export const riskPolicySchema = z.strictObject({
  version: z.number().int().positive(),
  perTradeBudget: positiveDecimalSchema,
  aggregateBudget: positiveDecimalSchema,
  sessionBudget: positiveDecimalSchema,
  leverageCap: z.number().int().min(1).max(20),
  maxEntrySlippageBps: z.number().int().min(0).max(100),
  stopSlippageReserveBps: z.number().int().min(0).max(500),
  fundingHorizonHours: z.number().int().min(1).max(168),
  minRewardRisk: positiveDecimalSchema,
  liquidationBufferBps: z.number().int().min(0).max(5000),
  allowedMarkets: z.array(z.string().min(1).max(64)).min(1).max(2),
});
export type RiskPolicy = z.infer<typeof riskPolicySchema>;
