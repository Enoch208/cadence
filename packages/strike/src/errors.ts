export class StrikeRejectedError extends Error {
  override readonly name = "StrikeRejectedError";
  readonly operation: string;
  readonly status: number;
  readonly code: string | null;
  readonly strikeMessage: string;

  constructor(args: { operation: string; status: number; code: string | null; message: string }) {
    const code = args.code === null ? "" : ` ${args.code}`;
    super(
      `Strike rejected ${args.operation} (HTTP ${String(args.status)}${code}): ${args.message}`,
    );
    this.operation = args.operation;
    this.status = args.status;
    this.code = args.code;
    this.strikeMessage = args.message;
  }
}

export class StrikeRateLimitedError extends Error {
  override readonly name = "StrikeRateLimitedError";
  readonly operation: string;

  constructor(operation: string) {
    super(`Strike rate limited ${operation}, so it was not executed`);
    this.operation = operation;
  }
}

export type AmbiguityReason = "timeout" | "connection" | "server" | "response";

export class StrikeAmbiguousError extends Error {
  override readonly name = "StrikeAmbiguousError";
  readonly operation: string;
  readonly reason: AmbiguityReason;

  constructor(args: {
    operation: string;
    reason: AmbiguityReason;
    detail: string;
    cause?: unknown;
  }) {
    super(`The outcome of ${args.operation} is unknown (${args.reason}): ${args.detail}`, {
      cause: args.cause,
    });
    this.operation = args.operation;
    this.reason = args.reason;
  }
}

export class StrikeReadError extends Error {
  override readonly name = "StrikeReadError";
  readonly operation: string;
  readonly status: number | null;

  constructor(args: { operation: string; status: number | null; detail: string; cause?: unknown }) {
    const status = args.status === null ? "" : ` (HTTP ${String(args.status)})`;
    super(`Could not read ${args.operation} from Strike${status}: ${args.detail}`, {
      cause: args.cause,
    });
    this.operation = args.operation;
    this.status = args.status;
  }
}
