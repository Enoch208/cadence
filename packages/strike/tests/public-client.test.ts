import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StrikeReadError } from "../src/errors";
import { createPublicStrikeClient } from "../src/public-client";
import { fakeFetch, json, serverTimeReply, type RecordedRequest } from "./support/fake-fetch";
import { reply } from "./support/live";

const route = (request: RecordedRequest) => {
  switch (request.url.pathname) {
    case "/v2/time":
      return serverTimeReply(1792603881365);
    case "/v2/markets":
      return reply("mainnet-get-v2-markets.json");
    case "/price/v2/depth":
      return reply("mainnet-get-price-v2-depth-BTC-USD.json");
    case "/price/v2/markPrice":
      return json(
        200,
        '{"e":"markPriceUpdate","E":1792603883232,"s":"BTC-USD","p":"84491","i":"84505.51926278","r":"-0.0000429115734291358","T":1792605600000}',
      );
    case "/v2/fee-tiers":
      return reply("mainnet-get-v2-fee-tiers.json");
    default:
      return json(404, '{"error":"not found"}');
  }
};

function publicClient() {
  const fake = fakeFetch(route);
  const client = createPublicStrikeClient({
    baseUrl: "https://api.strikefinance.org",
    fetch: fake.fetch,
    timeoutMs: 1_000,
  });
  return { client, requests: fake.requests };
}

describe("createPublicStrikeClient", () => {
  it("reads time, markets, book, mark and fees from their public URLs", async () => {
    const { client, requests } = publicClient();
    const [serverTime, markets, book, mark, fees] = await Promise.all([
      client.serverTime(),
      client.markets(),
      client.book("BTC-USD", 20),
      client.mark("BTC-USD"),
      client.fees(),
    ]);
    expect(serverTime).toBe(1792603881365);
    expect(markets).toHaveLength(32);
    expect(book.bids[0]).toEqual(["84481", "0.01775"]);
    expect(mark.markPrice).toBe("84491");
    expect(fees).toEqual({ takerRate: "0.0005", makerRate: "-0.00005" });
    expect(requests.map((request) => `${request.method} ${request.url.href}`).sort()).toEqual([
      "GET https://api.strikefinance.org/price/v2/depth?symbol=BTC-USD&limit=20",
      "GET https://api.strikefinance.org/price/v2/markPrice?symbol=BTC-USD",
      "GET https://api.strikefinance.org/v2/fee-tiers",
      "GET https://api.strikefinance.org/v2/markets",
      "GET https://api.strikefinance.org/v2/time",
    ]);
  });

  it("never sends an API wallet header or a body", async () => {
    const { client, requests } = publicClient();
    await Promise.all([client.serverTime(), client.markets(), client.book("BTC-USD", 5)]);
    for (const request of requests) {
      const names = [...request.headers.keys()];
      expect(names.filter((name) => name.startsWith("x-api-wallet"))).toEqual([]);
      expect(request.body).toBe("");
    }
  });

  it("offers market data and nothing that reads an account or places an order", () => {
    const { client } = publicClient();
    expect(Object.keys(client).sort()).toEqual([
      "book",
      "environment",
      "fees",
      "mark",
      "markets",
      "serverTime",
    ]);
    expect(client.environment).toBe("live");
  });

  it("reports a failed read as a read error", async () => {
    const fake = fakeFetch(() => json(503, "{}"));
    const client = createPublicStrikeClient({
      baseUrl: "https://api.strikefinance.org",
      fetch: fake.fetch,
      timeoutMs: 1_000,
    });
    await expect(client.markets()).rejects.toBeInstanceOf(StrikeReadError);
  });

  it("has no path to a signer", () => {
    const source = readFileSync(new URL("../src/public-client.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/signer|authenticate|live-client|live-account/);
  });
});
