import { describe, expect, it } from "vitest";
import { planDraftSchema } from "../src/lib/api/drafting";
import { draftSummary, fillFromDraft } from "../src/lib/draft-fill";
import { checkDraft, type PlanDraft } from "../src/lib/plan-form";

const now = Date.parse("2026-10-22T12:00:00Z");

const empty: PlanDraft = {
  environment: "replay",
  market: "BTC-USD",
  direction: "long",
  entryMin: "",
  entryMax: "",
  stopPrice: "",
  targetPrice: "",
  closesAtLocal: "",
  rationale: "My own words.",
};

const reply = planDraftSchema.parse({
  model: "gpt-6.1-sol",
  draft: {
    filled: {
      market: { value: "ETH-USD", quote: "ETH short" },
      direction: { value: "short", quote: "ETH short" },
      entryMin: { value: "3200", quote: "Entry 3,200 - 3,220" },
      entryMax: { value: "3220", quote: "Entry 3,200 - 3,220" },
      stopPrice: { value: "3260", quote: "SL 3,260" },
      targetPrice: { value: "3100", quote: "TP 3.1k" },
      entryExpiresAt: { value: "2026-10-22T16:00:00Z", quote: "Valid 4h" },
    },
    missing: ["rationale"],
  },
});

describe("filling the plan form from a drafted message", () => {
  it("fills every drafted field and keeps the quote that states it", () => {
    const filled = fillFromDraft(empty, reply.draft);
    expect(filled.draft).toMatchObject({
      environment: "replay",
      market: "ETH-USD",
      direction: "short",
      entryMin: "3200",
      entryMax: "3220",
      stopPrice: "3260",
      targetPrice: "3100",
    });
    expect(filled.sources).toEqual({
      market: "ETH short",
      direction: "ETH short",
      entryMin: "Entry 3,200 - 3,220",
      entryMax: "Entry 3,200 - 3,220",
      stopPrice: "SL 3,260",
      targetPrice: "TP 3.1k",
      closesAtLocal: "Valid 4h",
    });
    expect(filled.missing).toEqual(["rationale"]);
  });

  it("produces a plan that publishes with the drafted entry window", () => {
    const result = checkDraft(fillFromDraft(empty, reply.draft).draft, now);
    expect(result.ok && result.plan).toMatchObject({
      market: "ETH-USD",
      direction: "short",
      entryExpiresAt: "2026-10-22T16:00:00Z",
      rationale: "My own words.",
      environment: "replay",
    });
  });

  it("leaves what the message did not state as the curator had it", () => {
    const filled = fillFromDraft(
      { ...empty, stopPrice: "3300" },
      { filled: { entryMin: { value: "3200", quote: "3,200" } }, missing: ["stopPrice"] },
    );
    expect(filled.draft).toEqual({ ...empty, stopPrice: "3300", entryMin: "3200" });
    expect(filled.sources).toEqual({ entryMin: "3,200" });
  });

  it("treats a value the form cannot hold as missing", () => {
    const filled = fillFromDraft(empty, {
      filled: {
        direction: { value: "sideways", quote: "ETH" },
        entryExpiresAt: { value: "soon", quote: "soon" },
      },
      missing: [],
    });
    expect(filled.draft).toEqual(empty);
    expect(filled.missing).toEqual(expect.arrayContaining(["direction", "closesAtLocal"]));
  });
});

describe("the summary after filling a plan", () => {
  it("speaks as Cadence and never names the model", () => {
    expect(draftSummary(8, [])).toBe(
      "Cadence filled all 8 fields from your message. Check each value before you publish.",
    );
    expect(draftSummary(8, ["why this setup"])).toBe(
      "Cadence filled 7 of 8 fields from your message. Add the rest: why this setup. Check each value before you publish.",
    );
    expect(draftSummary(8, ["stop", "target"])).toContain("6 of 8");
    expect(draftSummary(8, ["stop"])).not.toMatch(/gpt|claude|openai/i);
  });
});
