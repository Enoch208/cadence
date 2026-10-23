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
    expect(text).toContain("Entry 84,000 – 84,400");
    expect(text).toContain("Stop 83,200 · Target 86,800");
    expect(text).toContain("Entry closes 23 Oct, 18:00 UTC");
    expect(text).toContain(longPlan.rationale);
    expect(text).toContain("Range Traders");
    expect(text).toContain(
      "Each member gets a size that fits their own account. Nothing is placed until they approve.",
    );
  });

  it("bolds exactly the first line", () => {
    const { text, boldLength } = card(1);
    expect(text.slice(0, boldLength)).toBe("Range Traders · BTC-USD long");
    expect(text.charAt(boldLength)).toBe("\n");
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

  it("groups thousands without touching decimals", () => {
    const plan = publishedPlanSchema.parse({
      ...longPlan,
      market: "ETH-USD",
      entryMin: "3215.5",
      entryMax: "3230",
      stopPrice: "3195.25",
      targetPrice: "3300",
    });
    expect(card(1, plan).text).toContain("Entry 3,215.5 – 3,230");
    expect(card(1, plan).text).toContain("Stop 3,195.25 · Target 3,300");
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
    expect(text).toContain("Entry closes 23 Oct, 18:00:30 UTC");
    expect(text).not.toMatch(/\n\n\n/);
  });
});

describe("the Telegram card of a replay plan", () => {
  it("starts with Replay:", () => {
    const replay = publishedPlanSchema.parse({ ...longPlan, environment: "replay" });
    expect(card(1, replay).text).toMatch(/^Replay: Range Traders · BTC-USD long/);
    expect(card(1).text).toMatch(/^Range Traders · BTC-USD long/);
  });
});
