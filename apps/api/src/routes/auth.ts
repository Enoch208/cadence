import { Hono, type Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { requireUser, sessionCookieOptions } from "../auth/middleware";
import { issueSession, sessionCookieName, sessionLifetimeMs } from "../auth/session";
import { verifyLoginWidget, verifyWebAppInitData, type TelegramIdentity } from "../auth/telegram";
import { findUser, upsertTelegramUser, userView } from "../auth/users";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { HttpError, unauthenticated } from "../http/errors";

const webAppBody = z.object({ initData: z.string().min(1).max(4096) });

const widgetBody = z
  .record(z.string().max(64), z.union([z.string().max(1024), z.number().int()]))
  .refine((fields) => Object.keys(fields).length <= 12, "Too many Login Widget fields")
  .transform((fields) =>
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])),
  );

const refused = () =>
  new HttpError(
    401,
    "TELEGRAM_SIGNATURE_REFUSED",
    "Telegram could not confirm this sign-in. Open Cadence from Telegram again.",
  );

export function authRoutes(deps: AppDeps) {
  const nowSeconds = () => Math.floor(deps.now() / 1000);

  async function signIn(c: Context<AppEnv>, identity: TelegramIdentity | null) {
    if (identity === null) {
      throw refused();
    }
    const user = await upsertTelegramUser(deps.db, identity, deps.now());
    setCookie(c, sessionCookieName, issueSession(user.id, deps.env.SESSION_SECRET, deps.now()), {
      ...sessionCookieOptions,
      maxAge: sessionLifetimeMs / 1000,
    });
    return c.json({ user: userView(user) });
  }

  return new Hono<AppEnv>()
    .post("/auth/telegram/webapp", async (c) => {
      const { initData } = await readBody(c, webAppBody);
      const token = deps.env.TELEGRAM_BOT_TOKEN;
      return signIn(c, verifyWebAppInitData(initData, token, nowSeconds()));
    })
    .post("/auth/telegram/widget", async (c) => {
      const fields = await readBody(c, widgetBody);
      return signIn(c, verifyLoginWidget(fields, deps.env.TELEGRAM_BOT_TOKEN, nowSeconds()));
    })
    .post("/auth/logout", (c) => {
      deleteCookie(c, sessionCookieName, sessionCookieOptions);
      return c.body(null, 204);
    })
    .get("/me", requireUser(deps), async (c) => {
      const user = await findUser(deps.db, c.get("userId"));
      if (user === null) {
        throw unauthenticated();
      }
      return c.json({ user: userView(user) });
    });
}
