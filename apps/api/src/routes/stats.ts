import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../deps";
import { measuredStats } from "../stats/measured";

export function statsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get("/stats", async (c) => {
    c.header("Cache-Control", "public, max-age=30");
    return c.json(await measuredStats(deps.db, deps.now()));
  });
}
