import { readFileSync } from "node:fs";
import { parseStrikeJson } from "../../src/json";

const fixturesDirectory = new URL("../fixtures/", import.meta.url);

export const fixtureText = (name: string): string =>
  readFileSync(new URL(name, fixturesDirectory), "utf8");

export const fixture = (name: string): unknown => parseStrikeJson(fixtureText(name));

export const documented = (name: string): unknown => fixture(`documented/${name}`);

export const capturedMarkPriceFor = (symbol: string): unknown => {
  const rows: unknown = JSON.parse(fixtureText("mainnet-get-price-v2-markPrice.json"));
  if (!Array.isArray(rows)) {
    throw new Error("The captured markPrice fixture is not an array");
  }
  const index = rows.findIndex(
    (row: unknown) => typeof row === "object" && row !== null && "s" in row && row.s === symbol,
  );
  const exact = fixture("mainnet-get-price-v2-markPrice.json");
  if (index < 0 || !Array.isArray(exact)) {
    throw new Error(`No captured mark price for ${symbol}`);
  }
  return exact[index] as unknown;
};
