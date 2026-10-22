import { decimalStringSchema } from "@cadence/core";
import { z } from "zod";

export class JsonNumber {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }
}

type ReviverContext = { source?: string };

function exactNumber(_key: string, value: unknown, context?: ReviverContext): unknown {
  if (typeof value !== "number") {
    return value;
  }
  if (context?.source === undefined) {
    throw new Error("This runtime does not expose JSON number source text");
  }
  return new JsonNumber(context.source);
}

export const parseStrikeJson = (text: string): unknown => JSON.parse(text, exactNumber);

const jsonNumber = z.instanceof(JsonNumber).transform((number) => number.source);

export const jsonId = jsonNumber.pipe(z.string().regex(/^(?:0|[1-9]\d*)$/));

export const jsonInteger = jsonNumber
  .pipe(z.string().regex(/^-?(?:0|[1-9]\d*)$/))
  .transform(Number)
  .pipe(z.number().refine(Number.isSafeInteger, "Expected an integer a number can hold exactly"));

export const jsonNumberAsDecimal = jsonNumber.pipe(decimalStringSchema);
