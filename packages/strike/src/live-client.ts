import { randomUUID } from "node:crypto";
import { restSigningMessage } from "./canonical";
import type { OrderAck, StrategyAck, StrikeClient, SymbolConfiguration } from "./client";
import type { ServerClock } from "./clock";
import { StrikeAmbiguousError } from "./errors";
import { createAccountReads } from "./live-account";
import { readShaped, shaped, signedRead, signedWrite } from "./live-requests";
import { toOrderAck, toStrategyAck, toSymbolSettings } from "./normalize";
import { reduceOnlyCloseBody, strategyRequestBody } from "./orders";
import { createPublicReads, readServerTime } from "./public-reads";
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
    const sample = await readServerTime(transport);
    clock.observe(sample);
    return sample.serverTime;
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
    if (!Number.isInteger(settings.leverage) || settings.leverage < 1 || settings.leverage > 125) {
      throw new RangeError("Leverage must be a whole number from 1 to 125");
    }
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
    ...createPublicReads(transport),
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
