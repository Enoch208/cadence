import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonNumber, jsonId, jsonInteger, jsonNumberAsDecimal, parseStrikeJson } from "../src/json";

describe("parseStrikeJson", () => {
  it("keeps every JSON number as its exact source text", () => {
    const parsed = parseStrikeJson('{"id":18446744073709551615,"rate":0.0005,"n":-12}');
    expect(parsed).toEqual({
      id: new JsonNumber("18446744073709551615"),
      rate: new JsonNumber("0.0005"),
      n: new JsonNumber("-12"),
    });
  });

  it("leaves strings, booleans, null and nesting untouched", () => {
    expect(parseStrikeJson('{"a":["1",true,null,{"b":"x"}]}')).toEqual({
      a: ["1", true, null, { b: "x" }],
    });
  });

  it("refuses text that is not JSON", () => {
    expect(() => parseStrikeJson("<html>502 Bad Gateway</html>")).toThrow(SyntaxError);
  });
});

describe("JSON number schemas", () => {
  it("reads an int64 identifier as a string with no loss", () => {
    expect(jsonId.parse(new JsonNumber("9007199254740993"))).toBe("9007199254740993");
    expect(jsonId.safeParse(new JsonNumber("-1")).success).toBe(false);
    expect(jsonId.safeParse(new JsonNumber("1.5")).success).toBe(false);
    expect(jsonId.safeParse("9007199254740993").success).toBe(false);
  });

  it("reads small integers as numbers and refuses anything a number cannot hold exactly", () => {
    expect(jsonInteger.parse(new JsonNumber("1792603881365"))).toBe(1792603881365);
    expect(jsonInteger.safeParse(new JsonNumber("9007199254740993")).success).toBe(false);
    expect(jsonInteger.safeParse(new JsonNumber("10.5")).success).toBe(false);
    expect(jsonInteger.safeParse(new JsonNumber("1e3")).success).toBe(false);
  });

  it("reads a numeric rate as the decimal string it was written as", () => {
    expect(jsonNumberAsDecimal.parse(new JsonNumber("-0.00005"))).toBe("-0.00005");
    expect(jsonNumberAsDecimal.safeParse(new JsonNumber("5e-5")).success).toBe(false);
  });

  it("does not let a plain number stand in for an exact one", () => {
    expect(z.object({ n: jsonInteger }).safeParse({ n: 5 }).success).toBe(false);
  });
});
