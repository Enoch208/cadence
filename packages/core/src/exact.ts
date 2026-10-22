import { Decimal } from "decimal.js";

export const Exact = Decimal.clone({
  precision: 256,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

export const quotePlaces = 8;

export const moneyPlaces = 2;

export const roundTo = (value: Decimal, places: number, rounding: Decimal.Rounding): string =>
  value.toDecimalPlaces(places, rounding).toFixed(places);
