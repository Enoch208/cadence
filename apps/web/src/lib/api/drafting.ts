import { z } from "zod";

export const draftedKeys = [
  "market",
  "direction",
  "entryMin",
  "entryMax",
  "stopPrice",
  "targetPrice",
  "entryExpiresAt",
  "rationale",
] as const;
export type DraftedKey = (typeof draftedKeys)[number];

const sourced = z.object({ value: z.string(), quote: z.string() });

export const draftingStatusSchema = z.object({ available: z.boolean() });

export const planDraftSchema = z.object({
  model: z.string(),
  draft: z.object({
    filled: z.partialRecord(z.enum(draftedKeys), sourced),
    missing: z.array(z.enum(draftedKeys)),
  }),
});
export type PlanDraftReply = z.infer<typeof planDraftSchema>;
