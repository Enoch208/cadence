import { Decimal } from "decimal.js";
import { limitingFactors, type DecimalString, type LimitingFactor } from "./contract";
import { perUnitLoss, type PerUnitLoss } from "./costs";
import { appliedCuratorFee, curatorFeeRate } from "./curator-fee";
import type { CostBreakdown, DecisionInput } from "./decision";
import { Exact, moneyPlaces, roundTo } from "./exact";
import { floorToStep } from "./grid";
import {
  estimatedLiquidationPrice,
  maxQuantityForLeverage,
  maxQuantityForMargin,
  tierForNotional,
} from "./margin";
import { fillableSize } from "./pricing";

export type SizedEntry = {
  limitPrice: DecimalString;
  budget: DecimalString;
  perUnit: PerUnitLoss;
  quantity: DecimalString;
  limitedBy: LimitingFactor;
};

export type PlannedLoss = {
  priceLoss: DecimalString;
  costs: CostBreakdown;
  plannedLoss: DecimalString;
};

export type EntryTerms = {
  notional: Decimal;
  rewardRisk: Decimal;
  liquidationPrice: DecimalString | null;
};

export function plannedLossFor(quantity: DecimalString, perUnit: PerUnitLoss): PlannedLoss {
  const reserve = (perUnitAmount: DecimalString) =>
    roundTo(new Exact(quantity).times(perUnitAmount), moneyPlaces, Decimal.ROUND_CEIL);
  const priceLoss = reserve(perUnit.priceLoss);
  const costs: CostBreakdown = {
    entryFee: reserve(perUnit.entryFee),
    exitFee: reserve(perUnit.exitFee),
    stopSlippageReserve: reserve(perUnit.stopSlippageReserve),
    fundingReserve: reserve(perUnit.fundingReserve),
    curatorFee: reserve(perUnit.curatorFee),
  };
  const plannedLoss = new Exact(priceLoss)
    .plus(costs.entryFee)
    .plus(costs.exitFee)
    .plus(costs.stopSlippageReserve)
    .plus(costs.fundingReserve)
    .plus(costs.curatorFee);
  return { priceLoss, costs, plannedLoss: plannedLoss.toFixed(moneyPlaces) };
}

const reserveRoundingSlack = "0.06";

export const curatorFeeRateFor = (input: DecisionInput) =>
  curatorFeeRate(appliedCuratorFee(input.plan, input.builderApproval));

function budgetQuantity(budget: DecimalString, perUnit: PerUnitLoss, step: DecimalString) {
  const lotsWithin = (amount: Decimal) =>
    Exact.max(
      0,
      amount.dividedBy(perUnit.total).dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_FLOOR),
    );
  const quantityOf = (lots: Decimal) => floorToStep(lots.times(step).toFixed(), step);
  const fitsBudget = (lots: Decimal) =>
    new Exact(plannedLossFor(quantityOf(lots), perUnit).plannedLoss).lessThanOrEqualTo(budget);
  let fitting = lotsWithin(new Exact(budget).minus(reserveRoundingSlack));
  let exceeding = lotsWithin(new Exact(budget)).plus(1);
  while (exceeding.minus(fitting).greaterThan(1)) {
    const middle = fitting.plus(exceeding).dividedBy(2).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    if (fitsBudget(middle)) {
      fitting = middle;
    } else {
      exceeding = middle;
    }
  }
  return quantityOf(fitting);
}

export function sizeEntry(
  input: DecisionInput,
  limitPrice: DecimalString,
  budget: DecimalString,
): SizedEntry {
  const { plan, market, accountState, fees } = input;
  const step = market.limitStepSize;
  const leverage = accountState.symbolSettings.leverage;
  const perUnit = perUnitLoss({
    direction: plan.direction,
    entry: limitPrice,
    stop: plan.stopPrice,
    fees,
    policy: input.policy,
    mark: input.mark,
    curatorFeeRate: curatorFeeRateFor(input),
  });
  const ceiling = input.quantityCeiling;
  const budgetBound = budgetQuantity(budget, perUnit, step);
  const bounds: Record<LimitingFactor, DecimalString | null> = {
    budget: budgetBound,
    ceiling: ceiling === null ? null : floorToStep(Exact.max(0, ceiling).toFixed(), step),
    depth: floorToStep(
      fillableSize({ direction: plan.direction, book: input.book, limitPrice }),
      step,
    ),
    margin: maxQuantityForMargin({
      availableBalance: accountState.account.availableBalance,
      limitPrice,
      leverage,
      takerRate: fees.takerRate,
      step,
    }),
    max_order_size: floorToStep(market.limitMaxSize, step),
    leverage_tier: maxQuantityForLeverage({
      leverage,
      limitPrice,
      tiers: market.marginTiers,
      step,
    }),
  };
  let quantity = budgetBound;
  let limitedBy: LimitingFactor = "budget";
  for (const factor of limitingFactors) {
    const bound = bounds[factor];
    if (bound !== null && new Exact(bound).lessThan(quantity)) {
      quantity = bound;
      limitedBy = factor;
    }
  }
  return { limitPrice, budget, perUnit, quantity, limitedBy };
}

export function entryTerms(input: DecisionInput, sized: SizedEntry): EntryTerms {
  const { plan, fees } = input;
  const entry = new Exact(sized.limitPrice);
  const notional = entry.times(sized.quantity);
  const grossReward =
    plan.direction === "long"
      ? new Exact(plan.targetPrice).minus(entry)
      : entry.minus(plan.targetPrice);
  const exitAndEntryRate = curatorFeeRateFor(input).plus(fees.takerRate);
  const netReward = grossReward.minus(entry.plus(plan.targetPrice).times(exitAndEntryRate));
  const rewardRisk = netReward.dividedBy(sized.perUnit.total);
  const tier = tierForNotional(notional.toFixed(), input.market.marginTiers);
  const liquidationPrice =
    tier === null || !notional.greaterThan(0)
      ? null
      : estimatedLiquidationPrice({
          direction: plan.direction,
          entry: sized.limitPrice,
          quantity: sized.quantity,
          leverage: input.accountState.symbolSettings.leverage,
          tier,
        });
  return { notional, rewardRisk, liquidationPrice };
}
