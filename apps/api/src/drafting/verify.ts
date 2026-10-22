import { directions, positiveDecimalSchema } from "@cadence/core";
import { Decimal } from "decimal.js";
import type { Setup } from "./contract";

export const draftKeys = [
  "market",
  "direction",
  "entryMin",
  "entryMax",
  "stopPrice",
  "targetPrice",
  "entryExpiresAt",
  "rationale",
] as const;
export type DraftKey = (typeof draftKeys)[number];

export type Sourced = { value: string; quote: string };

export type VerifiedDraft = { filled: Partial<Record<DraftKey, Sourced>>; missing: DraftKey[] };

type Candidate = Setup["market"];
type Context = { text: string; markets: readonly string[]; now: number };

const maxWindowMinutes = 7 * 24 * 60;
const maxRationaleLength = 2000;

const squash = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();

function statedNumbers(quote: string): Decimal[] {
  return [...quote.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kK])?/g)].map(
    ([, digits = "0", thousands]) => {
      const amount = new Decimal(digits.replaceAll(",", ""));
      return thousands === undefined ? amount : amount.times(1000);
    },
  );
}

function price({ value, quote }: NonNullable<Candidate>): string | null {
  const plain = value.replaceAll(",", "").trim();
  if (!positiveDecimalSchema.safeParse(plain).success) {
    return null;
  }
  const amount = new Decimal(plain);
  return statedNumbers(quote).some((stated) => stated.eq(amount)) ? amount.toFixed() : null;
}

function closesAt(minutesText: string, now: number): string | null {
  if (!/^\d{1,5}$/.test(minutesText.trim())) {
    return null;
  }
  const minutes = Number(minutesText.trim());
  if (minutes < 1 || minutes > maxWindowMinutes) {
    return null;
  }
  const closing = Math.floor((now + minutes * 60_000) / 60_000) * 60_000;
  return new Date(closing).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sourced(
  candidate: Candidate,
  message: string,
  read: (candidate: NonNullable<Candidate>, quote: string) => string | null,
): Sourced | null {
  if (candidate === null) {
    return null;
  }
  const quote = squash(candidate.quote);
  if (quote.length === 0 || !message.includes(quote)) {
    return null;
  }
  const value = read(candidate, quote);
  return value === null ? null : { value, quote };
}

const readers: Record<
  DraftKey,
  (setup: Setup, message: string, context: Context) => Sourced | null
> = {
  market: (setup, message, { markets }) =>
    sourced(setup.market, message, ({ value }) => {
      const symbol = value.trim().toUpperCase();
      return markets.includes(symbol) ? symbol : null;
    }),
  direction: (setup, message) =>
    sourced(setup.direction, message, ({ value }) => {
      const side = value.trim().toLowerCase();
      return directions.find((direction) => direction === side) ?? null;
    }),
  entryMin: (setup, message) => sourced(setup.entryMin, message, price),
  entryMax: (setup, message) => sourced(setup.entryMax, message, price),
  stopPrice: (setup, message) => sourced(setup.stopPrice, message, price),
  targetPrice: (setup, message) => sourced(setup.targetPrice, message, price),
  entryExpiresAt: (setup, message, { now }) =>
    sourced(setup.entryWindowMinutes, message, ({ value }) => closesAt(value, now)),
  rationale: (setup, message) =>
    sourced(setup.rationale, message, (_, quote) =>
      quote.length <= maxRationaleLength ? quote : null,
    ),
};

export function verifySetup(setup: Setup, context: Context): VerifiedDraft {
  const message = squash(context.text);
  const filled: Partial<Record<DraftKey, Sourced>> = {};
  const missing: DraftKey[] = [];
  for (const key of draftKeys) {
    const read = readers[key](setup, message, context);
    if (read === null) {
      missing.push(key);
    } else {
      filled[key] = read;
    }
  }
  return { filled, missing };
}
