import { describe, expect, it } from "vitest";
import { admissibleBudget, perUnitLoss } from "../src/costs";
import type { CadenceExposure } from "../src/decision";
import { riskPolicySchema } from "../src/policy";
import {
  capturedHourlyFundingRate,
  defaultPolicy,
  fixtureNow,
  markAt,
  takerFees,
} from "./fixtures/btc-usd";

const capturedMark = markAt("84400", fixtureNow, capturedHourlyFundingRate);

const exposure = (committedRisk: string, realizedSessionLoss: string): CadenceExposure => ({
  busySymbols: [],
  knownClientOrderIds: [],
  committedRisk,
  realizedSessionLoss,
});

describe("perUnitLoss", () => {
  it("prices every part of the planned loss for one BTC entered at 84400", () => {
    expect(
      perUnitLoss({
        direction: "long",
        entry: "84400",
        stop: "83200",
        fees: takerFees,
        policy: defaultPolicy,
        mark: capturedMark,
      }),
    ).toEqual({
      priceLoss: "1200",
      entryFee: "42.2",
      exitFee: "41.6",
      stopSlippageReserve: "416",
      fundingReserve: "86.92168313805747648",
      total: "1786.72168313805747648",
    });
  });

  it("reserves funding whichever way the rate points", () => {
    const paying = markAt("84400", fixtureNow, "0.0000429115734291358");
    const args = { direction: "long", entry: "84400", stop: "83200", fees: takerFees } as const;
    expect(perUnitLoss({ ...args, policy: defaultPolicy, mark: paying }).fundingReserve).toBe(
      perUnitLoss({ ...args, policy: defaultPolicy, mark: capturedMark }).fundingReserve,
    );
  });

  it("measures a short's price loss up to its stop above the entry", () => {
    const loss = perUnitLoss({
      direction: "short",
      entry: "84000",
      stop: "85200",
      fees: takerFees,
      policy: defaultPolicy,
      mark: capturedMark,
    });
    expect(loss.priceLoss).toBe("1200");
    expect(loss.entryFee).toBe("42");
    expect(loss.exitFee).toBe("42.6");
    expect(loss.stopSlippageReserve).toBe("426");
  });

  it("refuses an entry already beyond its stop", () => {
    expect(() =>
      perUnitLoss({
        direction: "long",
        entry: "83000",
        stop: "83200",
        fees: takerFees,
        policy: defaultPolicy,
        mark: capturedMark,
      }),
    ).toThrow(RangeError);
  });
});

describe("admissibleBudget", () => {
  it("is the per-trade budget when nothing is committed", () => {
    expect(admissibleBudget({ policy: defaultPolicy, exposure: exposure("0", "0") })).toBe("20");
  });

  it("takes what is left of the aggregate budget", () => {
    const policy = riskPolicySchema.parse({ ...defaultPolicy, aggregateBudget: "30" });
    expect(admissibleBudget({ policy, exposure: exposure("15", "0") })).toBe("15");
  });

  it("takes what is left of the session budget after realized losses", () => {
    expect(admissibleBudget({ policy: defaultPolicy, exposure: exposure("10", "15.5") })).toBe(
      "14.5",
    );
  });

  it("counts a realized loss reported as a negative amount the same way", () => {
    expect(admissibleBudget({ policy: defaultPolicy, exposure: exposure("10", "-15.5") })).toBe(
      "14.5",
    );
  });

  it("floors at zero once the budgets are spent", () => {
    expect(admissibleBudget({ policy: defaultPolicy, exposure: exposure("70", "0") })).toBe("0");
    expect(admissibleBudget({ policy: defaultPolicy, exposure: exposure("0", "41") })).toBe("0");
  });
});
