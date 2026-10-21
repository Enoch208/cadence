import { describe, expect, it } from "vitest";
import { planFieldsSchema, positiveDecimalSchema } from "../src/contract";
import { planGeometryIssues, publishedPlanSchema } from "../src/plan";

const longPlan = {
  schemaVersion: 1,
  market: "BTC-USD",
  direction: "long",
  entryMin: "100",
  entryMax: "101",
  stopPrice: "98",
  targetPrice: "106",
  triggerSource: "mark_price",
  entryExpiresAt: "2026-10-22T18:00:00Z",
  rationale: "Reclaim of the weekly open.",
  environment: "live",
};

const shortPlan = {
  ...longPlan,
  direction: "short",
  stopPrice: "103",
  targetPrice: "94",
};

const failedPaths = (input: unknown) => {
  const result = publishedPlanSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("positiveDecimalSchema", () => {
  it.each(["100", "100.25", "100.00", "0.5", "0.0001", "65000.125"])("accepts %s", (value) => {
    expect(positiveDecimalSchema.safeParse(value).success).toBe(true);
  });

  it.each(["0", "0.0", "-1", "1e5", ".5", "5.", "00.5", "01", " 100", "100 ", "", "1,000", "NaN"])(
    "rejects %j",
    (value) => {
      expect(positiveDecimalSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("planFieldsSchema", () => {
  it("accepts a complete plan", () => {
    expect(planFieldsSchema.safeParse(longPlan).success).toBe(true);
  });

  it("rejects a field the published payload does not define", () => {
    expect(planFieldsSchema.safeParse({ ...longPlan, leverage: "20" }).success).toBe(false);
  });

  it.each(["2026-10-22T19:00:00+01:00", "2026-10-22", "tomorrow"])(
    "requires the entry expiry as a UTC instant, not %j",
    (entryExpiresAt) => {
      expect(planFieldsSchema.safeParse({ ...longPlan, entryExpiresAt }).success).toBe(false);
    },
  );

  it("rejects an environment Cadence does not run in", () => {
    expect(planFieldsSchema.safeParse({ ...longPlan, environment: "testnet" }).success).toBe(false);
  });

  it("rejects a schema version it does not understand", () => {
    expect(planFieldsSchema.safeParse({ ...longPlan, schemaVersion: 2 }).success).toBe(false);
  });
});

describe("publishedPlanSchema geometry", () => {
  it("accepts a long with the stop below and the target above the entry range", () => {
    expect(failedPaths(longPlan)).toEqual([]);
  });

  it("accepts a short with the stop above and the target below the entry range", () => {
    expect(failedPaths(shortPlan)).toEqual([]);
  });

  it("accepts a single entry price", () => {
    expect(failedPaths({ ...longPlan, entryMin: "100", entryMax: "100" })).toEqual([]);
  });

  it("rejects an entry range whose top is below its bottom", () => {
    expect(failedPaths({ ...longPlan, entryMin: "101", entryMax: "100" })).toEqual(["entryMax"]);
  });

  it("rejects a long whose stop touches the entry range", () => {
    expect(failedPaths({ ...longPlan, stopPrice: "100" })).toEqual(["stopPrice"]);
  });

  it("rejects a long whose target touches the entry range", () => {
    expect(failedPaths({ ...longPlan, targetPrice: "101" })).toEqual(["targetPrice"]);
  });

  it("rejects a short whose stop touches the entry range", () => {
    expect(failedPaths({ ...shortPlan, stopPrice: "101" })).toEqual(["stopPrice"]);
  });

  it("rejects a short whose target touches the entry range", () => {
    expect(failedPaths({ ...shortPlan, targetPrice: "100" })).toEqual(["targetPrice"]);
  });

  it("reports a long written as a short on both exits", () => {
    expect(failedPaths({ ...longPlan, direction: "short" })).toEqual(["stopPrice", "targetPrice"]);
  });

  it("compares prices as numbers, not as text", () => {
    expect(failedPaths({ ...longPlan, stopPrice: "9", targetPrice: "1000" })).toEqual([]);
  });

  it("keeps a difference that binary floating point would erase", () => {
    const plan = planFieldsSchema.parse({
      ...longPlan,
      entryMin: "0.30000000000000001",
      entryMax: "0.31",
      stopPrice: "0.3",
      targetPrice: "0.4",
    });
    expect(planGeometryIssues(plan)).toEqual([]);
  });
});
