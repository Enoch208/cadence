import { describe, expect, it } from "vitest";
import { draftingCases } from "../scripts/drafting-cases";
import type { Setup } from "../src/drafting/contract";
import { verifySetup } from "../src/drafting/verify";

const now = Date.parse("2026-10-22T12:00:00Z");
const markets = ["BTC-USD", "ETH-USD"];

const sourced = (value: string | null, quote: string) => (value === null ? null : { value, quote });

describe("the drafting check's messages", () => {
  it.each(draftingCases.filter((testCase) => testCase.setup !== null))(
    "lets a perfect reading of $name through verification unchanged",
    ({ text, setup }) => {
      if (setup === null) {
        return;
      }
      const ideal: Setup = {
        isTradeSetup: true,
        market: sourced(setup.fields.market, text),
        direction: sourced(setup.fields.direction, text),
        entryMin: sourced(setup.fields.entryMin, text),
        entryMax: sourced(setup.fields.entryMax, text),
        stopPrice: sourced(setup.fields.stopPrice, text),
        targetPrice: sourced(setup.fields.targetPrice, text),
        entryWindowMinutes: sourced(
          setup.windowMinutes === null ? null : String(setup.windowMinutes),
          text,
        ),
        rationale: sourced(setup.rationaleIncludes, setup.rationaleIncludes ?? text),
      };
      const draft = verifySetup(ideal, { text, markets, now });
      for (const [key, value] of Object.entries(setup.fields)) {
        expect(draft.filled[key as keyof typeof setup.fields]?.value ?? null).toBe(value);
      }
      expect(draft.filled.entryExpiresAt === undefined).toBe(setup.windowMinutes === null);
      expect(draft.filled.rationale?.value ?? null).toBe(setup.rationaleIncludes);
    },
  );
});
