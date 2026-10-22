import { Buffer } from "node:buffer";
import { positiveDecimalSchema } from "@cadence/core";
import { builderCodeSchema } from "@cadence/strike";
import { z } from "zod";

const webOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
  }, "must be an origin such as https://cadence.example, with no path")
  .transform((value) => new URL(value).origin);

export const apiEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8810),
  PUBLIC_WEB_ORIGIN: webOrigin,
  SESSION_SECRET: z.string().min(32),
  KEY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  KEY_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive(),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,29}bot$/i),
  STRIKE_API_BASE: z
    .url({ protocol: /^https$/ })
    .default("https://api.strikefinance.org")
    .transform((value) => value.replace(/\/+$/, "")),
  CADENCE_LIVE_MAX_NOTIONAL: positiveDecimalSchema,
  STRIKE_BUILDER_CODE: builderCodeSchema.optional(),
  OPENAI_API_KEY: z
    .string()
    .regex(/^sk-[\w-]{20,}$/)
    .optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const variableNames = apiEnvSchema.keyof().options;

export function loadApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const present = Object.fromEntries(
    variableNames.map((name) => [name, source[name] === "" ? undefined : source[name]]),
  );
  const parsed = apiEnvSchema.safeParse(present);
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
  throw new EnvError(`The API environment is incomplete. ${parts.join(" ")}`);
}

export const keyEncryptionKeyBytes = (env: Pick<ApiEnv, "KEY_ENCRYPTION_KEY">) =>
  Uint8Array.from(Buffer.from(env.KEY_ENCRYPTION_KEY, "hex"));
