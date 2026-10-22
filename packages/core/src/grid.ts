import { Decimal } from "decimal.js";
import type { DecimalString } from "./contract";
import { Exact } from "./exact";

function snapToGrid(
  value: DecimalString,
  origin: DecimalString,
  step: DecimalString,
  rounding: Decimal.Rounding,
): DecimalString {
  const size = new Exact(step);
  if (!size.greaterThan(0)) {
    throw new RangeError(`A grid step must be positive, not ${step}`);
  }
  const base = new Exact(origin);
  const steps = new Exact(value).minus(base).dividedBy(size).toDecimalPlaces(0, rounding);
  const places = Math.max(size.decimalPlaces(), base.decimalPlaces());
  return base.plus(steps.times(size)).toFixed(places);
}

export const floorToGrid = (value: DecimalString, origin: DecimalString, step: DecimalString) =>
  snapToGrid(value, origin, step, Decimal.ROUND_FLOOR);

export const ceilToGrid = (value: DecimalString, origin: DecimalString, step: DecimalString) =>
  snapToGrid(value, origin, step, Decimal.ROUND_CEIL);

export const floorToStep = (value: DecimalString, step: DecimalString) =>
  floorToGrid(value, "0", step);

export const ceilToStep = (value: DecimalString, step: DecimalString) =>
  ceilToGrid(value, "0", step);
