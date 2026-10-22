import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";

export function readPrivateEnvFile(path: string): Record<string, string | undefined> {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${path} can be read by other users (mode ${mode.toString(8)}); run chmod 600 ${path}`,
    );
  }
  return parseEnv(readFileSync(path, "utf8"));
}
