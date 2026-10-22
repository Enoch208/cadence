import { serve } from "@hono/node-server";
import { Api } from "grammy";
import { clientForConnection, createDb, strikeTimeoutMs } from "@cadence/db";
import {
  createLiveStrikeClient,
  createPublicStrikeClient,
  createServerClock,
} from "@cadence/strike";
import { createApp } from "./app";
import { EnvError, keyEncryptionKeyBytes, loadApiEnv, type ApiEnv } from "./env";
import { createGrammyPublisher } from "./telegram/publisher";

function environment(): ApiEnv {
  try {
    return loadApiEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = environment();
const now = () => Date.now();
const { db, close } = createDb(env.DATABASE_URL);
const exchange = { baseUrl: env.STRIKE_API_BASE, fetch, timeoutMs: strikeTimeoutMs };
const publicStrike = createPublicStrikeClient(exchange);
const connectionDeps = {
  keyEncryptionKey: keyEncryptionKeyBytes(env),
  strikeApiBase: env.STRIKE_API_BASE,
  fetch,
  now,
};

const app = createApp({
  db,
  env,
  strike: {
    public: () => publicStrike,
    forConnection: (connection) => clientForConnection(connection, connectionDeps),
    forSigner: (signer) =>
      createLiveStrikeClient({ ...exchange, signer, clock: createServerClock(now), now }),
  },
  telegram: createGrammyPublisher(new Api(env.TELEGRAM_BOT_TOKEN)),
  now,
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "127.0.0.1" }, (info) => {
  process.stdout.write(`Cadence API listening on http://127.0.0.1:${String(info.port)}\n`);
});

function shutDown(signal: string) {
  process.stdout.write(`Cadence API stopping on ${signal}\n`);
  server.close();
  void close().then(() => process.exit(0));
}

process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);
