import { describe, expect, it } from "vitest";
import { rewardToRiskBeforeCosts } from "../src/reward-risk";

const longAt = (entry: string) =>
  rewardToRiskBeforeCosts({ direction: "long", entry, stopPrice: "98", targetPrice: "106" }, 2);

describe("rewardToRiskBeforeCosts", () => {
  it("gives the original participant three to one", () => {
    expect(longAt("100")).toBe("3.00");
  });

  it("collapses as a long is entered later", () => {
    expect(["101", "102", "103", "104", "105"].map(longAt)).toEqual([
      "1.67",
      "1.00",
      "0.60",
      "0.33",
      "0.14",
    ]);
  });

  it("mirrors the arithmetic for a short", () => {
    expect(
      rewardToRiskBeforeCosts(
        { direction: "short", entry: "100", stopPrice: "102", targetPrice: "94" },
        2,
      ),
    ).toBe("3.00");
  });

  it("has no ratio once the entry has passed the stop or the target", () => {
    expect(longAt("97")).toBeNull();
    expect(longAt("106")).toBeNull();
  });
});
