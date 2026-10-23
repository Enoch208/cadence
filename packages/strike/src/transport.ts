import { z } from "zod";
import type { HttpMethod } from "./canonical";
import {
  StrikeAmbiguousError,
  StrikeRateLimitedError,
  StrikeReadError,
  StrikeRejectedError,
} from "./errors";
import { parseStrikeJson } from "./json";

export type TransportRequest = {
  operation: string;
  kind: "read" | "write";
  method: HttpMethod;
  path: `/${string}`;
  query?: readonly (readonly [string, string])[];
  body?: Readonly<Record<string, unknown>>;
  signed?: boolean;
  builderFeeBps?: number;
};

export type TransportReply = { body: unknown; sentAt: number; receivedAt: number };

export type Authenticate = (input: {
  method: HttpMethod;
  pathWithQuery: string;
  body: string;
}) => Promise<Record<string, string>>;

export type Transport = {
  send(request: TransportRequest): Promise<TransportReply>;
  find(request: TransportRequest): Promise<TransportReply | null>;
};

export type TransportArgs = {
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  now: () => number;
  authenticate?: Authenticate;
};

const strikeErrorSchema = z.object({ error: z.string(), code: z.string().optional() });
const maxMessageLength = 200;

function strikeOrigin(baseUrl: string): string {
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : null;
  const originOnly =
    url !== null &&
    url.protocol === "https:" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "";
  if (!originOnly) {
    throw new Error("The Strike base URL must be an https origin with no path");
  }
  return url.origin;
}

function strikeError(text: string): { message: string; code: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = strikeErrorSchema.safeParse(parsed);
  return result.success
    ? { message: result.data.error.slice(0, maxMessageLength), code: result.data.code ?? null }
    : null;
}

function unreachable(request: TransportRequest, cause: unknown): Error {
  const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
  const detail = timedOut ? "Strike did not answer in time" : "the connection failed";
  return request.kind === "write"
    ? new StrikeAmbiguousError({
        operation: request.operation,
        reason: timedOut ? "timeout" : "connection",
        detail,
        cause,
      })
    : new StrikeReadError({ operation: request.operation, status: null, detail, cause });
}

function refused(request: TransportRequest, status: number, text: string): Error {
  const error = strikeError(text);
  const message = error?.message ?? `HTTP ${String(status)}`;
  if (request.kind === "read") {
    return new StrikeReadError({ operation: request.operation, status, detail: message });
  }
  if (status === 429) {
    return new StrikeRateLimitedError(request.operation);
  }
  const definitive = status >= 400 && status < 500 && status !== 408;
  if (definitive && error?.message !== "nonce already used") {
    return new StrikeRejectedError({
      operation: request.operation,
      status,
      code: error?.code ?? null,
      message,
    });
  }
  return new StrikeAmbiguousError({
    operation: request.operation,
    reason: "server",
    detail: message,
  });
}

function parsedBody(request: TransportRequest, text: string): unknown {
  try {
    return parseStrikeJson(text);
  } catch (cause) {
    const detail = "Strike answered with a body that is not JSON";
    throw request.kind === "write"
      ? new StrikeAmbiguousError({
          operation: request.operation,
          reason: "response",
          detail,
          cause,
        })
      : new StrikeReadError({ operation: request.operation, status: null, detail, cause });
  }
}

export function createTransport(args: TransportArgs): Transport {
  const origin = strikeOrigin(args.baseUrl);

  function exchange(request: TransportRequest, absentOn404: true): Promise<TransportReply | null>;
  function exchange(request: TransportRequest, absentOn404: false): Promise<TransportReply>;
  async function exchange(
    request: TransportRequest,
    absentOn404: boolean,
  ): Promise<TransportReply | null> {
    const url = new URL(request.path, origin);
    for (const [name, value] of request.query ?? []) {
      url.searchParams.append(name, value);
    }
    if (url.origin !== origin) {
      throw new Error("A Strike request must stay on the configured origin");
    }
    const body = request.body === undefined ? "" : JSON.stringify(request.body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== "") {
      headers["Content-Type"] = "application/json";
    }
    if (request.signed === true) {
      if (args.authenticate === undefined) {
        throw new Error("This transport cannot sign requests");
      }
      const pathWithQuery = `${url.pathname}${url.search}`;
      Object.assign(
        headers,
        await args.authenticate({ method: request.method, pathWithQuery, body }),
      );
    }
    if (request.builderFeeBps !== undefined) {
      headers["X-Builder-Fee-Bps"] = String(request.builderFeeBps);
    }
    const sentAt = args.now();
    let status: number;
    let text: string;
    try {
      const response = await args.fetch(url, {
        method: request.method,
        headers,
        body: body === "" ? null : body,
        redirect: "manual",
        signal: AbortSignal.timeout(args.timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (cause) {
      throw unreachable(request, cause);
    }
    const receivedAt = args.now();
    if (status === 404 && absentOn404 && strikeError(text) !== null) {
      return null;
    }
    if (status < 200 || status > 299) {
      throw refused(request, status, text);
    }
    return { body: parsedBody(request, text), sentAt, receivedAt };
  }

  return {
    send: (request) => exchange(request, false),
    find: (request) => exchange(request, true),
  };
}
