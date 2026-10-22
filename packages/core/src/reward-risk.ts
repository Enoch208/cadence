import { Decimal } from "decimal.js";
import type { Direction } from "./contract";

export type RewardRiskInput = {
  direction: Direction;
  entry: string;
  stopPrice: string;
  targetPrice: string;
};

export function rewardToRiskBeforeCosts(input: RewardRiskInput, places: number): string | null {
  const entry = new Decimal(input.entry);
  const reward =
    input.direction === "long"
      ? new Decimal(input.targetPrice).minus(entry)
      : entry.minus(input.targetPrice);
  const risk =
    input.direction === "long"
      ? entry.minus(input.stopPrice)
      : new Decimal(input.stopPrice).minus(entry);
  if (risk.lessThanOrEqualTo(0) || reward.lessThanOrEqualTo(0)) {
    return null;
  }
  return reward.dividedBy(risk).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}
