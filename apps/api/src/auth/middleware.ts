import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppDeps, AppEnv } from "../deps";
import { forbidden, unauthenticated } from "../http/errors";
import { readSession, sessionCookieName } from "./session";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

export const requireUser = (deps: Pick<AppDeps, "env" | "now">) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const token = getCookie(c, sessionCookieName);
    const userId =
      token === undefined ? null : readSession(token, deps.env.SESSION_SECRET, deps.now());
    if (userId === null) {
      throw unauthenticated();
    }
    c.set("userId", userId);
    await next();
  });

const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireSameOrigin = (webOrigin: string) =>
  createMiddleware(async (c, next) => {
    const fromCadence =
      c.req.header("origin") === webOrigin && c.req.header("x-cadence-request") === "1";
    if (!readOnlyMethods.has(c.req.method) && !fromCadence) {
      throw forbidden("CROSS_SITE_REQUEST", "This request must come from the Cadence web app.");
    }
    await next();
  });
