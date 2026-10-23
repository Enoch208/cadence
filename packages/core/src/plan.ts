import { Decimal } from "decimal.js";
import type { z } from "zod";
import { planFieldsSchema, type PlanFields } from "./contract";

export type PlanGeometryIssue = {
  path: "entryMax" | "stopPrice" | "targetPrice";
  message: string;
};

const isBelow = (lower: string, upper: string) => new Decimal(lower).lessThan(upper);

export function planGeometryIssues(plan: PlanFields): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = [];
  if (isBelow(plan.entryMax, plan.entryMin)) {
    issues.push({
      path: "entryMax",
      message: "The highest entry price cannot be below the lowest entry price.",
    });
  }
  if (plan.direction === "long") {
    if (!isBelow(plan.stopPrice, plan.entryMin)) {
      issues.push({
        path: "stopPrice",
        message: "For a long, the stop must be below the lowest entry price.",
      });
    }
    if (!isBelow(plan.entryMax, plan.targetPrice)) {
      issues.push({
        path: "targetPrice",
        message: "For a long, the target must be above the highest entry price.",
      });
    }
  } else {
    if (!isBelow(plan.entryMax, plan.stopPrice)) {
      issues.push({
        path: "stopPrice",
        message: "For a short, the stop must be above the highest entry price.",
      });
    }
    if (!isBelow(plan.targetPrice, plan.entryMin)) {
      issues.push({
        path: "targetPrice",
        message: "For a short, the target must be below the lowest entry price.",
      });
    }
  }
  return issues;
}

export const curatorFeeReplayOnly =
  "Curator fees run on replay plans only, until they have run on Strike mainnet.";

export const publishedPlanSchema = planFieldsSchema.superRefine(
  (plan, ctx) => {
    for (const issue of planGeometryIssues(plan)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
    if (plan.environment === "live" && plan.curatorFee !== undefined) {
      ctx.addIssue({ code: "custom", path: ["curatorFee"], message: curatorFeeReplayOnly });
    }
  },
  { when: (payload) => payload.issues.length === 0 },
);
export type PublishedPlan = z.infer<typeof publishedPlanSchema>;
