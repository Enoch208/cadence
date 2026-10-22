import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  signal?: AbortSignal;
};

async function errorFrom(response: Response): Promise<ApiError> {
  const fallback = `The server answered ${String(response.status)}.`;
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : "UNKNOWN";
      const message = typeof record.message === "string" ? record.message : fallback;
      return new ApiError(response.status, code, message);
    }
  } catch {
    return new ApiError(response.status, "UNREADABLE", fallback);
  }
  return new ApiError(response.status, "UNKNOWN", fallback);
}

export async function apiRequest<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  options: RequestOptions = {},
): Promise<z.infer<Schema>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Cadence-Request"] = "1";
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "The server sent an answer this page does not understand.",
    );
  }
  return parsed.data;
}
