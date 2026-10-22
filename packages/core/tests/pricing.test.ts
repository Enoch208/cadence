import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../src/market";
import type { PublishedPlan } from "../src/plan";
import {
  adverseLimitPrice,
  bestAsk,
  bestBid,
  executablePrice,
  fillableSize,
  withinPriceBounds,
} from "../src/pricing";
import {
  bookAround,
  btcUsdRules,
  capturedHourlyFundingRate,
  defaultPolicy,
  fixtureNow,
  longPlan,
  markAt,
  shortPlan,
} from "./fixtures/btc-usd";

const ladder: BookSnapshot = {
  symbol: "BTC-USD",
  bids: [
    ["84299", "0.004"],
    ["84290", "0.01"],
    ["84200", "0.5"],
  ],
  asks: [
    ["84300", "0.004"],
    ["84310", "0.01"],
    ["84500", "0.5"],
  ],
  exchangeTime: fixtureNow,
  observedAt: fixtureNow,
};

const limitFor = (plan: PublishedPlan, bid: string, ask: string) =>
  adverseLimitPrice({
    plan,
    book: bookAround(bid, ask, "1", fixtureNow),
    market: btcUsdRules,
    policy: defaultPolicy,
  });

const mark = (price: string) => markAt(price, fixtureNow, capturedHourlyFundingRate);

describe("best prices", () => {
  it("reads the best bid and ask", () => {
    expect(bestBid(ladder)).toBe("84299");
    expect(bestAsk(ladder)).toBe("84300");
  });

  it("finds the best level even when the levels arrive out of order", () => {
    const shuffled = {
      ...ladder,
      bids: [...ladder.bids].reverse(),
      asks: [...ladder.asks].reverse(),
    };
    expect(bestBid(shuffled)).toBe("84299");
    expect(bestAsk(shuffled)).toBe("84300");
  });

  it("ignores levels with nothing resting on them", () => {
    const emptied = { ...ladder, asks: [["84250", "0"], ...ladder.asks] as const };
    expect(bestAsk(emptied)).toBe("84300");
  });

  it("has no best price on an empty side", () => {
    const empty = { ...ladder, bids: [], asks: [] };
    expect(bestBid(empty)).toBeNull();
    expect(bestAsk(empty)).toBeNull();
  });

  it("executes a long at the ask and a short at the bid", () => {
    expect(executablePrice("long", ladder)).toBe("84300");
    expect(executablePrice("short", ladder)).toBe("84299");
  });
});

describe("adverseLimitPrice", () => {
  it("caps a long at the top of the entry range", () => {
    expect(limitFor(longPlan, "84299", "84300")).toBe("84400");
  });

  it("allows a long the slippage budget above the ask, floored to the tick", () => {
    expect(limitFor(longPlan, "84099", "84100")).toBe("84268");
  });

  it("caps a short at the bottom of the entry range", () => {
    expect(limitFor(shortPlan, "84100", "84101")).toBe("84000");
  });

  it("allows a short the slippage budget below the bid, ceiled to the tick", () => {
    expect(limitFor(shortPlan, "84300", "84301")).toBe("84132");
  });

  it("returns the ask above the range but no limit, so the caller blocks", () => {
    expect(executablePrice("long", bookAround("84499", "84500", "1", fixtureNow))).toBe("84500");
    expect(limitFor(longPlan, "84499", "84500")).toBeNull();
  });

  it("has no limit for a short whose bid is already below the range", () => {
    expect(limitFor(shortPlan, "83900", "83901")).toBeNull();
  });

  it("has no limit when the book side is empty", () => {
    const book = { ...bookAround("84299", "84300", "1", fixtureNow), asks: [] };
    expect(
      adverseLimitPrice({ plan: longPlan, book, market: btcUsdRules, policy: defaultPolicy }),
    ).toBeNull();
  });

  it("uses the ask itself when the policy allows no slippage", () => {
    const policy = { ...defaultPolicy, maxEntrySlippageBps: 0 };
    const book = bookAround("84199", "84200", "1", fixtureNow);
    expect(adverseLimitPrice({ plan: longPlan, book, market: btcUsdRules, policy })).toBe("84200");
  });
});

describe("withinPriceBounds", () => {
  it("accepts a price near the mark inside the market's range", () => {
    expect(withinPriceBounds({ price: "84400", mark: mark("84300"), market: btcUsdRules })).toBe(
      true,
    );
  });

  it("refuses a BTC price above Strike's order_max_price of 100000", () => {
    expect(withinPriceBounds({ price: "100000", mark: mark("100000"), market: btcUsdRules })).toBe(
      true,
    );
    expect(withinPriceBounds({ price: "100001", mark: mark("100000"), market: btcUsdRules })).toBe(
      false,
    );
  });

  it("refuses a price below order_min_price", () => {
    expect(withinPriceBounds({ price: "9", mark: mark("9"), market: btcUsdRules })).toBe(false);
  });

  it("refuses a price more than 5% from the mark, either side", () => {
    expect(withinPriceBounds({ price: "89040", mark: mark("84000"), market: btcUsdRules })).toBe(
      false,
    );
    expect(withinPriceBounds({ price: "79799", mark: mark("84000"), market: btcUsdRules })).toBe(
      false,
    );
  });

  it("accepts a price exactly 5% from the mark", () => {
    expect(withinPriceBounds({ price: "88200", mark: mark("84000"), market: btcUsdRules })).toBe(
      true,
    );
    expect(withinPriceBounds({ price: "79800", mark: mark("84000"), market: btcUsdRules })).toBe(
      true,
    );
  });
});

describe("fillableSize", () => {
  it("sums only the asks at or below a long's limit", () => {
    expect(fillableSize({ direction: "long", book: ladder, limitPrice: "84310" })).toBe("0.014");
    expect(fillableSize({ direction: "long", book: ladder, limitPrice: "84309" })).toBe("0.004");
  });

  it("sums only the bids at or above a short's limit", () => {
    expect(fillableSize({ direction: "short", book: ladder, limitPrice: "84290" })).toBe("0.014");
    expect(fillableSize({ direction: "short", book: ladder, limitPrice: "84200" })).toBe("0.514");
  });

  it("is zero when nothing rests within the limit", () => {
    expect(fillableSize({ direction: "long", book: ladder, limitPrice: "84299" })).toBe("0");
  });
});
