import { describe, expect, it } from "vitest";
import { planVersionDigest } from "../src/digest";
import { curatorFeeReplayOnly, publishedPlanSchema } from "../src/plan";

const terms = {
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "84000",
  entryMax: "84400",
  stopPrice: "83200",
  targetPrice: "86800",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-23T18:00:00Z",
  rationale: "Reclaim of the weekly open with a stop under the range low.",
  environment: "live",
};

const digestBeforeCuratorFees = "4c482500c9a7edfdd994e1d1bdbca208312bd6feed14db28eb510c719c93b81d";

const replayTerms = { ...terms, environment: "replay" };

const curatorFeeIssues = (curatorFee: unknown, on: object = replayTerms) => {
  const result = publishedPlanSchema.safeParse({ ...on, curatorFee });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("a curator fee on a published plan", () => {
  it("keeps the digest of a version published before curator fees existed", () => {
    const plan = publishedPlanSchema.parse(terms);
    expect(Object.keys(plan)).not.toContain("curatorFee");
    expect(planVersionDigest(plan)).toBe(digestBeforeCuratorFees);
  });

  it("is part of the digest, so a different code or rate is a different version", () => {
    const withFee = (builderCode: string, feeBps: number) =>
      planVersionDigest(
        publishedPlanSchema.parse({ ...replayTerms, curatorFee: { builderCode, feeBps } }),
      );
    const digests = [
      planVersionDigest(publishedPlanSchema.parse(replayTerms)),
      withFee("range_traders", 5),
      withFee("range_traders", 6),
      withFee("range-traders", 5),
    ];
    expect(new Set(digests).size).toBe(digests.length);
    expect(withFee("range_traders", 5)).toBe(withFee("range_traders", 5));
  });

  it("takes a Strike builder code and a whole number of basis points from 1 to 20", () => {
    expect(curatorFeeIssues({ builderCode: "range_traders", feeBps: 1 })).toEqual([]);
    expect(curatorFeeIssues({ builderCode: "Range-Traders_2", feeBps: 20 })).toEqual([]);
    for (const feeBps of [0, 21, 100, 2.5, -1]) {
      expect(curatorFeeIssues({ builderCode: "range_traders", feeBps })).toEqual([
        "curatorFee.feeBps",
      ]);
    }
    for (const builderCode of ["", "has space", "x".repeat(65), "naïve"]) {
      expect(curatorFeeIssues({ builderCode, feeBps: 5 })).toEqual(["curatorFee.builderCode"]);
    }
    expect(curatorFeeIssues({ builderCode: "range_traders", feeBps: 5, share: 1 })).toEqual([
      "curatorFee",
    ]);
  });

  it("is refused on a live plan until curator fees have run on Strike mainnet", () => {
    const result = publishedPlanSchema.safeParse({
      ...terms,
      curatorFee: { builderCode: "range_traders", feeBps: 5 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { path: ["curatorFee"], message: curatorFeeReplayOnly },
    ]);
  });
});
