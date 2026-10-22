import { positiveDecimalSchema } from "@cadence/core";
import { z } from "zod";

const webOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
  }, "must be an origin such as https://cadence.example, with no path")
  .transform((value) => new URL(value).origin);

export const workerEnvSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    KEY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
    KEY_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive(),
    STRIKE_API_BASE: z
      .url({ protocol: /^https$/ })
      .default("https://api.strikefinance.org")
      .transform((value) => value.replace(/\/+$/, "")),
    CADENCE_LIVE_MAX_NOTIONAL: positiveDecimalSchema,
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{30,}$/)
      .optional(),
    PUBLIC_WEB_ORIGIN: webOrigin.optional(),
  })
  .superRefine((env, context) => {
    if (env.TELEGRAM_BOT_TOKEN !== undefined && env.PUBLIC_WEB_ORIGIN === undefined) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_WEB_ORIGIN"],
        message: "Order messages link to the web app, so they need its origin",
      });
    }
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
