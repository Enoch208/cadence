import type { PublishedPlan } from "@cadence/core";
import type { CommunityRow, PlanRow } from "@cadence/db";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { describeFailure } from "../http/errors";
import { planCard } from "./card";

export async function postPlanCard(
  deps: AppDeps,
  args: {
    plan: PlanRow;
    community: CommunityRow;
    payload: PublishedPlan;
    version: number;
    userId: string;
  },
): Promise<boolean> {
  const card = planCard({
    plan: args.payload,
    version: args.version,
    publicId: args.plan.publicId,
    communityName: args.community.name,
    chatId: args.community.telegramChatId.toString(),
    webOrigin: deps.env.PUBLIC_WEB_ORIGIN,
  });
  const event = {
    actor: userActor(args.userId),
    correlationId: args.plan.id,
    environment: args.payload.environment,
  };
  try {
    const { messageId } = await deps.telegram.postPlanCard(card);
    await recordEvent(deps.db, {
      ...event,
      at: deps.now(),
      type: "plan_card_posted",
      data: { version: args.version, messageId },
    });
    return true;
  } catch (error) {
    process.stderr.write(`Posting the plan card failed. ${describeFailure(error)}\n`);
    await recordEvent(deps.db, {
      ...event,
      at: deps.now(),
      type: "plan_card_failed",
      data: { version: args.version },
    });
    return false;
  }
}
