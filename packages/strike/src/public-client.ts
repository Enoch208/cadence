import type { StrikePublicClient } from "./client";
import { createPublicReads, readServerTime } from "./public-reads";
import { createTransport } from "./transport";

export type PublicStrikeClientArgs = {
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
};

export function createPublicStrikeClient(args: PublicStrikeClientArgs): StrikePublicClient {
  const transport = createTransport({
    baseUrl: args.baseUrl,
    fetch: args.fetch,
    timeoutMs: args.timeoutMs,
    now: Date.now,
  });
  return {
    environment: "live",
    serverTime: async () => (await readServerTime(transport)).serverTime,
    ...createPublicReads(transport),
  };
}
