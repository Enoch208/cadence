import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { StrategyOrder } from "../src/client";
import { StrikeAmbiguousError, StrikeRejectedError } from "../src/errors";
import { strategyRequestBody } from "../src/orders";
import { json, type RecordedRequest, type Reply } from "./support/fake-fetch";
import { keyRenderings } from "./support/keys";
import { liveHarness, reply } from "./support/live";

const intentId = "0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";
const order: StrategyOrder = {
  strategyId: `cad-${intentId}`,
  entryClientOrderId: `cad-${intentId}-e`,
  stopClientOrderId: `cad-${intentId}-s`,
  targetClientOrderId: `cad-${intentId}-t`,
  symbol: "BTC-USD",
  side: "buy",
  size: "0.00012",
  limitPrice: "84482",
  stopPrice: "83200",
  targetPrice: "86800",
  builderFeeBps: null,
};

const failure = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("Expected the call to fail with an Error");
};

const onlyRequest = (requests: readonly RecordedRequest[]): RecordedRequest => {
  const [request, ...rest] = requests;
  if (request === undefined || rest.length > 0) {
    throw new Error(`Expected exactly one exchange request, saw ${String(requests.length)}`);
  }
  return request;
};

describe("placeStrategy", () => {
  it("posts the strategy body it signed, byte for byte", async () => {
    const harness = liveHarness(() => reply("documented/ref-types-order__strategy-ack.json", 201));
    const ack = await harness.client.placeStrategy(order);
    const request = onlyRequest(harness.exchange());
    expect(request.method).toBe("POST");
    expect(request.url.href).toBe("https://api.strikefinance.org/v2/order/strategy");
    expect(request.body).toBe(JSON.stringify(strategyRequestBody(order)));
    expect(harness.signatureVerifies(request)).toBe(true);
    expect(harness.signatureVerifies({ ...request, body: `${request.body} ` })).toBe(false);
    expect(ack).toMatchObject({
      strategyId: order.strategyId,
      entryClientOrderId: order.entryClientOrderId,
      accountId: "5f0c1a7e-3b2d-4c8e-9f1a-2d3c4b5a6e7f",
    });
  });

  it("attaches a curator fee as the unsigned X-Builder-Fee-Bps header, only when asked", async () => {
    const plain = liveHarness(() => reply("documented/ref-types-order__strategy-ack.json", 201));
    await plain.client.placeStrategy(order);
    expect(onlyRequest(plain.exchange()).headers.has("x-builder-fee-bps")).toBe(false);

    const charged = liveHarness(() => reply("documented/ref-types-order__strategy-ack.json", 201));
    await charged.client.placeStrategy({ ...order, builderFeeBps: 5 });
    const request = onlyRequest(charged.exchange());
    expect(request.headers.get("x-builder-fee-bps")).toBe("5");
    expect(request.body).toBe(JSON.stringify(strategyRequestBody(order)));
    expect(charged.signatureVerifies(request)).toBe(true);
  });

  it("sends nothing for a builder fee Strike would never accept", async () => {
    const harness = liveHarness(() => reply("documented/ref-types-order__strategy-ack.json", 201));
    for (const builderFeeBps of [0, 101, 2.5]) {
      await expect(harness.client.placeStrategy({ ...order, builderFeeBps })).rejects.toThrow(
        RangeError,
      );
    }
    expect(harness.requests).toHaveLength(0);
  });

  it("is rejected when Strike refuses the order with a 400", async () => {
    const harness = liveHarness(() =>
      json(400, '{"error":"invalid secondary order","code":"invalid_secondary_order"}'),
    );
    const error = await failure(harness.client.placeStrategy(order));
    expect(error).toBeInstanceOf(StrikeRejectedError);
    expect(error).toMatchObject({ status: 400, code: "invalid_secondary_order" });
  });

  it("is ambiguous when the request is aborted before Strike answers", async () => {
    const harness = liveHarness(() => "hang");
    await expect(harness.client.placeStrategy(order)).rejects.toBeInstanceOf(StrikeAmbiguousError);
    expect(harness.exchange()).toHaveLength(1);
  });

  it.each([
    [
      "strategy",
      `"strategy_id":"cad-other","primary_client_order_id":"${order.entryClientOrderId}"`,
    ],
    [
      "primary order",
      `"strategy_id":"${order.strategyId}","primary_client_order_id":"cad-other-e"`,
    ],
  ])("is ambiguous when Strike acknowledges a different %s", async (_label, ids) => {
    const harness = liveHarness(() => json(201, `{${ids},"account_id":"a","symbol":"BTC-USD"}`));
    await expect(harness.client.placeStrategy(order)).rejects.toBeInstanceOf(StrikeAmbiguousError);
  });

  it("is ambiguous when the acknowledgement cannot be read", async () => {
    const harness = liveHarness(() => json(201, '{"status":"pending"}'));
    await expect(harness.client.placeStrategy(order)).rejects.toBeInstanceOf(StrikeAmbiguousError);
  });

  it("sends nothing for exits on the wrong side of the entry", async () => {
    const harness = liveHarness(() => reply("documented/ref-types-order__strategy-ack.json", 201));
    await expect(harness.client.placeStrategy({ ...order, stopPrice: "85000" })).rejects.toThrow(
      "The exits are on the wrong side of the entry",
    );
    expect(harness.requests).toHaveLength(0);
  });
});

describe("cancel and close", () => {
  it("cancels by client order ID with a signed JSON body", async () => {
    const harness = liveHarness(() =>
      json(200, '{"order_id":9007199254740991,"symbol":"BTC-USD","message_id":"m"}'),
    );
    await harness.client.cancel("BTC-USD", order.entryClientOrderId);
    const request = onlyRequest(harness.exchange());
    expect(request.method).toBe("DELETE");
    expect(request.url.href).toBe("https://api.strikefinance.org/v2/order/cancel");
    expect(request.body).toBe(
      `{"symbol":"BTC-USD","client_order_id":"${order.entryClientOrderId}"}`,
    );
    expect(harness.signatureVerifies(request)).toBe(true);
  });

  it("closes with a signed reduce-only market order", async () => {
    const harness = liveHarness(() => reply("documented/ref-types-order__order-ack.json", 201));
    const ack = await harness.client.closeReduceOnly({
      clientOrderId: `cad-${intentId}-r`,
      symbol: "BTC-USD",
      side: "sell",
      size: "0.00012",
    });
    const request = onlyRequest(harness.exchange());
    expect(request.url.pathname).toBe("/v2/order");
    expect(JSON.parse(request.body)).toEqual({
      client_order_id: `cad-${intentId}-r`,
      symbol: "BTC-USD",
      side: "sell",
      type: "market",
      size: "0.00012",
      reduce_only: true,
    });
    expect(harness.signatureVerifies(request)).toBe(true);
    expect(ack.clientOrderId).toBe(`cad-${intentId}-r`);
  });
});

describe("configureSymbol", () => {
  const symbolsWith = (marginMode: string, leverage: number): Reply =>
    json(
      200,
      `{"default_margin_mode":"cross","default_leverage":10,"symbol_settings":{"BTC-USD":{"margin_mode":"${marginMode}","leverage":${String(leverage)}}}}`,
    );
  const routes = (current: Reply) => (request: RecordedRequest) =>
    request.url.pathname === "/v2/symbols"
      ? current
      : request.url.pathname === "/v2/marginMode"
        ? json(200, '{"marginMode":"isolated","symbol":"BTC-USD"}')
        : json(
            200,
            '{"leverage":5,"maxNotionalValue":"50000","symbol":"BTC-USD","request_id":"r"}',
          );

  it("switches to isolated margin and sets the leverage when both differ", async () => {
    const harness = liveHarness(routes(symbolsWith("cross", 10)));
    await harness.client.configureSymbol("BTC-USD", { marginMode: "isolated", leverage: 5 });
    const writes = harness.exchange().filter((request) => request.method === "POST");
    expect(writes.map((request) => [request.url.pathname, request.body])).toEqual([
      ["/v2/marginMode", '{"symbol":"BTC-USD","marginMode":"isolated"}'],
      ["/v2/leverage", '{"symbol":"BTC-USD","leverage":5}'],
    ]);
    expect(writes.every(harness.signatureVerifies)).toBe(true);
  });

  it("writes nothing when the symbol is already configured", async () => {
    const harness = liveHarness(routes(symbolsWith("isolated", 5)));
    await harness.client.configureSymbol("BTC-USD", { marginMode: "isolated", leverage: 5 });
    expect(harness.exchange().filter((request) => request.method === "POST")).toEqual([]);
  });

  it.each([0, 126, 2.5])("refuses leverage %s before sending anything", async (leverage) => {
    const harness = liveHarness(routes(symbolsWith("cross", 10)));
    await expect(
      harness.client.configureSymbol("BTC-USD", { marginMode: "isolated", leverage }),
    ).rejects.toThrow(RangeError);
    expect(harness.requests).toHaveLength(0);
  });
});

describe("the private key never leaves the live client", () => {
  it("is absent from every request, every error and the client itself", async () => {
    const replies: Reply[] = [
      json(400, '{"error":"bad"}'),
      json(500, "{}"),
      json(401, '{"error":"authentication failed"}'),
      new TypeError("fetch failed"),
      "hang",
    ];
    for (const failingReply of replies) {
      const harness = liveHarness(() => failingReply);
      const errors = await Promise.all([
        failure(harness.client.placeStrategy(order)),
        failure(harness.client.cancel("BTC-USD", order.entryClientOrderId)),
        failure(harness.client.accountState("BTC-USD")),
      ]);
      const renderings = [
        ...errors.map((error) => inspect(error, { depth: Infinity, showHidden: true })),
        ...harness.requests.map((request) =>
          JSON.stringify({
            url: request.url.href,
            body: request.body,
            headers: [...request.headers],
          }),
        ),
        inspect(harness.client, { depth: Infinity, showHidden: true }),
        JSON.stringify(harness.client),
      ];
      for (const rendering of renderings) {
        for (const secret of keyRenderings(harness.keys.privateKeyHex)) {
          expect(rendering).not.toContain(secret);
        }
      }
    }
  });
});
