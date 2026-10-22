import { Hono } from "hono";
import { z } from "zod";
import { positiveDecimalSchema } from "@cadence/core";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { createPreview } from "../previews/service";

const previewBody = z.strictObject({
  planPublicId: z.string().min(1).max(64),
  accountId: z.uuid(),
  quantityCeiling: positiveDecimalSchema.optional(),
});

export function previewRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().post("/previews", requireUser(deps), async (c) => {
    const body = await readBody(c, previewBody);
    const preview = await createPreview(deps, c.get("userId"), {
      planPublicId: body.planPublicId,
      accountId: body.accountId,
      quantityCeiling: body.quantityCeiling ?? null,
    });
    return c.json(preview, 201);
  });
}
