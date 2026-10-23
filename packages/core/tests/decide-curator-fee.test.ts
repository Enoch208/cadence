import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { appliedCuratorFee, curatorFeeCharge, type BuilderApproval } from "../src/curator-fee";
import { decide } from "../src/decide";
import type { DecisionInput, Proposal } from "../src/decision";
import { longInput } from "./fixtures/decision";

const curatorFee = { builderCode: "range_traders", feeBps: 5 };
const approved: BuilderApproval = { builderCode: "range_traders", maxFeeBps: 5 };

const withCuratorFee = (builderApproval: BuilderApproval | null): DecisionInput => ({
  ...longInput(),
  plan: { ...longInput().plan, curatorFee },
  builderApproval,
});

function proposalOf(input: DecisionInput): Proposal {
  const decision = decide(input);
  if (decision.outcome === "BLOCKED") {
    throw new Error(`Expected a proposal, got ${decision.reasons.join(", ")}`);
  }
  return decision.proposal;
}

describe("the curator fee in a preview", () => {
  it("prices the fee on the entry and the stop fill into the planned risk", () => {
    const free = proposalOf(longInput());
    const charged = proposalOf(withCuratorFee(approved));
    const { plan } = longInput();
    const perUnit = new Decimal(charged.limitPrice).plus(plan.stopPrice).times("0.0005");
    expect(charged.curatorFee).toEqual(curatorFee);
    expect(charged.costs.curatorFee).toBe(
      perUnit.times(charged.quantity).toDecimalPlaces(2, Decimal.ROUND_CEIL).toFixed(2),
    );
    expect(new Decimal(charged.costs.curatorFee).greaterThan(0)).toBe(true);
    const parts = [charged.priceLoss, ...Object.values(charged.costs)];
    expect(Decimal.sum(...parts).toFixed(2)).toBe(charged.plannedLoss);
    expect(new Decimal(charged.plannedLoss).lessThanOrEqualTo(charged.admissibleBudget)).toBe(true);
    expect(new Decimal(charged.quantity).lessThan(free.quantity)).toBe(true);
    expect(new Decimal(charged.rewardRiskNet).lessThan(free.rewardRiskNet)).toBe(true);
  });

  it("leaves the order untouched when the account is not approved for the curator's code", () => {
    const free = proposalOf(longInput());
    const strangers: (BuilderApproval | null)[] = [
      null,
      { builderCode: "cadence", maxFeeBps: 100 },
      { builderCode: "range_traders", maxFeeBps: 4 },
      { builderCode: "Range_Traders", maxFeeBps: 5 },
    ];
    for (const approval of strangers) {
      expect(proposalOf(withCuratorFee(approval))).toEqual(free);
    }
    expect(proposalOf({ ...longInput(), builderApproval: approved })).toEqual(free);
  });

  it("applies the plan's rate, not the higher one the member allowed", () => {
    const generous = { builderCode: "range_traders", maxFeeBps: 100 };
    expect(appliedCuratorFee(withCuratorFee(generous).plan, generous)).toEqual(curatorFee);
    expect(proposalOf(withCuratorFee(generous))).toEqual(proposalOf(withCuratorFee(approved)));
  });
});

describe("the fee Strike charges on a fill", () => {
  it("is the notional times the rate, floored to the cent", () => {
    expect(curatorFeeCharge("84050", "0.00118", 5)).toBe("0.04");
    expect(curatorFeeCharge("84050", "0.01", 20)).toBe("1.68");
    expect(curatorFeeCharge("81742", "0.0003", 1)).toBe("0.00");
    expect(curatorFeeCharge("100000", "1", 20)).toBe("200.00");
  });
});
