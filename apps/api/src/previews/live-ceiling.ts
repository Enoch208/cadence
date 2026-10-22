import { Decimal } from "decimal.js";
import { floorToStep, type DecimalString, type Environment } from "@cadence/core";

export function liveQuantityCeiling(args: {
  environment: Environment;
  requested: DecimalString | null;
  entryMax: DecimalString;
  liveMaxNotional: DecimalString;
  step: DecimalString;
}): DecimalString | null {
  if (args.environment !== "live") {
    return args.requested;
  }
  const capped = floorToStep(
    new Decimal(args.liveMaxNotional).dividedBy(args.entryMax).toFixed(),
    args.step,
  );
  return args.requested !== null && new Decimal(args.requested).lessThan(capped)
    ? args.requested
    : capped;
}
