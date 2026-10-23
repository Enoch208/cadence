import { describe, expect, it } from "vitest";
import {
  computedFrom,
  curatorFeeConsent,
  curatorFeeNotApplied,
  curatorFeeNotYetLive,
  curatorFeeRate,
  curatorFeeTerms,
} from "../src/lib/copy/curator-fee";
import { curatorFeesLine } from "../src/lib/funnel";

const curatorFee = { builderCode: "range_traders", feeBps: 5 };
const banned = /risk-free|guarantee|protected|trustless/i;

describe("the words around a curator fee", () => {
  it("states the rate as a percentage of each fill", () => {
    expect(curatorFeeRate({ feeBps: 1 })).toBe("0.01%");
    expect(curatorFeeRate({ feeBps: 5 })).toBe("0.05%");
    expect(curatorFeeRate({ feeBps: 20 })).toBe("0.20%");
    expect(curatorFeeTerms(curatorFee)).toBe("0.05% of each fill, to builder code range_traders");
    expect(curatorFeeConsent(curatorFee, "$0.84")).toBe(
      "It includes the curator’s fee of 0.05% on each fill, $0.84 on the entry and the stop, paid to builder code range_traders.",
    );
  });

  it("says plainly when the fee does not apply to the member's account", () => {
    expect(curatorFeeNotApplied(curatorFee)).toBe(
      "The curator’s fee does not apply to this account: it was not connected under builder code range_traders at 0.05% or more, so the order goes out without it.",
    );
  });

  it("labels the earned fee as computed and never credits Strike with replay", () => {
    const earned = { computed: "1.13", fills: 2 };
    const replay = curatorFeesLine({
      curatorFee,
      curatorFeesEarned: earned,
      environment: "replay",
    });
    expect(replay).toBe(
      "Curator fee 0.05%: $1.13 earned from 2 fills, computed from the fills in replay.",
    );
    expect(replay).not.toMatch(/strike/i);
    expect(computedFrom.replay).not.toMatch(/strike/i);
    const live = curatorFeesLine({ curatorFee, curatorFeesEarned: earned, environment: "live" });
    expect(live).toContain(curatorFeeNotYetLive);
    expect(curatorFeeNotYetLive).toBe(
      "Curator fees run on replay plans only, until they have run on Strike mainnet.",
    );
    for (const copy of [replay, live, curatorFeeNotApplied(curatorFee), computedFrom.live]) {
      expect(copy).not.toMatch(banned);
    }
  });
});
