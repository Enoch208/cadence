import { describe, expect, it } from "vitest";
import { funnelLine } from "../src/lib/funnel";

const quiet = { previewed: 0, couldTake: 0, approved: 0, filled: 0 };

describe("a plan's funnel line", () => {
  it("says plainly when nobody has previewed the plan", () => {
    expect(funnelLine({ funnel: quiet, environment: "live" })).toBe(
      "No member has previewed it yet.",
    );
  });

  it("reads each stage in order, in members", () => {
    expect(
      funnelLine({
        funnel: { previewed: 12, couldTake: 9, approved: 5, filled: 4 },
        environment: "live",
      }),
    ).toBe("12 members previewed · 9 could take it · 5 approved · 4 filled on Strike");
    expect(funnelLine({ funnel: { ...quiet, previewed: 1 }, environment: "live" })).toBe(
      "1 member previewed · 0 could take it · 0 approved · 0 filled on Strike",
    );
  });

  it("never credits Strike with a fill from the replay simulator", () => {
    const line = funnelLine({
      funnel: { previewed: 2, couldTake: 2, approved: 1, filled: 1 },
      environment: "replay",
    });
    expect(line).toBe("2 members previewed · 2 could take it · 1 approved · 1 filled in replay");
    expect(line).not.toContain("Strike");
  });
});
