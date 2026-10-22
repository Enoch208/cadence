import { publishedPlanSchema } from "@cadence/core";
import { describe, expect, it } from "vitest";
import { planCard } from "../src/plan/card";
import { longPlan } from "./support/fixtures";

const card = (version: number, plan = longPlan) =>
  planCard({
    plan,
    version,
    publicId: "k7m2q9x4w8ab",
    communityName: "Range Traders",
    chatId: "-1001234567890",
    webOrigin: "https://cadence.test",
  });

describe("the Telegram plan card", () => {
  it("states the market, direction, range, stop, target and entry expiry", () => {
    const { text } = card(1);
    expect(text).toContain("BTC-USD long");
    expect(text).toContain("Entry 84000 to 84400");
    expect(text).toContain("Stop 83200");
    expect(text).toContain("Target 86800");
    expect(text).toContain("New entries close 2026-10-23 18:00 UTC");
    expect(text).toContain(longPlan.rationale);
    expect(text).toContain("Range Traders");
  });

  it("opens the plan's own page from a Preview for me button", () => {
    expect(card(1)).toMatchObject({
      chatId: "-1001234567890",
      button: { label: "Preview for me", url: "https://cadence.test/p/k7m2q9x4w8ab" },
    });
  });

  it("says when a version replaces an earlier one", () => {
    expect(card(1).text).not.toContain("replaces");
    expect(card(2).text).toContain("Version 2 replaces version 1.");
  });

  it("keeps seconds in the expiry only when they matter and leaves out an empty rationale", () => {
    const plan = publishedPlanSchema.parse({
      ...longPlan,
      direction: "short",
      entryMin: "84000",
      entryMax: "84400",
      stopPrice: "85200",
      targetPrice: "81600",
      entryExpiresAt: "2026-10-23T18:00:30Z",
      rationale: "",
    });
    const { text } = card(1, plan);
    expect(text).toContain("BTC-USD short");
    expect(text).toContain("New entries close 2026-10-23 18:00:30 UTC");
    expect(text).not.toMatch(/\n\n\n/);
  });
});
