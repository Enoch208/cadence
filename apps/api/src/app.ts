import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireSameOrigin } from "./auth/middleware";
import type { AppDeps, AppEnv } from "./deps";
import { limitBodySize } from "./http/body";
import { describeFailure, HttpError } from "./http/errors";
import { accountRoutes } from "./routes/accounts";
import { authRoutes } from "./routes/auth";
import { eventRoutes } from "./routes/events";
import { intentRoutes } from "./routes/intents";
import { communityRoutes } from "./routes/communities";
import { planRoutes } from "./routes/plans";
import { policyRoutes } from "./routes/policies";
import { previewRoutes } from "./routes/previews";

export function createApp(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use("/api/*", limitBodySize)
    .use("/api/*", requireSameOrigin(deps.env.PUBLIC_WEB_ORIGIN))
    .get("/api/health", async (c) => {
      await deps.db.execute(sql`select 1`);
      return c.json({ status: "ok" });
    })
    .route("/api", authRoutes(deps))
    .route("/api", communityRoutes(deps))
    .route("/api", planRoutes(deps))
    .route("/api", accountRoutes(deps))
    .route("/api", policyRoutes(deps))
    .route("/api", previewRoutes(deps))
    .route("/api", intentRoutes(deps))
    .route("/api", eventRoutes(deps))
    .notFound((c) =>
      c.json({ code: "NOT_FOUND", message: "There is nothing at this address." }, 404),
    )
    .onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json(error.toBody(), error.status);
      }
      if (error instanceof HTTPException && error.status < 500) {
        return c.json(
          { code: "INVALID_REQUEST", message: "The request could not be read." },
          error.status,
        );
      }
      process.stderr.write(`${describeFailure(error)}\n`);
      return c.json(
        { code: "INTERNAL", message: "Something went wrong on our side. Try again in a moment." },
        500,
      );
    });
}
