import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { ceilToGrid, ceilToStep, floorToGrid, floorToStep } from "../src/grid";

describe("floorToStep", () => {
  it("rounds a BTC size down to the 0.00001 lot", () => {
    expect(floorToStep("0.0166666", "0.00001")).toBe("0.01666");
  });

  it("keeps an exact multiple unchanged", () => {
    expect(floorToStep("0.01700", "0.00001")).toBe("0.01700");
    expect(floorToStep("0.017", "0.00001")).toBe("0.01700");
  });

  it.each([
    ["0.0166666", "0.00001"],
    ["0.000009", "0.00001"],
    ["84400.99999999999999999999", "1"],
    ["123.456", "0.1"],
    ["7", "3"],
    ["-0.000015", "0.00001"],
  ])("never exceeds the input: floorToStep(%s, %s)", (value, step) => {
    const result = floorToStep(value, step);
    expect(new Decimal(result).lessThanOrEqualTo(value)).toBe(true);
    expect(new Decimal(value).minus(result).lessThan(step)).toBe(true);
  });

  it("floors a negative value away from zero", () => {
    expect(floorToStep("-0.000015", "0.00001")).toBe("-0.00002");
  });

  it("keeps digits that binary floating point would lose", () => {
    expect(floorToStep("84400.99999999999999999999", "1")).toBe("84400");
  });

  it("formats with the step's decimals", () => {
    expect(floorToStep("2.79", "0.1")).toBe("2.7");
    expect(floorToStep("3", "0.1")).toBe("3.0");
    expect(floorToStep("0.000009", "0.00001")).toBe("0.00000");
  });
});

describe("ceilToStep", () => {
  it("rounds up to the next lot", () => {
    expect(ceilToStep("0.0166601", "0.00001")).toBe("0.01667");
  });

  it("keeps an exact multiple unchanged", () => {
    expect(ceilToStep("0.01700", "0.00001")).toBe("0.01700");
  });

  it.each([
    ["0.0166666", "0.00001"],
    ["84399.2", "1"],
    ["-0.000015", "0.00001"],
  ])("never falls below the input: ceilToStep(%s, %s)", (value, step) => {
    const result = ceilToStep(value, step);
    expect(new Decimal(result).greaterThanOrEqualTo(value)).toBe(true);
    expect(new Decimal(result).minus(value).lessThan(step)).toBe(true);
  });

  it("formats with the step's decimals", () => {
    expect(ceilToStep("2.71", "0.1")).toBe("2.8");
    expect(ceilToStep("-0.3", "1")).toBe("0");
  });
});

describe("price grids anchored at the market's minimum price", () => {
  it("floors a price onto the tick grid", () => {
    expect(floorToGrid("84400.7", "10", "1")).toBe("84400");
  });

  it("ceils a price onto the tick grid", () => {
    expect(ceilToGrid("84399.2", "10", "1")).toBe("84400");
  });

  it("counts steps from the origin, not from zero", () => {
    expect(floorToGrid("12.4", "10", "3")).toBe("10");
    expect(ceilToGrid("12.4", "10", "3")).toBe("13");
    expect(floorToStep("12.4", "3")).toBe("12");
  });

  it("keeps a price already on the grid", () => {
    expect(floorToGrid("6.61", "6.6", "0.01")).toBe("6.61");
    expect(ceilToGrid("6.61", "6.6", "0.01")).toBe("6.61");
  });
});

describe("invalid steps", () => {
  it.each(["0", "-1"])("refuses a step of %s", (step) => {
    expect(() => floorToStep("1", step)).toThrow(RangeError);
    expect(() => ceilToGrid("1", "0", step)).toThrow(RangeError);
  });
});
