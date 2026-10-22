import { createServerClock } from "../src/clock";
import { createLiveStrikeClient } from "../src/live-client";
import type { Signer } from "../src/signer";

export const mainnetBaseUrl = "https://api.strikefinance.org";
export const probeSymbol = "BTC-USD";
export const probeTimeoutMs = 10_000;

export const line = (text = "") => {
  process.stdout.write(`${text}\n`);
};

export const show = (label: string, value: unknown) => {
  line(`${label}:`);
  line(JSON.stringify(value, null, 2));
};

export const keyFingerprint = (publicKeyHex: string) =>
  `${publicKeyHex.slice(0, 8)}…${publicKeyHex.slice(-4)}`;

export const mainnetClient = (signer: Signer) =>
  createLiveStrikeClient({
    baseUrl: mainnetBaseUrl,
    signer,
    clock: createServerClock(Date.now),
    fetch,
    timeoutMs: probeTimeoutMs,
    now: Date.now,
  });

export function runProbe(main: () => Promise<void>) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
