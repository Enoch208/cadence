import { describe, expect, it } from "vitest";
import { checkDraft, type PlanDraft } from "../src/lib/plan-form";

const now = Date.parse("2026-10-22T12:00:00Z");

const draft: PlanDraft = {
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  closesAtLocal: "2026-10-23T18:00:00Z",
  rationale: " Reclaim of the weekly open. ",
};

describe("the curator's plan form", () => {
  it("accepts a complete long and trims what the curator typed", () => {
    const result = checkDraft(draft, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.rationale).toBe("Reclaim of the weekly open.");
      expect(result.plan.entryExpiresAt).toBe("2026-10-23T18:00:00Z");
      expect(result.plan.environment).toBe("live");
    }
  });

  it("points at the stop when it sits inside the entry range", () => {
    const result = checkDraft({ ...draft, stopPrice: "84100" }, now);
    expect(result).toEqual({
      ok: false,
      errors: { stopPrice: "For a long, the stop must be below the lowest entry price." },
    });
  });

  it("refuses an entry window that has already closed", () => {
    const result = checkDraft({ ...draft, closesAtLocal: "2026-10-22T11:00:00Z" }, now);
    expect(result).toEqual({
      ok: false,
      errors: { closesAtLocal: "The entry window must close in the future." },
    });
  });

  it("refuses a price that is not a plain positive decimal", () => {
    const result = checkDraft({ ...draft, entryMin: "84,000" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.entryMin).toBeDefined();
    }
  });
});
