import { describe, expect, it } from "vitest";
import {
  absDecimal,
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
} from "../src/exact";

describe("compareDecimal", () => {
  it.each([
    ["84482", "84482.000", 0],
    ["0.00012", "0.0001", 1],
    ["-0.5", "0.1", -1],
    ["-0", "0", 0],
    ["100000", "99999.99999999", 1],
  ] as const)("compares %s with %s as %s", (left, right, expected) => {
    expect(compareDecimal(left, right)).toBe(expected);
    expect(compareDecimal(right, left)).toBe(-expected === 0 ? 0 : -expected);
  });

  it("refuses something that is not a plain decimal", () => {
    expect(() => compareDecimal("1e3", "1")).toThrow();
  });
});

describe("arithmetic", () => {
  it("adds and subtracts exactly, with no binary rounding", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(subtractDecimal("86800", "84482")).toBe("2318");
    expect(subtractDecimal("0.00012", "0.00012")).toBe("0");
    expect(subtractDecimal("1", "1.5")).toBe("-0.5");
  });

  it("multiplies exactly and drops trailing zeros", () => {
    expect(multiplyDecimal("84482", "0.00012")).toBe("10.13784");
    expect(multiplyDecimal(multiplyDecimal("84482", "0.00012"), "0.0005")).toBe("0.00506892");
    expect(multiplyDecimal("-0.00012", "84482")).toBe("-10.13784");
    expect(multiplyDecimal("0", "-5")).toBe("0");
  });

  it("divides to a fixed number of places, rounding toward zero", () => {
    expect(divideDecimal("10", "84482", 8)).toBe("0.00011836");
    expect(divideDecimal("-10", "3", 2)).toBe("-3.33");
    expect(divideDecimal("1", "4", 8)).toBe("0.25");
    expect(() => divideDecimal("1", "0", 8)).toThrow(RangeError);
  });

  it("negates and takes absolute values", () => {
    expect(negateDecimal("0.00012")).toBe("-0.00012");
    expect(negateDecimal("-3")).toBe("3");
    expect(negateDecimal("0")).toBe("0");
    expect(absDecimal("-84482.5")).toBe("84482.5");
  });

  it("keeps algebraic identities over many generated values", () => {
    let seed = 20261022;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const generated = () => {
      const whole = String(next() % 100000);
      const fraction = String(next() % 100000).padStart(5, "0");
      return `${next() % 2 === 0 ? "" : "-"}${whole}.${fraction}`;
    };
    for (let index = 0; index < 500; index += 1) {
      const a = generated();
      const b = generated();
      expect(compareDecimal(subtractDecimal(addDecimal(a, b), b), a)).toBe(0);
      expect(multiplyDecimal(a, b)).toBe(multiplyDecimal(b, a));
      expect(compareDecimal(a, b)).toBe(-compareDecimal(b, a) || 0);
      expect(compareDecimal(addDecimal(a, negateDecimal(a)), "0")).toBe(0);
    }
  });
});
