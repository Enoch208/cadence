import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { HttpError } from "./errors";

export const limitBodySize = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) =>
    c.json({ code: "BODY_TOO_LARGE", message: "The request body is too large." }, 413),
});

export const invalidRequest = (message: string) => new HttpError(400, "INVALID_REQUEST", message);

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join(".")}: ${issue.message}`,
    )
    .join(" ");
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalidRequest("The request body must be JSON.");
  }
}

export async function readBody<Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  const parsed = schema.safeParse(parseJson(await c.req.text()));
  if (!parsed.success) {
    throw invalidRequest(describeIssues(parsed.error));
  }
  return parsed.data;
}
