import { describe, expect, it } from "vitest";
import {
  decisionOutcomes,
  environments,
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
      for (const environment of environments) {
        expect(intentStateLabel(state, environment).length).toBeGreaterThan(0);
        expect(intentStateDetail(state, environment)).not.toMatch(banned);
      }
    }
  });

  it("never calls a position protected or filled before Strike confirms it", () => {
    expect(intentStateLabel("submitted", "live")).toBe("Sent to Strike");
    expect(intentStateLabel("submitted", "live")).not.toMatch(/filled/i);
    expect(intentStateLabel("open_verified", "live")).toBe("Exits verified");
  });

  it("never credits Strike with what the replay exchange did", () => {
    for (const state of intentStates) {
      expect(intentStateLabel(state, "replay")).not.toMatch(/strike/i);
      expect(intentStateDetail(state, "replay")).not.toMatch(/strike/i);
    }
    expect(intentStateLabel("rejected", "replay")).toBe("Rejected by the replay exchange");
    expect(intentStateDetail("submitted", "replay")).toBe(
      "The replay exchange acknowledged the order. Waiting for the fill.",
    );
  });
});

describe("the words members read in Telegram", () => {
  it("match the app's words for every state in both environments", async () => {
    const telegram = await import("../../worker/src/notify-words");
    for (const state of intentStates) {
      for (const environment of environments) {
        expect(telegram.intentStateLabel(state, environment)).toBe(
          intentStateLabel(state, environment),
        );
        expect(telegram.intentStateDetail(state, environment)).toBe(
          intentStateDetail(state, environment),
        );
      }
    }
  });
});
