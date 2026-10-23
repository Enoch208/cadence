import { describe, expect, it } from "vitest";
import { checkDraft, type PlanDraft } from "../src/lib/plan-form";

const now = Date.parse("2026-10-22T12:00:00Z");

const draft: PlanDraft = {
  environment: "live",
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  closesAtLocal: "2026-10-23T18:00:00Z",
  rationale: " Reclaim of the weekly open. ",
  builderCode: "",
  curatorFeeBps: "",
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

  it("publishes no curator fee when both fee fields are empty", () => {
    const result = checkDraft(draft, now);
    expect(result.ok && Object.keys(result.plan)).not.toContain("curatorFee");
  });

  it("attaches the curator's builder code and fee when both are given", () => {
    const result = checkDraft(
      { ...draft, environment: "replay", builderCode: " range_traders ", curatorFeeBps: "5" },
      now,
    );
    expect(result.ok && result.plan.curatorFee).toEqual({
      builderCode: "range_traders",
      feeBps: 5,
    });
  });

  it("asks for the missing half of a curator fee and keeps the fee within 1 to 20 bps", () => {
    const feeMessage = "Enter a whole number of basis points from 1 to 20.";
    const codeMessage = "Use the code you registered on Strike: 1 to 64 letters, digits, - or _.";
    for (const curatorFeeBps of ["", "0", "21", "2.5", "five"]) {
      const fee = { environment: "replay" as const, builderCode: "range_traders", curatorFeeBps };
      expect(checkDraft({ ...draft, ...fee }, now)).toEqual({
        ok: false,
        errors: { curatorFeeBps: feeMessage },
      });
    }
    for (const builderCode of ["", "has space"]) {
      const fee = { environment: "replay" as const, builderCode, curatorFeeBps: "5" };
      expect(checkDraft({ ...draft, ...fee }, now)).toEqual({
        ok: false,
        errors: { builderCode: codeMessage },
      });
    }
  });

  it("leaves a curator fee off a live plan, since fees run on replay plans only", () => {
    const result = checkDraft({ ...draft, builderCode: "range_traders", curatorFeeBps: "5" }, now);
    expect(result.ok && Object.keys(result.plan)).not.toContain("curatorFee");
  });

  it("keeps the environment the curator chose", () => {
    const result = checkDraft({ ...draft, environment: "replay" }, now);
    expect(result.ok && result.plan.environment).toBe("replay");
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
