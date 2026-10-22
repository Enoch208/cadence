import { Hono } from "hono";
import { z } from "zod";
import { replayScenarioNames } from "@cadence/strike";
import { connectLiveAccount, connectReplayAccount } from "../accounts/connect";
import { listAccounts, missingAccount, setAccountStatus } from "../accounts/service";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { readBody } from "../http/body";
import { uuidParam } from "../http/params";

const liveBody = z.strictObject({
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "Use the 64 hex characters of the public key"),
  privateKey: z
    .string()
    .regex(/^(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/, "Use 64 or 128 hex characters"),
});

const replayBody = z.strictObject({ scenario: z.enum(replayScenarioNames) });

const missing = missingAccount().message;

export function accountRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps);
  return new Hono<AppEnv>()
    .get("/accounts", signedIn, async (c) =>
      c.json({ accounts: await listAccounts(deps.db, c.get("userId")) }),
    )
    .post("/accounts", signedIn, async (c) => {
      const keys = await readBody(c, liveBody);
      return c.json(await connectLiveAccount(deps, c.get("userId"), keys), 201);
    })
    .post("/accounts/replay", signedIn, async (c) => {
      const { scenario } = await readBody(c, replayBody);
      return c.json(await connectReplayAccount(deps, c.get("userId"), scenario), 201);
    })
    .post("/accounts/:id/pause", signedIn, async (c) =>
      c.json(await setAccountStatus(deps, c.get("userId"), uuidParam(c, "id", missing), "paused")),
    )
    .post("/accounts/:id/resume", signedIn, async (c) =>
      c.json(await setAccountStatus(deps, c.get("userId"), uuidParam(c, "id", missing), "active")),
    );
}
