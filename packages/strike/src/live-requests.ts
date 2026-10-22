import { StrikeAmbiguousError, StrikeReadError } from "./errors";
import type { Transport, TransportReply, TransportRequest } from "./transport";

type Query = readonly (readonly [string, string])[];
type Path = `/${string}`;

export const publicRead = (operation: string, path: Path, query: Query = []): TransportRequest => ({
  operation,
  kind: "read",
  method: "GET",
  path,
  query,
});

export const signedRead = (operation: string, path: Path, query: Query = []): TransportRequest => ({
  ...publicRead(operation, path, query),
  signed: true,
});

export const signedWrite = (
  operation: string,
  method: "POST" | "DELETE",
  path: Path,
  body: Readonly<Record<string, unknown>>,
): TransportRequest => ({ operation, kind: "write", method, path, body, signed: true });

export function shaped<T>(request: TransportRequest, map: () => T): T {
  try {
    return map();
  } catch (cause) {
    const detail = "Strike's response did not match its documented shape";
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

export async function readShaped<T>(
  transport: Transport,
  request: TransportRequest,
  map: (reply: TransportReply) => T,
): Promise<T> {
  const reply = await transport.send(request);
  return shaped(request, () => map(reply));
}

export const misreported = (operation: string, detail: string) =>
  new StrikeReadError({ operation, status: null, detail });
