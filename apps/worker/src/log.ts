import { DrizzleQueryError } from "drizzle-orm";

const stamp = () => new Date().toISOString();

const stackFrames = (error: Error) =>
  (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");

export function describeFailure(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const cause: unknown = error.cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "none";
    return `Database query failed with SQLSTATE ${code}\n${stackFrames(error)}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${stackFrames(error)}`;
  }
  return "A non-error value was thrown";
}

export const logLine = (line: string) => {
  process.stdout.write(`${stamp()} ${line}\n`);
};

export const logFailure = (what: string, error: unknown) => {
  process.stderr.write(`${stamp()} ${what} failed. ${describeFailure(error)}\n`);
};
