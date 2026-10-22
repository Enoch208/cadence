import { loadStrikeCredentials } from "../src/credentials";
import { parseProbeAccountArgs } from "./probe-args";
import { readPrivateEnvFile } from "./probe-env";
import { keyFingerprint, line, mainnetClient, probeSymbol, runProbe, show } from "./probe-support";

runProbe(async () => {
  const { envFile } = parseProbeAccountArgs(process.argv.slice(2));
  const credentials = loadStrikeCredentials(readPrivateEnvFile(envFile));
  const client = mainnetClient(credentials.signer);
  const serverTime = await client.serverTime();
  const state = await client.accountState(probeSymbol);
  const everyOpenOrder = await client.openOrders(null);

  line(`Strike mainnet signed read probe (GET only) at ${new Date(serverTime).toISOString()}`);
  line(
    `Key ${keyFingerprint(credentials.publicKeyHex)} resolves to account ${state.account.accountId}`,
  );
  if (state.account.accountId !== credentials.subAccountId) {
    throw new Error("The key resolves to a different account than STRIKE_SUBACCOUNT_ID");
  }
  line("That is the dedicated sub-account named in STRIKE_SUBACCOUNT_ID.");
  show("Account", state.account);
  show(`${probeSymbol} positions`, state.positions);
  show(`${probeSymbol} open orders`, state.openOrders);
  show(`${probeSymbol} symbol settings`, state.symbolSettings);
  show("Open orders on every symbol", everyOpenOrder);
});
