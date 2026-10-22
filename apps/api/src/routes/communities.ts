import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/middleware";
import { listCommunities, registerCommunity } from "../communities/service";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";

const int64 = { min: -(2n ** 63n), max: 2n ** 63n - 1n };

const telegramChatId = z
  .string()
  .regex(/^-?[1-9]\d{0,18}$/, "Use the group's numeric chat ID, such as -1001234567890")
  .transform((value) => BigInt(value))
  .refine((value) => value >= int64.min && value <= int64.max, "That chat ID is out of range");

const registerBody = z.object({ name: z.string().trim().min(1).max(80), telegramChatId });

export function communityRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps);
  return new Hono<AppEnv>()
    .get("/communities", signedIn, async (c) =>
      c.json({ communities: await listCommunities(deps.db, c.get("userId")) }),
    )
    .post("/communities", signedIn, async (c) => {
      const body = await readBody(c, registerBody);
      return c.json({ community: await registerCommunity(deps, c.get("userId"), body) }, 201);
    });
}
