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
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model);
  if (match === null) {
    return model;
  }
  const [, family = "", major = "", minor] = match;
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
}
