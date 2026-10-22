import type { AppDeps } from "../deps";
import { HttpError, unprocessable } from "../http/errors";
import { strikeMarkets } from "../plan/fields";
import {
  DraftingDeclinedError,
  DraftingUnavailableError,
  type PlanDrafter,
  type SetupRequest,
} from "./contract";
import { verifySetup, type VerifiedDraft } from "./verify";

const draftsPerWindow = 12;
const windowMs = 10 * 60_000;

export type DraftAllowance = (userId: string, now: number) => void;

export function createDraftAllowance(): DraftAllowance {
  const recent = new Map<string, number[]>();
  return (userId, now) => {
    const kept = (recent.get(userId) ?? []).filter((at) => at > now - windowMs);
    if (kept.length >= draftsPerWindow) {
      throw new HttpError(
        429,
        "DRAFTING_BUSY",
        "You have drafted many plans in the last few minutes. Wait a little, or fill this one in by hand.",
      );
    }
    recent.set(userId, [...kept, now]);
  };
}

async function readWith(drafter: PlanDrafter, request: SetupRequest) {
  try {
    return await drafter.read(request);
  } catch (error) {
    if (error instanceof DraftingDeclinedError) {
      throw unprocessable(
        "DRAFT_DECLINED",
        "The model declined to read that message. Fill the plan in by hand.",
      );
    }
    if (error instanceof DraftingUnavailableError) {
      process.stderr.write(`Drafting a plan failed. ${error.message}\n`);
      throw new HttpError(
        503,
        "DRAFTING_UNAVAILABLE",
        "Drafting is not available right now. Try again in a moment, or fill the plan in by hand.",
      );
    }
    throw error;
  }
}

export async function draftPlan(
  deps: Pick<AppDeps, "drafter" | "strike" | "now">,
  request: { userId: string; text: string; allow: DraftAllowance },
): Promise<{ draft: VerifiedDraft; model: string }> {
  if (deps.drafter === null) {
    throw new HttpError(
      503,
      "DRAFTING_OFF",
      "Drafting from a message is not switched on for this server. Fill the plan in by hand.",
    );
  }
  const now = deps.now();
  request.allow(request.userId, now);
  const markets = (await strikeMarkets(deps))
    .filter((market) => market.status === "trading" && !market.reduceOnly)
    .map((market) => market.symbol);
  const read = await readWith(deps.drafter, {
    text: request.text,
    markets,
    now: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  if (!read.setup.isTradeSetup) {
    throw unprocessable(
      "NOT_A_SETUP",
      "That message does not read like a trade setup. Paste the one with the market, entry, stop and target.",
    );
  }
  return {
    draft: verifySetup(read.setup, { text: request.text, markets, now }),
    model: read.model,
  };
}
