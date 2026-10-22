import { describe, expect, it } from "vitest";
import { parseStrikeJson } from "../src/json";
import {
  toAccountSnapshot,
  toExchangeFill,
  toExchangeOrderSnapshot,
  toExchangeOrderSnapshots,
  toFillRows,
  toOrderAck,
  toPositionSnapshots,
  toStrategyAck,
  toSymbolSettings,
} from "../src/normalize";
import { documented } from "./support/fixtures";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";
const accountId = "5f0c1a7e-3b2d-4c8e-9f1a-2d3c4b5a6e7f";

describe("toAccountSnapshot", () => {
  it("reads the account ID and the balance available for new orders", () => {
    expect(toAccountSnapshot(documented("ref-types-account__account.json"), 1000)).toEqual({
      accountId,
      environment: "live",
      availableBalance: "22.96",
      observedAt: 1000,
    });
  });

  it("refuses a balance sent as a JSON number", () => {
    const raw = parseStrikeJson(`{"account_id":"${accountId}","available_balance":22.96}`);
    expect(() => toAccountSnapshot(raw, 0)).toThrow();
  });
});

describe("toPositionSnapshots", () => {
  it("reads the signed size and the snake_case fields", () => {
    expect(toPositionSnapshots(documented("ref-types-position__positions.json"))).toEqual([
      {
        symbol: "BTC-USD",
        signedSize: "0.00012",
        entryPrice: "84482",
        marginMode: "isolated",
        leverage: 5,
        liquidationPrice: "67857",
      },
    ]);
  });

  it("reads a Go nil slice as no positions", () => {
    expect(toPositionSnapshots(parseStrikeJson('{"positions":null,"count":0}'))).toEqual([]);
  });

  it("reports a zero liquidation price as unknown rather than as zero", () => {
    const raw = parseStrikeJson(
      '{"positions":[{"symbol":"BTC-USD","size":"-0.0002","entry_price":"84000","margin_mode":"cross","leverage":3,"liquidation_price":"0"}],"count":1}',
    );
    expect(toPositionSnapshots(raw)[0]?.liquidationPrice).toBeNull();
    expect(toPositionSnapshots(raw)[0]?.signedSize).toBe("-0.0002");
  });
});

describe("toExchangeOrderSnapshot", () => {
  it("maps the PascalCase engine model of a filled strategy primary", () => {
    expect(
      toExchangeOrderSnapshot(documented("docs-trade-orders__order-primary-filled.json")),
    ).toEqual({
      orderId: "9007199254740991",
      clientOrderId: `cad-${intentId}-e`,
      symbol: "BTC-USD",
      side: "buy",
      type: "limit",
      status: "filled",
      size: "0.00012",
      filled: "0.00012",
      price: "84482",
      stopPrice: null,
      reduceOnly: false,
      strategyId: `cad-${intentId}`,
      isStrategyPrimary: true,
      closeReason: null,
    });
  });

  it("keeps the close reason of a leg expired by its sibling", () => {
    const leg = toExchangeOrderSnapshot(documented("docs-trade-orders__order-leg-expired.json"));
    expect(leg.closeReason).toBe("order_strategy_secondary_oco");
    expect(leg.isStrategyPrimary).toBe(false);
    expect(leg.status).toBe("expired");
    expect(leg.price).toBeNull();
    expect(leg.stopPrice).toBe("86800");
  });

  it("reads an order with no strategy as a standalone order", () => {
    const raw = parseStrikeJson(
      `{"ID":12,"ClientOrderID":"cad-${intentId}-r","Symbol":"BTC-USD","Side":"sell","Status":"pending","Type":"market","Size":"0.00012","Filled":"0","Price":"0","StopPrice":"0","ReduceOnly":true,"CloseReason":""}`,
    );
    const order = toExchangeOrderSnapshot(raw);
    expect(order.strategyId).toBeNull();
    expect(order.isStrategyPrimary).toBe(false);
  });

  it("refuses a status outside Strike's lifecycle", () => {
    const raw = parseStrikeJson(
      `{"ID":12,"ClientOrderID":"x","Symbol":"BTC-USD","Side":"none","Status":"none","Type":"limit","Size":"1","Filled":"0","Price":"1","StopPrice":"0","ReduceOnly":false,"CloseReason":""}`,
    );
    expect(() => toExchangeOrderSnapshot(raw)).toThrow();
  });
});

describe("toExchangeOrderSnapshots", () => {
  it("reads both exit legs of a strategy, keeping int64 IDs exact", () => {
    const orders = toExchangeOrderSnapshots(documented("ref-types-order__open-orders.json"));
    expect(orders.map((order) => [order.orderId, order.clientOrderId, order.type])).toEqual([
      ["9007199254740993", `cad-${intentId}-s`, "stop"],
      ["9007199254740995", `cad-${intentId}-t`, "take_profit"],
    ]);
    expect(orders.every((order) => order.reduceOnly && order.status === "untriggered")).toBe(true);
    expect(orders.every((order) => order.strategyId === `cad-${intentId}`)).toBe(true);
  });

  it("reads a Go nil slice as no open orders", () => {
    expect(toExchangeOrderSnapshots(parseStrikeJson('{"orders":null,"count":0}'))).toEqual([]);
  });
});

describe("toSymbolSettings", () => {
  const symbols = documented("ref-types-account__symbols.json");

  it("reads the effective margin mode and leverage for the symbol", () => {
    expect(toSymbolSettings(symbols, "BTC-USD")).toEqual({
      symbol: "BTC-USD",
      marginMode: "isolated",
      leverage: 5,
    });
  });

  it("falls back to the account defaults for a symbol with no stored setting", () => {
    expect(toSymbolSettings(symbols, "SOL-USD")).toEqual({
      symbol: "SOL-USD",
      marginMode: "cross",
      leverage: 10,
    });
  });
});

describe("fills", () => {
  const rows = toFillRows(documented("docs-user-history__fill-history.json"));

  it("reads fill rows with exact int64 identifiers", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orderId).toBe("9007199254740991");
  });

  it("joins a fill to the client order ID of its order", () => {
    const [row] = rows;
    if (row === undefined) {
      throw new Error("Expected one fill row");
    }
    expect(toExchangeFill(row, `cad-${intentId}-e`)).toEqual({
      fillId: "9007199254740997",
      orderId: "9007199254740991",
      clientOrderId: `cad-${intentId}-e`,
      symbol: "BTC-USD",
      side: "buy",
      price: "84482",
      size: "0.00012",
      fee: "0.00506892",
      filledAt: 1792603889015,
    });
  });

  it("reads a Go nil slice as no fills", () => {
    expect(toFillRows(parseStrikeJson('{"fills":null,"count":0}'))).toEqual([]);
  });
});

describe("acknowledgements", () => {
  it("reads a strategy acknowledgement", () => {
    expect(toStrategyAck(documented("ref-types-order__strategy-ack.json"), 5)).toEqual({
      strategyId: `cad-${intentId}`,
      entryClientOrderId: `cad-${intentId}-e`,
      accountId,
      acknowledgedAt: 5,
    });
  });

  it("reads an order acknowledgement", () => {
    expect(toOrderAck(documented("ref-types-order__order-ack.json"), 6)).toEqual({
      clientOrderId: `cad-${intentId}-r`,
      accountId,
      acknowledgedAt: 6,
    });
  });

  it("refuses a strategy acknowledgement with no primary client order ID", () => {
    const raw = parseStrikeJson(
      `{"strategy_id":"cad-${intentId}","account_id":"${accountId}","symbol":"BTC-USD"}`,
    );
    expect(() => toStrategyAck(raw, 0)).toThrow();
  });
});
