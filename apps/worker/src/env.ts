import { positiveDecimalSchema } from "@cadence/core";
import { z } from "zod";

export const workerEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  KEY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  KEY_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive(),
  STRIKE_API_BASE: z
    .url({ protocol: /^https$/ })
    .default("https://api.strikefinance.org")
    .transform((value) => value.replace(/\/+$/, "")),
  CADENCE_LIVE_MAX_NOTIONAL: positiveDecimalSchema,
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class WorkerEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerEnvError";
  }
}

const variableNames = workerEnvSchema.keyof().options;

export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const present = Object.fromEntries(
    variableNames.map((name) => [name, source[name] === "" ? undefined : source[name]]),
  );
  const parsed = workerEnvSchema.safeParse(present);
  if (parsed.success) {
    return parsed.data;
  }
  const failing = variableNames.filter((name) =>
    parsed.error.issues.some((issue) => issue.path[0] === name),
  );
  const missing = failing.filter((name) => present[name] === undefined);
  const invalid = failing.filter((name) => present[name] !== undefined);
  const parts = [
    ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}.`] : []),
    ...(invalid.length > 0 ? [`Invalid: ${invalid.join(", ")}.`] : []),
  ];
  throw new WorkerEnvError(`The worker environment is incomplete. ${parts.join(" ")}`);
}
