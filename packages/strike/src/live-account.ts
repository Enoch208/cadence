import type { AccountState, ExchangeFill, ExchangeOrderSnapshot } from "@cadence/core";
import { misreported, readShaped, shaped, signedRead } from "./live-requests";
import {
  toAccountSnapshot,
  toExchangeFill,
  toExchangeOrderSnapshot,
  toExchangeOrderSnapshots,
  toFillRows,
  toPositionSnapshots,
  toSymbolSettings,
} from "./normalize";
import type { Transport } from "./transport";

export const fillPageLimit = 1000;

export function createAccountReads(transport: Transport) {
  async function accountState(symbol: string): Promise<AccountState> {
    const requests = {
      account: signedRead("account", "/v2/account"),
      positions: signedRead("positions", "/v2/positions", [["symbol", symbol]]),
      openOrders: signedRead("openOrders", "/v2/openOrders", [["symbol", symbol]]),
      symbols: signedRead("symbols", "/v2/symbols"),
    };
    const [account, positions, openOrders, symbols] = await Promise.all([
      transport.send(requests.account),
      transport.send(requests.positions),
      transport.send(requests.openOrders),
      transport.send(requests.symbols),
    ]);
    const observedAt = Math.min(
      account.sentAt,
      positions.sentAt,
      openOrders.sentAt,
      symbols.sentAt,
    );
    return {
      account: shaped(requests.account, () => toAccountSnapshot(account.body, observedAt)),
      positions: shaped(requests.positions, () => toPositionSnapshots(positions.body)).filter(
        (position) => position.symbol === symbol,
      ),
      openOrders: shaped(requests.openOrders, () =>
        toExchangeOrderSnapshots(openOrders.body),
      ).filter((order) => order.symbol === symbol),
      symbolSettings: shaped(requests.symbols, () => toSymbolSettings(symbols.body, symbol)),
    };
  }

  async function orderBy(
    symbol: string,
    selector: readonly [string, string],
  ): Promise<ExchangeOrderSnapshot | null> {
    const request = signedRead("order", "/v2/order", [["symbol", symbol], selector]);
    const reply = await transport.find(request);
    if (reply === null) {
      return null;
    }
    const order = shaped(request, () => toExchangeOrderSnapshot(reply.body));
    const answered = selector[0] === "order_id" ? order.orderId : order.clientOrderId;
    if (order.symbol !== symbol || answered !== selector[1]) {
      throw misreported("order", "Strike answered about a different order");
    }
    return order;
  }

  async function fills(symbol: string, sinceMs: number): Promise<ExchangeFill[]> {
    const rows = await readShaped(
      transport,
      signedRead("fills", "/v2/history/fill", [
        ["symbol", symbol],
        ["startTime", String(sinceMs)],
        ["limit", String(fillPageLimit)],
      ]),
      (reply) => toFillRows(reply.body),
    );
    if (rows.length >= fillPageLimit) {
      throw misreported("fills", "more fills arrived than fit in one page, so none are trusted");
    }
    if (rows.some((row) => row.symbol !== symbol)) {
      throw misreported("fills", "Strike returned fills for another symbol");
    }
    const orderIds = [...new Set(rows.map((row) => row.orderId))];
    const orders = await Promise.all(orderIds.map((id) => orderBy(symbol, ["order_id", id])));
    const clientIds = new Map(
      orders.flatMap((order) =>
        order === null ? [] : [[order.orderId, order.clientOrderId] as const],
      ),
    );
    return rows.map((row) => toExchangeFill(row, clientIds.get(row.orderId) ?? null));
  }

  return {
    accountState,
    order: (symbol: string, clientOrderId: string) =>
      orderBy(symbol, ["client_order_id", clientOrderId]),
    openOrders: (symbol: string | null) =>
      readShaped(
        transport,
        signedRead("openOrders", "/v2/openOrders", symbol === null ? [] : [["symbol", symbol]]),
        (reply) => toExchangeOrderSnapshots(reply.body),
      ),
    fills,
  };
}
