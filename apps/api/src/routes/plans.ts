import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { notFound } from "../http/errors";
import { uuidParam } from "../http/params";
import { readPublicPlan, readPublicPlanVersion } from "../plan/public";
import { createDraft, publicIdShape, publishPlan, revokePlan } from "../plan/service";

const fields = z.record(z.string(), z.unknown());
const createBody = z.object({ communityId: z.uuid(), fields });
const publishBody = z.object({ fields: fields.optional() }).optional();

const missingPlan = "That plan does not exist.";

function publicIdParam(c: Context): string {
  const publicId = c.req.param("publicId") ?? "";
  if (!publicIdShape.test(publicId)) {
    throw notFound("This plan does not exist or has not been published yet.");
  }
  return publicId;
}

function versionParam(c: Context): number {
  const version = c.req.param("version") ?? "";
  if (!/^[1-9]\d{0,5}$/.test(version)) {
    throw notFound("This plan has no such version.");
  }
  return Number(version);
}

export function planRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps);
  return new Hono<AppEnv>()
    .post("/plans", signedIn, async (c) => {
      const body = await readBody(c, createBody);
      return c.json({ plan: await createDraft(deps, c.get("userId"), body) }, 201);
    })
    .post("/plans/:id/publish", signedIn, async (c) => {
      const planId = uuidParam(c, "id", missingPlan);
      const body = await readBody(c, publishBody);
      return c.json(await publishPlan(deps, c.get("userId"), planId, body?.fields), 201);
    })
    .post("/plans/:id/revoke", signedIn, async (c) => {
      const planId = uuidParam(c, "id", missingPlan);
      return c.json(await revokePlan(deps, c.get("userId"), planId));
    })
    .get("/plans/:publicId", async (c) => c.json(await readPublicPlan(deps.db, publicIdParam(c))))
    .get("/plans/:publicId/versions/:version", async (c) =>
      c.json(await readPublicPlanVersion(deps.db, publicIdParam(c), versionParam(c))),
    );
}
