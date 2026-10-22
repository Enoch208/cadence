import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { createDraftAllowance, draftPlan } from "../drafting/service";
import { readBody } from "../http/body";

const draftBody = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Paste the message first.")
    .max(4000, "Paste one message of at most 4,000 characters."),
});

export function draftingRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps);
  const allow = createDraftAllowance();
  return new Hono<AppEnv>()
    .get("/drafting", signedIn, (c) => c.json({ available: deps.drafter !== null }))
    .post("/drafting/plan", signedIn, async (c) => {
      const { text } = await readBody(c, draftBody);
      return c.json(await draftPlan(deps, { userId: c.get("userId"), text, allow }));
    });
}
