import { decimalStringSchema, type DecimalString } from "@cadence/core";

type Scaled = { units: bigint; scale: number };

function scaled(value: DecimalString): Scaled {
  const text = decimalStringSchema.parse(value);
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(`${whole}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
}

const rescaled = (value: Scaled, scale: number) => value.units * 10n ** BigInt(scale - value.scale);

export function compareDecimal(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const a = scaled(left);
  const b = scaled(right);
  const scale = Math.max(a.scale, b.scale);
  const difference = rescaled(a, scale) - rescaled(b, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
