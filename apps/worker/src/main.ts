import { Buffer } from "node:buffer";
import { Api } from "grammy";
import { clientForConnection, createDb, type Db } from "@cadence/db";
import { loadWorkerEnv, WorkerEnvError, type WorkerEnv } from "./env";
import { logLine } from "./log";
import { startWorkerLoop } from "./loop";
import type { NotifierDeps } from "./notify";
import { createTelegramSender } from "./notify-telegram";

const passIntervalMs = 2_000;
const telegramTimeoutSeconds = 15;

function environment(): WorkerEnv {
  try {
    return loadWorkerEnv(process.env);
  } catch (error) {
    if (error instanceof WorkerEnvError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = environment();
const { db, close } = createDb(env.DATABASE_URL);
const keyEncryptionKey = Buffer.from(env.KEY_ENCRYPTION_KEY, "hex");
const now = () => Date.now();

function notifierFor(database: Db): NotifierDeps | null {
  if (env.TELEGRAM_BOT_TOKEN === undefined || env.PUBLIC_WEB_ORIGIN === undefined) {
    return null;
  }
  const api = new Api(env.TELEGRAM_BOT_TOKEN, { timeoutSeconds: telegramTimeoutSeconds });
  return { db: database, now, sender: createTelegramSender(api), webOrigin: env.PUBLIC_WEB_ORIGIN };
}

const notifier = notifierFor(db);

const loop = startWorkerLoop(
  {
    db,
    now,
    liveMaxNotional: env.CADENCE_LIVE_MAX_NOTIONAL,
    strikeFor: (connection) =>
      clientForConnection(connection, {
        keyEncryptionKey,
        strikeApiBase: env.STRIKE_API_BASE,
        fetch,
        now,
      }),
  },
  { intervalMs: passIntervalMs, notifier },
);

logLine(
  `Cadence worker started against ${env.STRIKE_API_BASE}; every live order is capped at ${env.CADENCE_LIVE_MAX_NOTIONAL} notional`,
);
logLine(
  notifier === null
    ? "Telegram order messages are off: TELEGRAM_BOT_TOKEN is not set, so queued messages wait unsent"
    : `Telegram order messages are on, linking to ${notifier.webOrigin}`,
);

async function shutDown(signal: NodeJS.Signals): Promise<void> {
  logLine(`${signal} received; finishing the current pass before stopping`);
  await loop.stop();
  await close();
  logLine("Cadence worker stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutDown(signal);
  });
}
