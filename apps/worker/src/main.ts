import { Buffer } from "node:buffer";
import { clientForConnection, createDb } from "@cadence/db";
import { loadWorkerEnv, WorkerEnvError, type WorkerEnv } from "./env";
import { logLine } from "./log";
import { startWorkerLoop } from "./loop";

const passIntervalMs = 2_000;

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
  { intervalMs: passIntervalMs },
);

logLine(
  `Cadence worker started against ${env.STRIKE_API_BASE}; every live order is capped at ${env.CADENCE_LIVE_MAX_NOTIONAL} notional`,
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
