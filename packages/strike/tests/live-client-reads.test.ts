import { describe, expect, it } from "vitest";
import { StrikeReadError } from "../src/errors";
import { json } from "./support/fake-fetch";
import { fixtureText } from "./support/fixtures";
import { liveHarness, reply } from "./support/live";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";
const entryId = `cad-${intentId}-e`;

const accountHarness = () =>
  liveHarness((request) => {
    switch (request.url.pathname) {
      case "/v2/account":
        return reply("documented/ref-types-account__account.json");
      case "/v2/positions":
        return reply("documented/ref-types-position__positions.json");
      case "/v2/openOrders":
        return reply("documented/ref-types-order__open-orders.json");
      case "/v2/symbols":
        return reply("documented/ref-types-account__symbols.json");
      default:
        return json(500, "{}");
    }
  });

describe("signed reads", () => {
  it("queries an order by symbol and client order ID with all four auth headers", async () => {
    const harness = liveHarness(() =>
      reply("documented/docs-trade-orders__order-primary-filled.json"),
    );
    const order = await harness.client.order("BTC-USD", entryId);
    const [request] = harness.exchange();
    if (request === undefined) {
      throw new Error("Expected one exchange request");
    }
    expect(request.method).toBe("GET");
    expect(request.url.href).toBe(
      `https://api.strikefinance.org/v2/order?symbol=BTC-USD&client_order_id=${entryId}`,
    );
    expect(request.headers.get("x-api-wallet-public-key")).toBe(harness.keys.publicKeyHex);
    expect(request.headers.get("x-api-wallet-signature")).toMatch(/^[0-9a-f]{128}$/);
    expect(request.headers.get("x-api-wallet-timestamp")).toMatch(/^\d+$/);
    expect(request.headers.get("x-api-wallet-nonce")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(harness.signatureVerifies(request)).toBe(true);
    expect(order?.clientOrderId).toBe(entryId);
  });

  it("syncs the clock first, so a local clock 1.45 s ahead never signs in the future", async () => {
    const harness = liveHarness(() =>
      reply("documented/docs-trade-orders__order-primary-filled.json"),
    );
    await harness.client.order("BTC-USD", entryId);
    expect(harness.requests[0]?.url.pathname).toBe("/v2/time");
    expect(harness.exchange().every((request) => !harness.signedAheadOfServer(request))).toBe(true);
  });

  it("syncs once for reads that start together, and again only when the sample is old", async () => {
    const harness = accountHarness();
    await Promise.all([harness.client.openOrders(null), harness.client.openOrders("BTC-USD")]);
    const syncs = () => harness.requests.filter((request) => request.url.pathname === "/v2/time");
    expect(syncs()).toHaveLength(1);
    await harness.client.openOrders("BTC-USD");
    expect(syncs()).toHaveLength(1);
    harness.advance(5 * 60_000);
    await harness.client.openOrders("BTC-USD");
    expect(syncs()).toHaveLength(2);
  });

  it("finds no order when Strike answers 404", async () => {
    const harness = liveHarness(() => json(404, '{"error":"order not found"}'));
    await expect(harness.client.order("BTC-USD", entryId)).resolves.toBeNull();
  });

  it("refuses an answer about a different client order ID", async () => {
    const harness = liveHarness(() =>
      reply("documented/docs-trade-orders__order-primary-filled.json"),
    );
    await expect(harness.client.order("BTC-USD", `cad-${intentId}-s`)).rejects.toBeInstanceOf(
      StrikeReadError,
    );
  });

  it("composes the account state from account, positions, open orders and symbol settings", async () => {
    const harness = accountHarness();
    const state = await harness.client.accountState("BTC-USD");
    expect(state.account).toMatchObject({
      accountId: "5f0c1a7e-3b2d-4c8e-9f1a-2d3c4b5a6e7f",
      environment: "live",
      availableBalance: "22.96",
    });
    expect(state.positions.map((position) => position.signedSize)).toEqual(["0.00012"]);
    expect(state.openOrders.map((order) => order.clientOrderId)).toEqual([
      `cad-${intentId}-s`,
      `cad-${intentId}-t`,
    ]);
    expect(state.symbolSettings).toEqual({
      symbol: "BTC-USD",
      marginMode: "isolated",
      leverage: 5,
    });
    const paths = harness
      .exchange()
      .map((request) => `${request.url.pathname}${request.url.search}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v2/account",
        "/v2/positions?symbol=BTC-USD",
        "/v2/openOrders?symbol=BTC-USD",
        "/v2/symbols",
      ]),
    );
    expect(harness.exchange().every(harness.signatureVerifies)).toBe(true);
  });

  it("dates the account state from the earliest of its reads", async () => {
    const harness = accountHarness();
    const state = await harness.client.accountState("BTC-USD");
    const reads = harness.exchange();
    expect(reads).toHaveLength(4);
    expect(state.account.observedAt).toBe(Math.min(...reads.map(harness.sentAt)));
  });

  it("keeps only the requested symbol even if Strike ignores the filter", async () => {
    const ethPosition =
      '{"symbol":"ETH-USD","size":"-0.5","entry_price":"3000","margin_mode":"cross","leverage":20,"liquidation_price":"3500"}';
    const ethOrder =
      '{"ID":5,"ClientOrderID":"manual","Symbol":"ETH-USD","Side":"sell","Status":"open","Type":"limit","Size":"0.5","Filled":"0","Price":"3100","StopPrice":"0","ReduceOnly":false,"CloseReason":""}';
    const harness = liveHarness((request) =>
      request.url.pathname === "/v2/account"
        ? reply("documented/ref-types-account__account.json")
        : request.url.pathname === "/v2/positions"
          ? json(200, `{"positions":[${ethPosition}],"count":1}`)
          : request.url.pathname === "/v2/openOrders"
            ? json(200, `{"orders":[${ethOrder}],"count":1}`)
            : reply("documented/ref-types-account__symbols.json"),
    );
    const state = await harness.client.accountState("BTC-USD");
    expect(state.positions).toEqual([]);
    expect(state.openOrders).toEqual([]);
  });

  it("reads Go nil slices as an account with no positions and no open orders", async () => {
    const harness = liveHarness((request) =>
      request.url.pathname === "/v2/account"
        ? reply("documented/ref-types-account__account.json")
        : request.url.pathname === "/v2/positions"
          ? json(200, '{"positions":null,"count":0}')
          : request.url.pathname === "/v2/openOrders"
            ? json(200, '{"orders":null,"count":0}')
            : reply("documented/ref-types-account__symbols.json"),
    );
    const state = await harness.client.accountState("BTC-USD");
    expect(state.positions).toEqual([]);
    expect(state.openOrders).toEqual([]);
  });

  it("joins each fill to its order's client order ID", async () => {
    const harness = liveHarness((request) =>
      request.url.pathname === "/v2/history/fill"
        ? reply("documented/docs-user-history__fill-history.json")
        : reply("documented/docs-trade-orders__order-primary-filled.json"),
    );
    const fills = await harness.client.fills("BTC-USD", 1792603880000);
    expect(fills).toEqual([
      expect.objectContaining({
        fillId: "9007199254740997",
        clientOrderId: entryId,
        fee: "0.00506892",
      }),
    ]);
    const paths = harness
      .exchange()
      .map((request) => `${request.url.pathname}${request.url.search}`);
    expect(paths).toEqual([
      "/v2/history/fill?symbol=BTC-USD&startTime=1792603880000&limit=1000",
      "/v2/order?symbol=BTC-USD&order_id=9007199254740991",
    ]);
  });

  it("keeps a fill whose order Strike no longer serves, with no client order ID", async () => {
    const harness = liveHarness((request) =>
      request.url.pathname === "/v2/history/fill"
        ? reply("mainnet-get-v2-history-fill-fok-entry.json")
        : json(404, '{"error":"order not found"}'),
    );
    const fills = await harness.client.fills("BTC-USD", 1792723200000);
    expect(fills).toEqual([
      {
        fillId: "4499429",
        orderId: "11516191287",
        clientOrderId: null,
        symbol: "BTC-USD",
        side: "buy",
        price: "81742.000000000000000000",
        size: "0.000300000000000000",
        fee: "0.012261300000000000",
        filledAt: 1792723254464,
      },
    ]);
  });

  it("refuses to truncate when a whole page of fills comes back", async () => {
    const row = JSON.parse(fixtureText("documented/docs-user-history__fill-history.json")) as {
      fills: unknown[];
    };
    const page = JSON.stringify({
      fills: Array.from({ length: 1000 }, () => row.fills[0]),
      count: 1000,
    });
    const harness = liveHarness(() => json(200, page));
    await expect(harness.client.fills("BTC-USD", 0)).rejects.toThrow("one page");
  });
});

describe("public reads", () => {
  it("reads markets, book, mark and fees unsigned", async () => {
    const harness = liveHarness((request) => {
      switch (request.url.pathname) {
        case "/v2/markets":
          return reply("mainnet-get-v2-markets.json");
        case "/price/v2/depth":
          return reply("mainnet-get-price-v2-depth-BTC-USD.json");
        case "/price/v2/markPrice":
          return json(
            200,
            '{"e":"markPriceUpdate","E":1792603883232,"s":"BTC-USD","p":"84491","i":"84505.51926278","r":"-0.0000429115734291358","T":1792605600000}',
          );
        default:
          return reply("mainnet-get-v2-fee-tiers.json");
      }
    });
    const [markets, book, mark, fees] = await Promise.all([
      harness.client.markets(),
      harness.client.book("BTC-USD", 50),
      harness.client.mark("BTC-USD"),
      harness.client.fees(),
    ]);
    expect(markets).toHaveLength(32);
    expect(book.asks[0]).toEqual(["84482", "0.01775"]);
    expect(mark.markPrice).toBe("84491");
    expect(fees).toEqual({ takerRate: "0.0005", makerRate: "-0.00005" });
    expect(harness.requests.map((request) => request.url.href).sort()).toEqual([
      "https://api.strikefinance.org/price/v2/depth?symbol=BTC-USD&limit=50",
      "https://api.strikefinance.org/price/v2/markPrice?symbol=BTC-USD",
      "https://api.strikefinance.org/v2/fee-tiers",
      "https://api.strikefinance.org/v2/markets",
    ]);
    expect(harness.requests.some((request) => request.headers.has("x-api-wallet-signature"))).toBe(
      false,
    );
  });

  it("refuses a mark price for a different symbol", async () => {
    const harness = liveHarness(() =>
      json(200, '{"e":"markPriceUpdate","E":1,"s":"ETH-USD","p":"3000","i":"3000","r":"0","T":2}'),
    );
    await expect(harness.client.mark("BTC-USD")).rejects.toBeInstanceOf(StrikeReadError);
  });

  it("refuses a malformed public response as a read error", async () => {
    const harness = liveHarness(() => json(200, '{"markets":{"BTC-USD":{"symbol":"BTC-USD"}}}'));
    await expect(harness.client.markets()).rejects.toBeInstanceOf(StrikeReadError);
  });

  it("reads the server time and signs with it without syncing again", async () => {
    const harness = accountHarness();
    const serverTime = await harness.client.serverTime();
    expect(serverTime).toBe(harness.now() - 1_450);
    await harness.client.openOrders("BTC-USD");
    const syncs = harness.requests.filter((request) => request.url.pathname === "/v2/time");
    expect(syncs).toHaveLength(1);
  });
});
