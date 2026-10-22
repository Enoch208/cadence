import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Direction } from "../src/contract";
import {
  estimatedLiquidationPrice,
  initialMargin,
  maxQuantityForLeverage,
  maxQuantityForMargin,
  tierForNotional,
} from "../src/margin";
import type { MarginTier } from "../src/market";
import { btcUsdRules } from "./fixtures/btc-usd";

const tiers = btcUsdRules.marginTiers;
const tierAt = (index: number): MarginTier => {
  const tier = tiers[index];
  if (tier === undefined) {
    throw new Error(`The fixture has no tier ${String(index)}`);
  }
  return tier;
};

const marginBalanceGap = (args: {
  direction: Direction;
  entry: string;
  quantity: string;
  leverage: number;
  tier: MarginTier;
  liquidation: string;
}) => {
  const quantity = new Decimal(args.quantity);
  const isolatedBalance = quantity.times(args.entry).dividedBy(args.leverage);
  const move = new Decimal(args.liquidation).minus(args.entry);
  const pnl = args.direction === "long" ? quantity.times(move) : quantity.times(move).negated();
  const maintenance = quantity
    .times(args.liquidation)
    .times(args.tier.maintenanceMarginRate)
    .minus(args.tier.maintenanceAmount);
  return isolatedBalance.plus(pnl).minus(maintenance).abs();
};

describe("tierForNotional", () => {
  it("puts a $1,406 BTC position in the first tier", () => {
    expect(tierForNotional("1406.104", tiers)).toBe(tierAt(0));
  });

  it("keeps a notional exactly at a tier's maximum in that tier", () => {
    expect(tierForNotional("10000", tiers)).toBe(tierAt(0));
    expect(tierForNotional("10000.01", tiers)).toBe(tierAt(1));
  });

  it("has no tier beyond the last one", () => {
    expect(tierForNotional("100000000.01", tiers)).toBeNull();
  });
});

describe("initialMargin", () => {
  it("divides the notional by the leverage", () => {
    expect(initialMargin("1406.104", 5)).toBe("281.2208");
  });

  it("rounds a repeating margin up at quote precision", () => {
    expect(initialMargin("1000", 3)).toBe("333.33333334");
  });

  it.each([0, -1, 2.5])("refuses a leverage of %s", (leverage) => {
    expect(() => initialMargin("1000", leverage)).toThrow(RangeError);
  });
});

describe("maxQuantityForMargin", () => {
  it("fits $50 at 5x on a BTC entry at 84000 to 0.00296", () => {
    expect(
      maxQuantityForMargin({
        availableBalance: "50",
        limitPrice: "84000",
        leverage: 5,
        takerRate: "0.0005",
        step: "0.00001",
      }),
    ).toBe("0.00296");
  });

  it("reserves the opening fee, so 84400 fits one lot less than margin alone would", () => {
    expect(
      maxQuantityForMargin({
        availableBalance: "50",
        limitPrice: "84400",
        leverage: 5,
        takerRate: "0.0005",
        step: "0.00001",
      }),
    ).toBe("0.00295");
  });

  it("fits nothing with no available balance", () => {
    expect(
      maxQuantityForMargin({
        availableBalance: "-3",
        limitPrice: "84400",
        leverage: 5,
        takerRate: "0.0005",
        step: "0.00001",
      }),
    ).toBe("0.00000");
  });
});

describe("maxQuantityForLeverage", () => {
  it("keeps 100x BTC within the $10,000 first tier", () => {
    const quantity = maxQuantityForLeverage({
      leverage: 100,
      limitPrice: "84400",
      tiers,
      step: "0.00001",
    });
    expect(quantity).toBe("0.11848");
    expect(new Decimal(quantity).times("84400").lessThanOrEqualTo("10000")).toBe(true);
    expect(new Decimal(quantity).plus("0.00001").times("84400").greaterThan("10000")).toBe(true);
  });

  it("lets 5x reach the last tier that allows 5x", () => {
    expect(
      maxQuantityForLeverage({ leverage: 5, limitPrice: "84400", tiers, step: "0.00001" }),
    ).toBe("296.20853");
  });

  it("allows nothing above the first tier's maximum leverage", () => {
    expect(
      maxQuantityForLeverage({ leverage: 125, limitPrice: "84400", tiers, step: "0.00001" }),
    ).toBe("0.00000");
  });
});

describe("estimatedLiquidationPrice", () => {
  it("puts a 5x long's liquidation below the entry and more than 1% below its stop", () => {
    const liquidation = estimatedLiquidationPrice({
      direction: "long",
      entry: "84400",
      quantity: "0.01666",
      leverage: 5,
      tier: tierAt(0),
    });
    expect(liquidation).toBe("67791.16465864");
    expect(new Decimal(liquidation).greaterThan(0)).toBe(true);
    expect(new Decimal(liquidation).lessThan("84400")).toBe(true);
    expect(new Decimal(liquidation).lessThan(new Decimal("83200").times("0.99"))).toBe(true);
  });

  it("puts a 5x short's liquidation above the entry and more than 1% above its stop", () => {
    const liquidation = estimatedLiquidationPrice({
      direction: "short",
      entry: "84000",
      quantity: "0.01666",
      leverage: 5,
      tier: tierAt(0),
    });
    expect(liquidation).toBe("100398.4063745");
    expect(new Decimal(liquidation).greaterThan(new Decimal("85200").times("1.01"))).toBe(true);
  });

  it("subtracts the maintenance amount once a position reaches a higher tier", () => {
    const args = { entry: "84400", quantity: "5", leverage: 5, tier: tierAt(5) } as const;
    expect(estimatedLiquidationPrice({ direction: "long", ...args })).toBe("67798.99497488");
    expect(estimatedLiquidationPrice({ direction: "short", ...args })).toBe("100835.82089552");
  });

  it.each([
    ["long", "84400", "0.01666", 5, 0],
    ["short", "84000", "0.01666", 5, 0],
    ["long", "84400", "5", 5, 5],
    ["short", "84400", "5", 20, 5],
    ["long", "61234", "40", 10, 7],
  ] as const)(
    "is where the margin balance meets maintenance margin: %s at %s x %s, %sx",
    (direction, entry, quantity, leverage, tierIndex) => {
      const tier = tierAt(tierIndex);
      const liquidation = estimatedLiquidationPrice({ direction, entry, quantity, leverage, tier });
      const gap = marginBalanceGap({ direction, entry, quantity, leverage, tier, liquidation });
      expect(gap.lessThan(new Decimal(quantity).times("0.00000002"))).toBe(true);
    },
  );

  it("refuses an empty position", () => {
    expect(() =>
      estimatedLiquidationPrice({
        direction: "long",
        entry: "84400",
        quantity: "0",
        leverage: 5,
        tier: tierAt(0),
      }),
    ).toThrow(RangeError);
  });
});
