import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { curatorFeeMaxBps, decisionOutcomes } from "../src/contract";
import { admissibleBudget, perUnitLoss } from "../src/costs";
import { decide } from "../src/decide";
import type { Decision, DecisionInput, Proposal } from "../src/decision";
import { floorToGrid, floorToStep } from "../src/grid";
import { executablePrice, fillableSize, withinPriceBounds } from "../src/pricing";
import { curatorFeeRateFor } from "../src/sizing";
import { generatedInput, mirrored, units, type Profile } from "./fixtures/generated";
import { budgetCuts, withWorseQuote } from "./fixtures/transforms";
import { seededRandom } from "./support/random";

const cases = 200;
const realistic: Profile = { proportionalCosts: true };

const generated = (seed: number, profile: Profile) => {
  const random = seededRandom(seed);
  return Array.from({ length: cases }, () => generatedInput(random, profile));
};

const quantityOrZero = (decision: Decision) =>
  new Decimal(decision.outcome === "BLOCKED" ? "0" : decision.proposal.quantity);

const proposalOf = (decision: Decision): Proposal | null =>
  decision.outcome === "BLOCKED" ? null : decision.proposal;

const reachableDepth = (input: DecisionInput, proposal: Proposal) =>
  new Decimal(
    fillableSize({
      direction: input.plan.direction,
      book: input.book,
      limitPrice: proposal.limitPrice,
    }),
  );

describe("decide properties over generated inputs", () => {
  it("reaches every outcome, so no property below holds vacuously", () => {
    const outcomes = generated(1, realistic).map((input) => decide(input).outcome);
    for (const outcome of decisionOutcomes) {
      expect(outcomes.filter((seen) => seen === outcome).length).toBeGreaterThanOrEqual(20);
    }
  });

  it("never increases the quantity for a lower budget", () => {
    const random = seededRandom(2);
    for (const input of generated(2, realistic)) {
      const cut = random.pick(budgetCuts)(random, input);
      expect(quantityOrZero(decide(cut)).lessThanOrEqualTo(quantityOrZero(decide(input)))).toBe(
        true,
      );
    }
  });

  it("never increases the quantity for a worse quote unless more depth came within reach", () => {
    const random = seededRandom(3);
    let compared = 0;
    for (const input of generated(3, realistic)) {
      const worse = withWorseQuote(random, input);
      const before = proposalOf(decide(input));
      const after = worse === null ? null : proposalOf(decide(worse));
      if (worse === null || before === null || after === null) {
        continue;
      }
      compared += 1;
      const grew = new Decimal(after.quantity).greaterThan(before.quantity);
      const deeper = reachableDepth(worse, after).greaterThan(reachableDepth(input, before));
      expect(!grew || deeper).toBe(true);
      expect(new Decimal(after.plannedLoss).lessThanOrEqualTo(after.admissibleBudget)).toBe(true);
    }
    expect(compared).toBeGreaterThanOrEqual(20);
  });

  it("never increases the quantity for a higher taker fee", () => {
    const random = seededRandom(4);
    for (const input of generated(4, realistic)) {
      const takerRate = new Decimal(input.fees.takerRate)
        .plus(units(random.integer(1, 10), "0.0001"))
        .toFixed();
      const pricier = { ...input, fees: { ...input.fees, takerRate } };
      expect(quantityOrZero(decide(pricier)).lessThanOrEqualTo(quantityOrZero(decide(input)))).toBe(
        true,
      );
    }
  });

  it("never increases the quantity for a curator fee, or for a higher one", () => {
    const random = seededRandom(9);
    let charged = 0;
    for (const input of generated(9, realistic)) {
      const feeBps = random.integer(1, curatorFeeMaxBps - 1);
      const higher = feeBps + random.integer(1, curatorFeeMaxBps - feeBps);
      const withFee = (bps: number): DecisionInput => ({
        ...input,
        plan: { ...input.plan, curatorFee: { builderCode: "range_traders", feeBps: bps } },
        builderApproval: { builderCode: "range_traders", maxFeeBps: curatorFeeMaxBps },
      });
      const free = quantityOrZero(decide(input));
      const lower = quantityOrZero(decide(withFee(feeBps)));
      const pricier = quantityOrZero(decide(withFee(higher)));
      expect(lower.lessThanOrEqualTo(free)).toBe(true);
      expect(pricier.lessThanOrEqualTo(lower)).toBe(true);
      const proposal = proposalOf(decide(withFee(feeBps)));
      if (proposal !== null) {
        charged += 1;
        expect(proposal.curatorFee).toEqual({ builderCode: "range_traders", feeBps });
        expect(new Decimal(proposal.plannedLoss).lessThanOrEqualTo(proposal.admissibleBudget)).toBe(
          true,
        );
      }
    }
    expect(charged).toBeGreaterThanOrEqual(20);
  });

  it("never plans a loss beyond the admissible budget, and never understates it", () => {
    for (const input of generated(5, realistic)) {
      const proposal = proposalOf(decide(input));
      if (proposal === null) {
        continue;
      }
      const perUnit = perUnitLoss({
        direction: input.plan.direction,
        entry: proposal.limitPrice,
        stop: input.plan.stopPrice,
        fees: input.fees,
        policy: input.policy,
        mark: input.mark,
        curatorFeeRate: curatorFeeRateFor(input),
      });
      const exactLoss = new Decimal(proposal.quantity).times(perUnit.total);
      const budget = admissibleBudget(input);
      expect(exactLoss.lessThanOrEqualTo(budget)).toBe(true);
      expect(new Decimal(proposal.plannedLoss).lessThanOrEqualTo(budget)).toBe(true);
      expect(new Decimal(proposal.plannedLoss).greaterThanOrEqualTo(exactLoss)).toBe(true);
    }
  });

  it("keeps every bounded entry inside the range, on Strike's grids and fillable", () => {
    for (const input of generated(6, realistic)) {
      const proposal = proposalOf(decide(input));
      if (proposal === null) {
        continue;
      }
      const { plan, market } = input;
      const limit = new Decimal(proposal.limitPrice);
      const quote = executablePrice(plan.direction, input.book) ?? "";
      const quantity = new Decimal(proposal.quantity);
      expect(
        limit.greaterThanOrEqualTo(plan.entryMin) && limit.lessThanOrEqualTo(plan.entryMax),
      ).toBe(true);
      expect(plan.direction === "long" ? limit.gte(quote) : limit.lte(quote)).toBe(true);
      expect(withinPriceBounds({ price: proposal.limitPrice, mark: input.mark, market })).toBe(
        true,
      );
      expect(floorToGrid(proposal.limitPrice, market.minPrice, market.tickSize)).toBe(
        proposal.limitPrice,
      );
      expect(floorToStep(proposal.quantity, market.limitStepSize)).toBe(proposal.quantity);
      expect(quantity.greaterThanOrEqualTo(market.limitMinSize)).toBe(true);
      expect(quantity.times(limit).greaterThanOrEqualTo(market.minNotional)).toBe(true);
      expect(quantity.lessThanOrEqualTo(reachableDepth(input, proposal))).toBe(true);
    }
  });

  it("gives identical output for identical input", () => {
    const again = generated(7, realistic);
    generated(7, realistic).forEach((input, index) => {
      expect(decide(input)).toEqual(decide(input));
      expect(decide(again[index] ?? input)).toEqual(decide(input));
    });
  });

  it("gives a mirrored short the mirrored outcome of a long", () => {
    const outcomes = new Set<string>();
    for (const long of generated(8, { direction: "long", proportionalCosts: false })) {
      const short = mirrored(long);
      const longDecision = decide(long);
      const shortDecision = decide(short);
      outcomes.add(longDecision.outcome);
      expect(shortDecision.outcome).toBe(longDecision.outcome);
      expect(shortDecision.reasons).toEqual(longDecision.reasons);
      const longProposal = proposalOf(longDecision);
      const shortProposal = proposalOf(shortDecision);
      if (longProposal === null || shortProposal === null) {
        continue;
      }
      const axis = new Decimal(long.plan.entryMin).plus(long.plan.entryMax);
      expect(shortProposal.limitPrice).toBe(axis.minus(longProposal.limitPrice).toFixed());
      for (const field of [
        "quantity",
        "limitedBy",
        "priceLoss",
        "plannedLoss",
        "rewardRiskNet",
      ] as const) {
        expect(shortProposal[field]).toBe(longProposal[field]);
      }
      expect(shortProposal.costs).toEqual(longProposal.costs);
    }
    expect([...outcomes].sort()).toEqual([...decisionOutcomes].sort());
  });
});
