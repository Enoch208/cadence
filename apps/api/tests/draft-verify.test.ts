import { describe, expect, it } from "vitest";
import type { Setup } from "../src/drafting/contract";
import { draftKeys, verifySetup } from "../src/drafting/verify";

const message = `BTC long 🚀
Entry 84,000 - 84,500
SL 83,200
TP1 86.5k   TP2 88k
Valid 4h. Reclaimed the weekly open, funding flat.`;

const blank: Setup = {
  isTradeSetup: true,
  market: null,
  direction: null,
  entryMin: null,
  entryMax: null,
  stopPrice: null,
  targetPrice: null,
  entryWindowMinutes: null,
  rationale: null,
};

const context = {
  text: message,
  markets: ["BTC-USD", "ETH-USD"],
  now: Date.parse("2026-10-22T12:00:30Z"),
};

const verify = (overrides: Partial<Setup>, text = message) =>
  verifySetup({ ...blank, ...overrides }, { ...context, text });

const quote = (value: string, source: string) => ({ value, quote: source });

describe("verifying a setup read from a curator's message", () => {
  it("keeps every value whose quote is in the message and states it", () => {
    const rationale = "Reclaimed the weekly open, funding flat.";
    expect(
      verify({
        market: quote("BTC-USD", "BTC long"),
        direction: quote("long", "BTC long"),
        entryMin: quote("84000", "Entry 84,000 - 84,500"),
        entryMax: quote("84500", "Entry 84,000 - 84,500"),
        stopPrice: quote("83200", "SL 83,200"),
        targetPrice: quote("86500", "TP1 86.5k"),
        entryWindowMinutes: quote("240", "Valid 4h"),
        rationale: quote("The weekly open was reclaimed", rationale),
      }),
    ).toEqual({
      filled: {
        market: quote("BTC-USD", "BTC long"),
        direction: quote("long", "BTC long"),
        entryMin: quote("84000", "Entry 84,000 - 84,500"),
        entryMax: quote("84500", "Entry 84,000 - 84,500"),
        stopPrice: quote("83200", "SL 83,200"),
        targetPrice: quote("86500", "TP1 86.5k"),
        entryExpiresAt: quote("2026-10-22T16:00:00Z", "Valid 4h"),
        rationale: quote(rationale, rationale),
      },
      missing: [],
    });
  });

  it("lists every field the message does not state as missing", () => {
    expect(verify({})).toEqual({ filled: {}, missing: [...draftKeys] });
  });

  it("drops a value whose quote is not in the message", () => {
    expect(verify({ stopPrice: quote("83000", "SL 83,000") })).toMatchObject({
      filled: {},
      missing: expect.arrayContaining(["stopPrice"]) as unknown,
    });
  });

  it.each([
    ["a stop the quote does not state", { stopPrice: quote("83000", "SL 83,200") }],
    ["a target read from the wrong thousands", { targetPrice: quote("865", "TP1 86.5k") }],
    ["a price that is not a plain decimal", { entryMin: quote("84000 USD", "Entry 84,000") }],
    ["a market Strike does not list", { market: quote("SOL-USD", "BTC long") }],
    ["a direction other than long or short", { direction: quote("buy", "BTC long") }],
    ["an empty quote", { direction: quote("long", " ") }],
    ["an entry window of no time", { entryWindowMinutes: quote("0", "Valid 4h") }],
    ["an entry window over seven days", { entryWindowMinutes: quote("10081", "Valid 4h") }],
    ["an entry window in part minutes", { entryWindowMinutes: quote("4.5", "Valid 4h") }],
  ])("drops %s", (_, overrides) => {
    expect(verify(overrides).filled).toEqual({});
  });

  it("matches a quote across spacing and line breaks and returns it tidied", () => {
    expect(verify({ entryMax: quote("84500", "84,500\n   SL") }).filled).toEqual({
      entryMax: quote("84500", "84,500 SL"),
    });
  });

  it("writes prices without separators or trailing zeros", () => {
    expect(
      verify({
        entryMin: quote("84,000.0", "Entry 84,000"),
        targetPrice: quote("88000", "TP2 88k"),
      }).filled,
    ).toEqual({ entryMin: quote("84000", "Entry 84,000"), targetPrice: quote("88000", "TP2 88k") });
  });

  it("names the market and direction however the curator spelled them", () => {
    expect(
      verify({ market: quote("btc-usd", "BTC long"), direction: quote("Long", "BTC long") }).filled,
    ).toEqual({ market: quote("BTC-USD", "BTC long"), direction: quote("long", "BTC long") });
  });

  it("drops a rationale longer than a plan can hold", () => {
    const long = `ETH short. ${"Lower highs on the daily. ".repeat(90)}`;
    expect(verify({ rationale: quote("", long.trim()) }, long).filled).toEqual({});
  });
});
