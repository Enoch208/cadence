import { decimalStringSchema, type DecimalString } from "@cadence/core";

type Scaled = { units: bigint; scale: number };

function scaled(value: DecimalString): Scaled {
  const text = decimalStringSchema.parse(value);
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(`${whole}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
}

function formatted({ units, scale }: Scaled): DecimalString {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  const text = fraction === "" ? whole : `${whole}.${fraction}`;
  return negative && text !== "0" ? `-${text}` : text;
}

const rescaled = (value: Scaled, scale: number) => value.units * 10n ** BigInt(scale - value.scale);

function aligned(left: DecimalString, right: DecimalString) {
  const a = scaled(left);
  const b = scaled(right);
  const scale = Math.max(a.scale, b.scale);
  return { a: rescaled(a, scale), b: rescaled(b, scale), scale };
}

export function compareDecimal(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const { a, b } = aligned(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const { a, b, scale } = aligned(left, right);
  return formatted({ units: a + b, scale });
}

export function subtractDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const { a, b, scale } = aligned(left, right);
  return formatted({ units: a - b, scale });
}

export function multiplyDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const a = scaled(left);
  const b = scaled(right);
  return formatted({ units: a.units * b.units, scale: a.scale + b.scale });
}

export function divideDecimal(
  numerator: DecimalString,
  denominator: DecimalString,
  places: number,
): DecimalString {
  const { a, b } = aligned(numerator, denominator);
  if (b === 0n) {
    throw new RangeError("Cannot divide by zero");
  }
  return formatted({ units: (a * 10n ** BigInt(places)) / b, scale: places });
}

export const negateDecimal = (value: DecimalString): DecimalString => subtractDecimal("0", value);

export const absDecimal = (value: DecimalString): DecimalString =>
  compareDecimal(value, "0") < 0 ? negateDecimal(value) : formatted(scaled(value));
