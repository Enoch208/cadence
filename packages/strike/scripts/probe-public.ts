import { createPublicStrikeClient } from "../src/public-client";
import { line, mainnetBaseUrl, probeSymbol, probeTimeoutMs, runProbe, show } from "./probe-support";

runProbe(async () => {
  const client = createPublicStrikeClient({
    baseUrl: mainnetBaseUrl,
    fetch,
    timeoutMs: probeTimeoutMs,
  });
  const sentAt = Date.now();
  const serverTime = await client.serverTime();
  const receivedAt = Date.now();
  const localAheadMs = Math.round((sentAt + receivedAt) / 2 - serverTime);
  const [markets, book, mark] = await Promise.all([
    client.markets(),
    client.book(probeSymbol, 5),
    client.mark(probeSymbol),
  ]);
  const rules = markets.find((market) => market.symbol === probeSymbol);
  if (rules === undefined) {
    throw new Error(`Strike lists no ${probeSymbol} market`);
  }
  const { marginTiers, ...limits } = rules;
  const trading = markets.filter((market) => market.status === "trading").length;

  line(`Strike mainnet public probe (unsigned GETs only) at ${new Date(serverTime).toISOString()}`);
  line(
    `GET /v2/time: serverTime ${String(serverTime)}, round trip ${String(receivedAt - sentAt)} ms`,
  );
  line(
    `Local clock is ${String(Math.abs(localAheadMs))} ms ${localAheadMs >= 0 ? "ahead of" : "behind"} Strike`,
  );
  line(`GET /v2/markets: ${String(markets.length)} markets, ${String(trading)} trading`);
  show(`${probeSymbol} rules`, limits);
  const [first] = marginTiers;
  line(
    `${probeSymbol} margin tiers: ${String(marginTiers.length)}; tier 1 up to ${first?.maxNotional ?? "?"} notional at ${String(first?.maxLeverage ?? "?")}x, MMR ${first?.maintenanceMarginRate ?? "?"}`,
  );
  const levels = (side: readonly (readonly [string, string])[]) =>
    side
      .slice(0, 3)
      .map(([price, size]) => `${price} x ${size}`)
      .join(" | ");
  line(`${probeSymbol} book top (GET /price/v2/depth, limit 5):`);
  line(`  bids ${levels(book.bids)}`);
  line(`  asks ${levels(book.asks)}`);
  line(
    `  exchangeTime ${String(book.exchangeTime)}, observedAt ${String(book.observedAt)} (local)`,
  );
  show(`${probeSymbol} mark (GET /price/v2/markPrice)`, mark);
});
