import type { ClockSample } from "./clock";
import { misreported, publicRead, readShaped, shaped } from "./live-requests";
import {
  toBookSnapshot,
  toFeeSchedule,
  toMarketRules,
  toMarkSnapshot,
  toServerTime,
} from "./normalize";
import type { Transport } from "./transport";

export async function readServerTime(transport: Transport): Promise<ClockSample> {
  const request = publicRead("serverTime", "/v2/time");
  const reply = await transport.send(request);
  const serverTime = shaped(request, () => toServerTime(reply.body));
  return { sentAt: reply.sentAt, receivedAt: reply.receivedAt, serverTime };
}

export function createPublicReads(transport: Transport) {
  return {
    markets: () =>
      readShaped(transport, publicRead("markets", "/v2/markets"), (reply) =>
        toMarketRules(reply.body),
      ),
    book: async (symbol: string, depth: number) => {
      if (!Number.isInteger(depth) || depth < 1 || depth > 1000) {
        throw new RangeError("Book depth must be a whole number from 1 to 1000");
      }
      const query = [
        ["symbol", symbol],
        ["limit", String(depth)],
      ] as const;
      return readShaped(transport, publicRead("book", "/price/v2/depth", query), (reply) =>
        toBookSnapshot(reply.body, symbol, reply.sentAt),
      );
    },
    mark: async (symbol: string) => {
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
  };
}
