import { Decimal } from "decimal.js";
import type { DecisionInput } from "../../src/decision";
import type { BookLevel } from "../../src/market";
import { riskPolicySchema } from "../../src/policy";
import { executablePrice } from "../../src/pricing";
import type { Random } from "../support/random";
import { units } from "./generated";

const lowered = (random: Random, amount: string) =>
  Decimal.max("0.01", new Decimal(amount).times(random.integer(1, 99)).dividedBy(100))
    .toDecimalPlaces(2, Decimal.ROUND_FLOOR)
    .toFixed();

const raised = (random: Random, amount: string) =>
  new Decimal(amount).plus(units(random.integer(1, 2_000), "0.01")).toFixed();

export const budgetCuts: readonly ((random: Random, input: DecisionInput) => DecisionInput)[] = [
  (random, input) => ({
    ...input,
    policy: riskPolicySchema.parse({
      ...input.policy,
      perTradeBudget: lowered(random, input.policy.perTradeBudget),
    }),
  }),
  (random, input) => ({
    ...input,
    policy: riskPolicySchema.parse({
      ...input.policy,
      aggregateBudget: lowered(random, input.policy.aggregateBudget),
    }),
  }),
  (random, input) => ({
    ...input,
    policy: riskPolicySchema.parse({
      ...input.policy,
      sessionBudget: lowered(random, input.policy.sessionBudget),
    }),
  }),
  (random, input) => ({
    ...input,
    exposure: { ...input.exposure, committedRisk: raised(random, input.exposure.committedRisk) },
  }),
  (random, input) => ({
    ...input,
    exposure: {
      ...input.exposure,
      realizedSessionLoss: raised(random, input.exposure.realizedSessionLoss),
    },
  }),
];

export function withWorseQuote(random: Random, input: DecisionInput): DecisionInput | null {
  const { plan, book } = input;
  const quote = executablePrice(plan.direction, book);
  if (
    quote === null ||
    new Decimal(quote).lessThan(plan.entryMin) ||
    new Decimal(quote).greaterThan(plan.entryMax)
  ) {
    return null;
  }
  const long = plan.direction === "long";
  const room = long
    ? new Decimal(plan.entryMax).minus(quote)
    : new Decimal(quote).minus(plan.entryMin);
  if (room.isZero()) {
    return null;
  }
  const by = new Decimal(random.integer(1, room.toNumber())).times(long ? 1 : -1);
  const move = (levels: readonly BookLevel[]) =>
    levels.map(([price, size]): BookLevel => [by.plus(price).toFixed(), size]);
  return {
    ...input,
    book: long ? { ...book, asks: move(book.asks) } : { ...book, bids: move(book.bids) },
  };
}
