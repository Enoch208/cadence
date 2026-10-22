import type {
  AccountState,
  BookSnapshot,
  FeeSchedule,
  MarketRules,
  MarkSnapshot,
} from "@cadence/core";
import type { StrikeClient } from "./client";
import { StrikeReadError } from "./errors";

export type DecisionSnapshot = {
  accountState: AccountState;
  book: BookSnapshot;
  mark: MarkSnapshot;
  market: MarketRules;
  fees: FeeSchedule;
};

export const decisionBookDepth = 50;

export async function readDecisionSnapshot(
  client: StrikeClient,
  symbol: string,
): Promise<DecisionSnapshot> {
  const [accountState, book, mark, markets, fees] = await Promise.all([
    client.accountState(symbol),
    client.book(symbol, decisionBookDepth),
    client.mark(symbol),
    client.markets(),
    client.fees(),
  ]);
  const market = markets.find((candidate) => candidate.symbol === symbol);
  if (market === undefined) {
    throw new StrikeReadError({
      operation: "market rules",
      status: null,
      detail: `Strike lists no market named ${symbol}`,
    });
  }
  return { accountState, book, mark, market, fees };
}
