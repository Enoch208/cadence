import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExchangeOrderSnapshot } from "@cadence/core";
import type { StrikeClient } from "../src/client";
import { loadStrikeCredentials } from "../src/credentials";
import { StrikeAmbiguousError } from "../src/errors";
import { compareDecimal } from "../src/exact";
import { strategyRequestBody } from "../src/orders";
import { parseProbeOrderArgs } from "./probe-args";
import { readPrivateEnvFile } from "./probe-env";
import { liveCeiling, minimumProbeOrder } from "./probe-order-plan";
import { line, mainnetClient, probeSymbol, runProbe, show } from "./probe-support";

const terminal = new Set(["filled", "canceled", "rejected", "expired"]);
const pollEveryMs = 1_000;
const pollForMs = 30_000;

async function untilTerminal(
  client: StrikeClient,
  clientOrderId: string,
): Promise<ExchangeOrderSnapshot | null> {
  let latest: ExchangeOrderSnapshot | null = null;
  let reported = "";
  for (let waited = 0; waited <= pollForMs; waited += pollEveryMs) {
    latest = await client.order(probeSymbol, clientOrderId);
    const status = latest === null ? "not visible yet" : latest.status;
    if (status !== reported) {
      line(`+${String(waited)} ms: ${status}`);
      reported = status;
    }
    if (latest !== null && terminal.has(latest.status)) {
      return latest;
    }
    await sleep(pollEveryMs);
  }
  return latest;
}

runProbe(async () => {
  const args = parseProbeOrderArgs(process.argv.slice(2));
  const env = readPrivateEnvFile(args.envFile);
  const maxNotional = liveCeiling(env);
  const credentials = loadStrikeCredentials(env);
  const client = mainnetClient(credentials.signer);

  const state = await client.accountState(probeSymbol);
  if (state.account.accountId !== credentials.subAccountId) {
    throw new Error("The key resolves to a different account than STRIKE_SUBACCOUNT_ID");
  }
  const holding = state.positions.some(
    (position) => compareDecimal(position.signedSize, "0") !== 0,
  );
  if (holding || state.openOrders.length > 0) {
    throw new Error(`${probeSymbol} already has a position or open orders on this account`);
  }
  const [markets, book, mark] = await Promise.all([
    client.markets(),
    client.book(probeSymbol, 5),
    client.mark(probeSymbol),
  ]);
  const market = markets.find((candidate) => candidate.symbol === probeSymbol);
  if (market === undefined) {
    throw new Error(`Strike lists no ${probeSymbol} market`);
  }
  const { order, notional } = minimumProbeOrder({
    intentId: `probe-${randomUUID()}`,
    market,
    book,
    mark,
    maxNotional,
  });

  line("Placing exactly this order on Strike mainnet (POST /v2/order/strategy):");
  line(JSON.stringify(strategyRequestBody(order), null, 2));
  line(`Notional ${notional} USD against a ceiling of ${maxNotional}; mark ${mark.markPrice}`);
  show("Account before", { ...state.account, symbolSettings: state.symbolSettings });

  const startedAt = Date.now();
  try {
    show("Acknowledged, which is not a fill", await client.placeStrategy(order));
  } catch (error) {
    if (!(error instanceof StrikeAmbiguousError)) {
      throw error;
    }
    line(`${error.message}. Not resending; looking the order up by client order ID instead.`);
  }

  const entry = await untilTerminal(client, order.entryClientOrderId);
  show("Entry", entry);
  if (entry === null) {
    line("No order is visible for the entry client order ID. The outcome is unknown: read the");
    line("account with probe:account before doing anything else, and never resend blindly.");
    return;
  }
  if (entry.status !== "filled") {
    line(`The entry ended ${entry.status} without a fill. Read the account before retrying.`);
    return;
  }
  const after = await client.accountState(probeSymbol);
  const legs = after.openOrders.filter((open) => open.strategyId === order.strategyId);
  show("Position", after.positions);
  show("Exit legs on the exchange", legs);
  show("Fills", await client.fills(probeSymbol, startedAt - 60_000));
  line(
    legs.length === 2
      ? "Both exits are on the exchange. The position stays open until a leg triggers or it is closed."
      : "EXITS NOT BOTH VISIBLE. Close this position before doing anything else.",
  );
});
