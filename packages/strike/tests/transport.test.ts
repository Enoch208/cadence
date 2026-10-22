import { describe, expect, it } from "vitest";
import {
  StrikeAmbiguousError,
  StrikeRateLimitedError,
  StrikeReadError,
  StrikeRejectedError,
} from "../src/errors";
import { createTransport, type TransportRequest } from "../src/transport";
import { fakeFetch, json, type Reply } from "./support/fake-fetch";

const baseUrl = "https://api.strikefinance.org";
const tick = (() => {
  let now = 1_000;
  return () => (now += 5);
})();

function transportReplying(reply: Reply, timeoutMs = 1_000) {
  const fake = fakeFetch(() => reply);
  const transport = createTransport({ baseUrl, fetch: fake.fetch, timeoutMs, now: tick });
  return { transport, requests: fake.requests };
}

const write: TransportRequest = {
  operation: "placeStrategy",
  kind: "write",
  method: "POST",
  path: "/v2/order/strategy",
  body: { strategy_id: "cad-1", size: "0.00012" },
};

const read: TransportRequest = {
  operation: "markets",
  kind: "read",
  method: "GET",
  path: "/v2/markets",
};

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the request to fail");
};

describe("requests", () => {
  it("sends a fixed path with its query on the configured origin", async () => {
    const { transport, requests } = transportReplying(json(200, "{}"));
    await transport.send({
      ...read,
      path: "/price/v2/depth",
      query: [
        ["symbol", "BTC-USD"],
        ["limit", "50"],
      ],
    });
    expect(requests[0]?.url.href).toBe(
      "https://api.strikefinance.org/price/v2/depth?symbol=BTC-USD&limit=50",
    );
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("accept")).toBe("application/json");
    expect(requests[0]?.headers.has("x-api-wallet-signature")).toBe(false);
    expect(requests[0]?.body).toBe("");
  });

  it("serializes the body once and sends exactly that string as JSON", async () => {
    const { transport, requests } = transportReplying(json(201, "{}"));
    await transport.send(write);
    expect(requests[0]?.body).toBe('{"strategy_id":"cad-1","size":"0.00012"}');
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("returns the parsed body with when it was sent and received", async () => {
    const { transport } = transportReplying(json(200, '{"serverTime":1792603881365}'));
    const reply = await transport.send({ ...read, path: "/v2/time" });
    expect(reply.body).toEqual({ serverTime: expect.anything() as unknown });
    expect(reply.receivedAt).toBeGreaterThan(reply.sentAt);
  });

  it("refuses to sign without an authenticator", async () => {
    const { transport, requests } = transportReplying(json(200, "{}"));
    await expect(transport.send({ ...read, signed: true })).rejects.toThrow(
      "This transport cannot sign requests",
    );
    expect(requests).toHaveLength(0);
  });

  it.each(["http://api.strikefinance.org", "https://api.strikefinance.org/v2", "not a url"])(
    "refuses the base URL %s",
    (url) => {
      expect(() =>
        createTransport({
          baseUrl: url,
          fetch: fakeFetch(() => "hang").fetch,
          timeoutMs: 1,
          now: tick,
        }),
      ).toThrow("The Strike base URL must be an https origin");
    },
  );
});

describe("a write Strike definitively refused", () => {
  it("is rejected with Strike's status, code and message", async () => {
    const { transport } = transportReplying(
      json(400, '{"error":"invalid stop price","code":"invalid_stop_price"}'),
    );
    const error = await rejection(transport.send(write));
    expect(error).toBeInstanceOf(StrikeRejectedError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_stop_price",
      strikeMessage: "invalid stop price",
    });
    expect((error as Error).message).toContain("invalid stop price");
  });

  it.each([401, 403, 404, 409, 422])("is rejected on HTTP %s", async (status) => {
    const { transport } = transportReplying(json(status, '{"error":"no"}'));
    await expect(transport.send(write)).rejects.toBeInstanceOf(StrikeRejectedError);
  });

  it("is rate limited, not rejected, on HTTP 429", async () => {
    const { transport } = transportReplying(json(429, '{"error":"rate limit exceeded"}'));
    await expect(transport.send(write)).rejects.toBeInstanceOf(StrikeRateLimitedError);
  });
});

describe("a write whose outcome is unknown", () => {
  it.each<[string, Reply]>([
    ["a server error", json(500, '{"error":"internal"}')],
    ["a bad gateway page", new Response("<html>502</html>", { status: 502 })],
    ["a request timeout", json(408, "{}")],
    ["a redirect", new Response(null, { status: 302, headers: { location: "/elsewhere" } })],
    ["an acknowledgement that is not JSON", new Response("ok", { status: 201 })],
    ["a lost connection", new TypeError("fetch failed")],
    ["a replayed nonce", json(401, '{"error":"nonce already used"}')],
  ])("is ambiguous after %s", async (_label, reply) => {
    const { transport } = transportReplying(reply);
    await expect(transport.send(write)).rejects.toBeInstanceOf(StrikeAmbiguousError);
  });

  it("is ambiguous when Strike does not answer before the timeout", async () => {
    const { transport } = transportReplying("hang", 20);
    const error = await rejection(transport.send(write));
    expect(error).toBeInstanceOf(StrikeAmbiguousError);
    expect((error as Error).message).toContain("placeStrategy");
  });
});

describe("a read that fails", () => {
  it.each<[string, Reply]>([
    ["a client error", json(400, '{"error":"bad symbol"}')],
    ["a rate limit", json(429, '{"error":"rate limit exceeded"}')],
    ["a server error", json(503, "")],
    ["a body that is not JSON", new Response("<html/>", { status: 200 })],
    ["a lost connection", new TypeError("fetch failed")],
    ["an unexpected 404", json(404, '{"error":"not found"}')],
  ])("is a read error after %s", async (_label, reply) => {
    const { transport } = transportReplying(reply);
    const error = await rejection(transport.send(read));
    expect(error).toBeInstanceOf(StrikeReadError);
  });

  it("is a read error on timeout", async () => {
    const { transport } = transportReplying("hang", 20);
    await expect(transport.send(read)).rejects.toBeInstanceOf(StrikeReadError);
  });

  it("finds nothing, rather than failing, when a lookup answers 404", async () => {
    const { transport } = transportReplying(json(404, '{"error":"order not found"}'));
    await expect(transport.find(read)).resolves.toBeNull();
  });

  it("does not read a 404 that is not Strike's own answer as an absent order", async () => {
    const { transport } = transportReplying(
      new Response("<html>Not Found</html>", { status: 404 }),
    );
    await expect(transport.find(read)).rejects.toBeInstanceOf(StrikeReadError);
  });
});

describe("error messages", () => {
  it("keep Strike's message short and never carry request headers", async () => {
    const { transport } = transportReplying(
      json(400, JSON.stringify({ error: "x".repeat(5_000) })),
    );
    const error = await rejection(transport.send(write));
    expect((error as Error).message.length).toBeLessThan(400);
    expect((error as Error).message).not.toContain("X-API-Wallet");
  });
});
