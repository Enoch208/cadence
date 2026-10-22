import type { DecimalString, Direction } from "./contract";
import { Exact } from "./exact";
import { ceilToGrid, floorToGrid } from "./grid";
import type { BookLevel, BookSnapshot, MarketRules, MarkSnapshot } from "./market";
import type { PublishedPlan } from "./plan";
import type { RiskPolicy } from "./policy";

const bpsToFraction = (bps: number) => new Exact(bps).dividedBy(10_000);

function bestLevelPrice(
  levels: readonly BookLevel[],
  isBetter: (candidate: DecimalString, current: DecimalString) => boolean,
): DecimalString | null {
  let best: DecimalString | null = null;
  for (const [price, size] of levels) {
    if (new Exact(size).greaterThan(0) && (best === null || isBetter(price, best))) {
      best = price;
    }
  }
  return best;
}

export const bestBid = (book: BookSnapshot) =>
  bestLevelPrice(book.bids, (candidate, current) => new Exact(candidate).greaterThan(current));

export const bestAsk = (book: BookSnapshot) =>
  bestLevelPrice(book.asks, (candidate, current) => new Exact(candidate).lessThan(current));

export const executablePrice = (direction: Direction, book: BookSnapshot) =>
  direction === "long" ? bestAsk(book) : bestBid(book);

export function adverseLimitPrice(args: {
  plan: PublishedPlan;
  book: BookSnapshot;
  market: MarketRules;
  policy: RiskPolicy;
}): DecimalString | null {
  const { plan, market } = args;
  const quote = executablePrice(plan.direction, args.book);
  if (quote === null) {
    return null;
  }
  const slippage = bpsToFraction(args.policy.maxEntrySlippageBps);
  if (plan.direction === "long") {
    const reach = Exact.min(plan.entryMax, slippage.plus(1).times(quote));
    const limit = floorToGrid(reach.toFixed(), market.minPrice, market.tickSize);
    return new Exact(limit).lessThan(quote) ? null : limit;
  }
  const reach = Exact.max(plan.entryMin, new Exact(1).minus(slippage).times(quote));
  const limit = ceilToGrid(reach.toFixed(), market.minPrice, market.tickSize);
  return new Exact(limit).greaterThan(quote) ? null : limit;
}

export function withinPriceBounds(args: {
  price: DecimalString;
  mark: MarkSnapshot;
  market: MarketRules;
}): boolean {
  const price = new Exact(args.price);
  const mark = new Exact(args.mark.markPrice);
  return (
    price.greaterThanOrEqualTo(args.market.minPrice) &&
    price.lessThanOrEqualTo(args.market.maxPrice) &&
    price.minus(mark).abs().lessThanOrEqualTo(mark.times(args.market.limitPriceBound))
  );
}

export function fillableSize(args: {
  direction: Direction;
  book: BookSnapshot;
  limitPrice: DecimalString;
}): DecimalString {
  const limit = new Exact(args.limitPrice);
  const levels = args.direction === "long" ? args.book.asks : args.book.bids;
  const reachable = levels.filter(([price]) =>
    args.direction === "long" ? limit.greaterThanOrEqualTo(price) : limit.lessThanOrEqualTo(price),
  );
  return reachable.reduce((total, [, size]) => total.plus(size), new Exact(0)).toFixed();
}
