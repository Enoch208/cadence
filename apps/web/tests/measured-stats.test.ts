import { describe, expect, it } from "vitest";
import { displayCount, readMeasuredStats } from "../src/lib/measured-stats";

const live = {
  measuredAt: 1,
  plansPublished: 3,
  ordersPlaced: 2,
  exitsVerified: 2,
  lateEntriesDeclined: 0,
  duplicateOrders: 0,
};

describe("the landing page's measured counters", () => {
  it("shows a dash for anything not yet measured", () => {
    const stats = readMeasuredStats(live);
    expect(displayCount(stats, "plansPublished")).toBe("3");
    expect(displayCount(stats, "lateEntriesDeclined")).toBe("—");
    expect(displayCount(null, "ordersPlaced")).toBe("—");
  });

  it("claims zero duplicate orders only once real orders exist", () => {
    expect(displayCount(readMeasuredStats(live), "duplicateOrders")).toBe("0");
    expect(displayCount(readMeasuredStats({ ...live, ordersPlaced: 0 }), "duplicateOrders")).toBe(
      "—",
    );
  });

  it("refuses anything that is not a set of whole, non-negative counts", () => {
    expect(readMeasuredStats("<!doctype html>")).toBeNull();
    expect(readMeasuredStats({ ...live, ordersPlaced: -1 })).toBeNull();
    expect(readMeasuredStats({ ...live, exitsVerified: "2" })).toBeNull();
    expect(readMeasuredStats({ ...live, plansPublished: 1.5 })).toBeNull();
  });
});
