import { describe, expect, it } from "vitest";
import {
  decisionOutcomes,
  intentStates,
  publishedPlanSchema,
  reasonCodes,
  type DecisionEvidence,
} from "@cadence/core";
import { blockedReasonCopy, resizedReasonCopy } from "../src/lib/copy/reasons";
import { intentStateDetail, intentStateLabel, outcomeLabel } from "../src/lib/copy/states";

const plan = publishedPlanSchema.parse({
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "",
  environment: "live",
});

const evidenceWithAsk = (bestAsk: string | null): DecisionEvidence => ({
  bestBid: "84000",
  bestAsk,
  markPrice: "84100",
  accountObservedAt: 0,
  bookObservedAt: 0,
  markObservedAt: 0,
  evaluatedAt: 0,
});

const banned = /risk-free|guarantee|protected|trustless/i;

describe("plain-language copy", () => {
  it("explains every reason code in words, without promising safety", () => {
    for (const reason of reasonCodes) {
      const copy = blockedReasonCopy(reason, plan, evidenceWithAsk("84100"));
      expect(copy.length).toBeGreaterThan(20);
      expect(copy).not.toMatch(banned);
      expect(resizedReasonCopy(reason)).not.toMatch(banned);
    }
  });

  it("says which side of the range a late price is on", () => {
    expect(blockedReasonCopy("OUTSIDE_ENTRY_RANGE", plan, evidenceWithAsk("85150"))).toBe(
      "The current ask is above this plan’s highest entry price.",
    );
    expect(blockedReasonCopy("OUTSIDE_ENTRY_RANGE", plan, evidenceWithAsk("83900"))).toBe(
      "The current ask is below this plan’s lowest entry price.",
    );
    expect(blockedReasonCopy("OUTSIDE_ENTRY_RANGE", plan, evidenceWithAsk(null))).toBe(
      "There is no ask on the order book right now.",
    );
  });

  it("labels every decision outcome and every intent state", () => {
    for (const outcome of decisionOutcomes) {
      expect(outcomeLabel[outcome].length).toBeGreaterThan(0);
    }
    for (const state of intentStates) {
      expect(intentStateLabel[state].length).toBeGreaterThan(0);
      expect(intentStateDetail[state]).not.toMatch(banned);
    }
  });

  it("never calls a position protected or filled before Strike confirms it", () => {
    expect(intentStateLabel.submitted).not.toMatch(/filled/i);
    expect(intentStateLabel.open_verified).toBe("Exits verified");
  });
});
