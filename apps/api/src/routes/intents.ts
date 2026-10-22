import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { uuidParam } from "../http/params";
import { approvePreview } from "../intents/approve";
import { intentView, receiptView, requestEntryCancel } from "../intents/read";

const approveBody = z.strictObject({ previewId: z.uuid() });
const missingIntent = "That intent does not exist.";

export function intentRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps);
  return new Hono<AppEnv>()
    .post("/intents", signedIn, async (c) => {
      const { previewId } = await readBody(c, approveBody);
      const { id, created } = await approvePreview(deps, c.get("userId"), previewId);
      return c.json({ id }, created ? 201 : 200);
    })
    .get("/intents/:id", signedIn, async (c) =>
      c.json(await intentView(deps.db, c.get("userId"), uuidParam(c, "id", missingIntent))),
    )
    .post("/intents/:id/cancel-entry", signedIn, async (c) => {
      const intentId = uuidParam(c, "id", missingIntent);
      return c.json(await requestEntryCancel(deps, c.get("userId"), intentId), 202);
    })
    .get("/receipts/:intentId", signedIn, async (c) => {
      const intentId = uuidParam(c, "intentId", missingIntent);
      return c.json(await receiptView(deps.db, c.get("userId"), intentId));
    });
}
