import { Decimal } from "decimal.js";
import type { BookLevel, BookSnapshot } from "../../src/market";
import { directions, type Direction } from "../../src/contract";
import type { DecisionInput } from "../../src/decision";
import { publishedPlanSchema, type PublishedPlan } from "../../src/plan";
import { riskPolicySchema } from "../../src/policy";
import type { Random } from "../support/random";
import { btcUsdRules, fixtureNow, isolatedSettings, longPlan, markAt } from "./btc-usd";
import { openPosition } from "./decision";

export const units = (count: number, unit: string) => new Decimal(unit).times(count).toFixed();

const shifted = (price: Decimal.Value, by: number) => new Decimal(price).plus(by).toFixed();

export type Profile = { direction?: Direction; proportionalCosts: boolean };

function generatedPlan(random: Random, direction: Direction): PublishedPlan {
  const entryMin = new Decimal(60_000).plus(random.integer(0, 30_000));
  const entryMax = entryMin.plus(random.integer(0, 600));
  const stopDistance = random.integer(150, 3_000);
  const targetDistance = random.integer(300, 9_000);
  return publishedPlanSchema.parse({
    ...longPlan,
    direction,
    entryMin: entryMin.toFixed(),
    entryMax: entryMax.toFixed(),
    stopPrice:
      direction === "long" ? shifted(entryMin, -stopDistance) : shifted(entryMax, stopDistance),
    targetPrice:
      direction === "long" ? shifted(entryMax, targetDistance) : shifted(entryMin, -targetDistance),
  });
}

function generatedQuote(random: Random, plan: PublishedPlan): Decimal {
  const entryMin = new Decimal(plan.entryMin);
  const width = new Decimal(plan.entryMax).minus(entryMin).toNumber();
  if (random.chance(0.85)) {
    return entryMin.plus(random.integer(0, width));
  }
  return random.chance(0.5)
    ? new Decimal(plan.entryMax).plus(random.integer(1, 300))
    : entryMin.minus(random.integer(1, 300));
}

function generatedBook(random: Random, direction: Direction, quote: Decimal, observedAt: number) {
  const worse = direction === "long" ? 1 : -1;
  const levels: BookLevel[] = [];
  let price = quote;
  for (let level = random.integer(1, 4); level > 0; level -= 1) {
    levels.push([price.toFixed(), units(random.integer(1, 3_000), "0.00001")]);
    price = price.plus(worse * random.integer(1, 60));
  }
  const opposite: BookLevel[] = [[shifted(quote, -worse * random.integer(1, 5)), "0.5"]];
  const book: BookSnapshot = {
    symbol: "BTC-USD",
    bids: direction === "long" ? opposite : levels,
    asks: direction === "long" ? levels : opposite,
    exchangeTime: observedAt,
    observedAt,
  };
  return book;
}

const ageOf = (random: Random, maxAgeMs: number) =>
  random.chance(0.05) ? random.integer(maxAgeMs + 1, maxAgeMs * 3) : random.integer(0, maxAgeMs);

export function generatedInput(random: Random, profile: Profile): DecisionInput {
  const direction = profile.direction ?? random.pick(directions);
  const plan = generatedPlan(random, direction);
  const expiresAt = Date.parse(plan.entryExpiresAt);
  const now = random.chance(0.03) ? expiresAt + random.integer(0, 1_000) : fixtureNow;
  const quote = generatedQuote(random, plan);
  const farMark = profile.proportionalCosts && random.chance(0.03);
  const markPrice = shifted(
    quote,
    farMark ? random.integer(4_000, 6_000) : random.integer(-40, 40),
  );
  const costs = profile.proportionalCosts;
  const perTrade = random.integer(50, 10_000);
  const policy = riskPolicySchema.parse({
    version: 1,
    perTradeBudget: units(perTrade, "0.01"),
    aggregateBudget: units(perTrade + random.integer(0, 10_000), "0.01"),
    sessionBudget: units(perTrade + random.integer(0, 10_000), "0.01"),
    leverageCap: random.integer(1, 20),
    maxEntrySlippageBps: costs ? random.integer(0, 100) : 0,
    stopSlippageReserveBps: costs ? random.integer(0, 100) : 0,
    fundingHorizonHours: random.integer(1, 48),
    minRewardRisk: random.pick(["0.5", "1", "1.5", "2"]),
    liquidationBufferBps: random.integer(0, 300),
    allowedMarkets: ["BTC-USD"],
  });
  const leverage = costs
    ? random.integer(1, policy.leverageCap + (random.chance(0.03) ? 1 : 0))
    : 1;
  const strayPosition = random.chance(0.04) ? [openPosition("BTC-USD", "0.001")] : [];
  const fundingRate = costs ? units(random.integer(-500, 500), "0.0000001") : "0";
  return {
    plan,
    admission: {
      status: random.chance(0.03) ? "revoked" : "published",
      isCurrentVersion: !random.chance(0.03),
    },
    policy,
    quantityCeiling: random.chance(0.25) ? units(random.integer(1, 3_000), "0.00001") : null,
    accountState: {
      account: {
        accountId: "generated-subaccount",
        environment: "live",
        availableBalance: costs ? units(random.integer(500, 500_000), "0.01") : "100000000",
        observedAt: now - ageOf(random, 3_000),
      },
      positions: strayPosition,
      openOrders: [],
      symbolSettings: isolatedSettings(leverage),
    },
    accountReconciled: !random.chance(0.03),
    exposure: {
      busySymbols: random.chance(0.04) ? ["BTC-USD"] : [],
      knownClientOrderIds: [],
      committedRisk: units(random.integer(0, 3_000), "0.01"),
      realizedSessionLoss: units(random.integer(0, 2_000), "0.01"),
    },
    market: costs ? btcUsdRules : { ...btcUsdRules, minNotional: "0.00001" },
    book: generatedBook(random, direction, quote, now - ageOf(random, 3_000)),
    mark: markAt(markPrice, now - ageOf(random, 6_000), fundingRate),
    fees: costs
      ? { takerRate: units(random.integer(2, 10), "0.0001"), makerRate: "-0.00005" }
      : { takerRate: "0", makerRate: "0" },
    now,
  };
}

export function mirrored(input: DecisionInput): DecisionInput {
  const axis = new Decimal(input.plan.entryMin).plus(input.plan.entryMax);
  const reflect = (price: string) => axis.minus(price).toFixed();
  const reflectLevels = (levels: readonly BookLevel[]) =>
    levels.map(([price, size]): BookLevel => [reflect(price), size]);
  return {
    ...input,
    plan: publishedPlanSchema.parse({
      ...input.plan,
      direction: input.plan.direction === "long" ? "short" : "long",
      stopPrice: reflect(input.plan.stopPrice),
      targetPrice: reflect(input.plan.targetPrice),
    }),
    book: {
      ...input.book,
      bids: reflectLevels(input.book.asks),
      asks: reflectLevels(input.book.bids),
    },
    mark: {
      ...input.mark,
      markPrice: reflect(input.mark.markPrice),
      indexPrice: reflect(input.mark.indexPrice),
    },
  };
}
