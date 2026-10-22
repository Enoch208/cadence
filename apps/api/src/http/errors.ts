import { DrizzleQueryError } from "drizzle-orm";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }

  toBody() {
    return { code: this.code, message: this.message };
  }
}

export const unauthenticated = () =>
  new HttpError(401, "UNAUTHENTICATED", "Sign in with Telegram to continue.");

export const forbidden = (code: string, message: string) => new HttpError(403, code, message);

export const notFound = (message: string) => new HttpError(404, "NOT_FOUND", message);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const unprocessable = (code: string, message: string) => new HttpError(422, code, message);

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
