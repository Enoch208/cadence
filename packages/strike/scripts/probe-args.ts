import { parseArgs } from "node:util";

const withoutSeparator = (argv: readonly string[]) => argv.filter((arg) => arg !== "--");
const envFileMissing =
  "Pass --credentials <path> to a mode-600 env file holding the Strike credentials";

export function parseProbeAccountArgs(argv: readonly string[]): { envFile: string } {
  const { values } = parseArgs({
    args: withoutSeparator(argv),
    options: { credentials: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const envFile = values.credentials;
  if (envFile === undefined) {
    throw new Error(envFileMissing);
  }
  return { envFile };
}

export function parseProbeOrderArgs(argv: readonly string[]): { envFile: string; liveOrder: true } {
  const { values } = parseArgs({
    args: withoutSeparator(argv),
    options: { credentials: { type: "string" }, "live-order": { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  if (values["live-order"] !== true) {
    throw new Error(
      "probe:order places a real order on Strike mainnet; pass --live-order to confirm",
    );
  }
  const envFile = values.credentials;
  if (envFile === undefined) {
    throw new Error(envFileMissing);
  }
  return { envFile, liveOrder: true };
}
