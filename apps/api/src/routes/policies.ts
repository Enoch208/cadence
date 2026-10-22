import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { savePolicy } from "../policies/service";

const budgetsBody = z.strictObject({
  perTradeBudget: z.unknown().optional(),
  aggregateBudget: z.unknown().optional(),
  sessionBudget: z.unknown().optional(),
  leverageCap: z.unknown().optional(),
  minRewardRisk: z.unknown().optional(),
});

export function policyRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().put("/policies", requireUser(deps), async (c) => {
    const budgets = await readBody(c, budgetsBody);
    const saved = await savePolicy(deps, c.get("userId"), budgets);
    return c.json({ version: saved.version });
  });
}
