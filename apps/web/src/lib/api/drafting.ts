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

export function modelName(model: string): string {
  const match = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?(?:-\d{4}-\d{2}-\d{2})?$/.exec(model);
  if (match === null) {
    return model;
  }
  const [, version = "", tier] = match;
  return tier === undefined
    ? `GPT-${version}`
    : `GPT-${version} ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
}
