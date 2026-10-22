import { randomUUID } from "node:crypto";
import { restSigningMessage } from "./canonical";
import type { OrderAck, StrategyAck, StrikeClient, SymbolConfiguration } from "./client";
import type { ServerClock } from "./clock";
import { StrikeAmbiguousError } from "./errors";
import { createAccountReads } from "./live-account";
import {
  misreported,
  publicRead,
  readShaped,
  shaped,
  signedRead,
  signedWrite,
} from "./live-requests";
import {
  toBookSnapshot,
  toFeeSchedule,
  toMarketRules,
  toMarkSnapshot,
  toOrderAck,
  toServerTime,
  toStrategyAck,
  toSymbolSettings,
} from "./normalize";
import { reduceOnlyCloseBody, strategyRequestBody } from "./orders";
import type { Signer } from "./signer";
import { createTransport, type Authenticate, type TransportRequest } from "./transport";

export type LiveStrikeClientArgs = {
  baseUrl: string;
  signer: Signer;
  clock: ServerClock;
  fetch: typeof fetch;
  timeoutMs: number;
  now: () => number;
};

export const clockResyncMs = 60_000;

const acknowledgedOther = (operation: string) =>
  new StrikeAmbiguousError({
    operation,
    reason: "response",
    detail: "Strike acknowledged a different order than the one sent",
  });

function assertWhole(value: number, min: number, max: number, what: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be a whole number from ${String(min)} to ${String(max)}`);
  }
}

export function createLiveStrikeClient(args: LiveStrikeClientArgs): StrikeClient {
  const { clock, signer, now } = args;
  let syncing: Promise<number> | null = null;

  const authenticate: Authenticate = async ({ method, pathWithQuery, body }) => {
    await ensureClock();
    const timestampSeconds = clock.restTimestampSeconds();
    const nonce = randomUUID();
    const message = restSigningMessage({ method, pathWithQuery, timestampSeconds, nonce, body });
    return {
      "X-API-Wallet-Public-Key": signer.publicKeyHex,
      "X-API-Wallet-Signature": signer.sign(message),
      "X-API-Wallet-Timestamp": String(timestampSeconds),
      "X-API-Wallet-Nonce": nonce,
    };
  };

  const transport = createTransport({
    baseUrl: args.baseUrl,
    fetch: args.fetch,
    timeoutMs: args.timeoutMs,
    now,
    authenticate,
  });

  async function serverTime(): Promise<number> {
    const request = publicRead("serverTime", "/v2/time");
    const reply = await transport.send(request);
    const time = shaped(request, () => toServerTime(reply.body));
    clock.observe({ sentAt: reply.sentAt, receivedAt: reply.receivedAt, serverTime: time });
    return time;
  }

  async function ensureClock(): Promise<void> {
    const syncedAt = clock.syncedAt();
    if (syncedAt !== null && now() - syncedAt < clockResyncMs) {
      return;
    }
    syncing ??= serverTime().finally(() => {
      syncing = null;
    });
    await syncing;
  }

  async function write<T>(request: TransportRequest, map: (body: unknown, at: number) => T) {
    const reply = await transport.send(request);
    return shaped(request, () => map(reply.body, reply.receivedAt));
  }

  async function configureSymbol(symbol: string, settings: SymbolConfiguration): Promise<void> {
    assertWhole(settings.leverage, 1, 125, "Leverage");
    const current = await readShaped(transport, signedRead("symbols", "/v2/symbols"), (reply) =>
      toSymbolSettings(reply.body, symbol),
    );
    if (current.marginMode !== settings.marginMode) {
      await transport.send(
        signedWrite("marginMode", "POST", "/v2/marginMode", {
          symbol,
          marginMode: settings.marginMode,
        }),
      );
    }
    if (current.leverage !== settings.leverage) {
      await transport.send(
        signedWrite("leverage", "POST", "/v2/leverage", { symbol, leverage: settings.leverage }),
      );
    }
  }

  return {
    environment: "live",
    serverTime,
    markets: () =>
      readShaped(transport, publicRead("markets", "/v2/markets"), (reply) =>
        toMarketRules(reply.body),
      ),
    book: async (symbol, depth) => {
      assertWhole(depth, 1, 1000, "Book depth");
      const query = [
        ["symbol", symbol],
        ["limit", String(depth)],
      ] as const;
      return readShaped(transport, publicRead("book", "/price/v2/depth", query), (reply) =>
        toBookSnapshot(reply.body, symbol, reply.sentAt),
      );
    },
    mark: async (symbol) => {
      const request = publicRead("mark", "/price/v2/markPrice", [["symbol", symbol]]);
      const mark = await readShaped(transport, request, (reply) =>
        toMarkSnapshot(reply.body, reply.sentAt),
      );
      if (mark.symbol !== symbol) {
        throw misreported("mark", "Strike answered with the mark price of another symbol");
      }
      return mark;
    },
    fees: () =>
      readShaped(transport, publicRead("fees", "/v2/fee-tiers"), (reply) =>
        toFeeSchedule(reply.body),
      ),
    ...createAccountReads(transport),
    placeStrategy: async (order): Promise<StrategyAck> => {
      const body = strategyRequestBody(order);
      const request = signedWrite("placeStrategy", "POST", "/v2/order/strategy", body);
      const ack = await write(request, toStrategyAck);
      if (
        ack.strategyId !== order.strategyId ||
        ack.entryClientOrderId !== order.entryClientOrderId
      ) {
        throw acknowledgedOther(request.operation);
      }
      return ack;
    },
    cancel: async (symbol, clientOrderId) => {
      await transport.send(
        signedWrite("cancel", "DELETE", "/v2/order/cancel", {
          symbol,
          client_order_id: clientOrderId,
        }),
      );
    },
    closeReduceOnly: async (order): Promise<OrderAck> => {
      const request = signedWrite(
        "closeReduceOnly",
        "POST",
        "/v2/order",
        reduceOnlyCloseBody(order),
      );
      const ack = await write(request, toOrderAck);
      if (ack.clientOrderId !== order.clientOrderId) {
        throw acknowledgedOther(request.operation);
      }
      return ack;
    },
    configureSymbol,
  };
}
