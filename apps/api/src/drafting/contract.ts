import { z } from "zod";

const quoted = z.object({ value: z.string(), quote: z.string() }).nullable();

export const setupSchema = z.object({
  isTradeSetup: z.boolean(),
  market: quoted,
  direction: quoted,
  entryMin: quoted,
  entryMax: quoted,
  stopPrice: quoted,
  targetPrice: quoted,
  entryWindowMinutes: quoted,
  rationale: quoted,
});
export type Setup = z.infer<typeof setupSchema>;

export type SetupRequest = { text: string; markets: readonly string[]; now: string };

export type ReadSetup = { setup: Setup; model: string };

export type PlanDrafter = { read(request: SetupRequest): Promise<ReadSetup> };

export class DraftingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftingUnavailableError";
  }
}

export class DraftingDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftingDeclinedError";
  }
}
