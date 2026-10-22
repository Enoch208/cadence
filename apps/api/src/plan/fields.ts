import {
  isOrderablePrice,
  publishedPlanSchema,
  type Environment,
  type MarketRules,
  type PublishedPlan,
} from "@cadence/core";
import type { AppDeps } from "../deps";
import { describeIssues } from "../http/body";
import { describeFailure, HttpError, unprocessable } from "../http/errors";

const pricedFields = ["entryMin", "entryMax", "stopPrice", "targetPrice"] as const;

async function strikeMarkets(deps: Pick<AppDeps, "strike">): Promise<readonly MarketRules[]> {
  try {
    return await deps.strike.public().markets();
  } catch (error) {
    process.stderr.write(`Reading Strike markets failed. ${describeFailure(error)}\n`);
    throw new HttpError(
      503,
      "STRIKE_UNAVAILABLE",
      "Strike's market list could not be read. Try again in a moment.",
    );
  }
}

function withEnvironment(fields: Record<string, unknown>, fixed: Environment | null) {
  if (fixed === null) {
    return { environment: "live", ...fields };
  }
  if (fields.environment !== undefined && fields.environment !== fixed) {
    throw unprocessable(
      "ENVIRONMENT_FIXED",
      `This plan runs in ${fixed}. Publish a new plan to use another environment.`,
    );
  }
  return { ...fields, environment: fixed };
}

function requireOrderablePrices(plan: PublishedPlan, market: MarketRules): void {
  const field = pricedFields.find((name) => !isOrderablePrice(plan[name], market));
  if (field !== undefined) {
    throw unprocessable(
      "PRICE_NOT_ORDERABLE",
      `${field}: ${plan[field]} is not a price Strike accepts. ${market.symbol} prices go in steps of ${market.tickSize} from ${market.minPrice} to ${market.maxPrice}.`,
    );
  }
}

export async function admissiblePlan(
  deps: Pick<AppDeps, "strike" | "now">,
  fields: Record<string, unknown>,
  fixedEnvironment: Environment | null,
): Promise<PublishedPlan> {
  const parsed = publishedPlanSchema.safeParse(withEnvironment(fields, fixedEnvironment));
  if (!parsed.success) {
    throw unprocessable("PLAN_INVALID", describeIssues(parsed.error));
  }
  const plan = parsed.data;
  if (Date.parse(plan.entryExpiresAt) <= deps.now()) {
    throw unprocessable("ENTRY_WINDOW_CLOSED", "The entry window must close in the future.");
  }
  const market = (await strikeMarkets(deps)).find((rules) => rules.symbol === plan.market);
  if (market === undefined) {
    throw unprocessable("UNKNOWN_MARKET", `Strike has no market named ${plan.market}.`);
  }
  if (market.status !== "trading" || market.reduceOnly) {
    throw unprocessable(
      "MARKET_NOT_TRADING",
      `${plan.market} is not open for new positions on Strike right now.`,
    );
  }
  requireOrderablePrices(plan, market);
  return plan;
}
