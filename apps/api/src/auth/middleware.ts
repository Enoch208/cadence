import { eq } from "drizzle-orm";
import { users } from "@cadence/db";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppDeps, AppEnv } from "../deps";
import { forbidden, unauthenticated } from "../http/errors";
import { readSession, sessionCookieName, type Session } from "./session";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

type SessionDeps = Pick<AppDeps, "db" | "env" | "now">;

export function sessionFromCookie(c: Context, deps: SessionDeps): Session | null {
  const token = getCookie(c, sessionCookieName);
  return token === undefined ? null : readSession(token, deps.env.SESSION_SECRET, deps.now());
}

export const requireUser = (deps: SessionDeps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const session = sessionFromCookie(c, deps);
    if (session === null) {
      throw unauthenticated();
    }
    const [user] = await deps.db
      .select({ sessionEpoch: users.sessionEpoch })
      .from(users)
      .where(eq(users.id, session.userId));
    if (user?.sessionEpoch !== session.epoch) {
      throw unauthenticated();
    }
    c.set("userId", session.userId);
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
