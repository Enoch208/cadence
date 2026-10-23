import { Decimal } from "decimal.js";
import type { DecimalString } from "@cadence/core";
import { submitGraceMs } from "./entry-verdict";
import type { EventData } from "./events";
import type { ExitsSummary } from "./exits";
import type { Step } from "./settle";

export const exitGraceMs = submitGraceMs;

export type OpenState = "open_verifying" | "open_verified" | "recovery_required";

export type OpenEvidence = {
  state: OpenState;
  positionSize: DecimalString;
  oppositePosition: boolean;
  exits: ExitsSummary;
  flatByFills: boolean;
  closing: boolean;
  openSize: DecimalString;
  sinceFillMs: number;
};

export type OpenVerdict = { steps: readonly Step[]; recover: boolean; pause: boolean };

const hold = (overrides: Partial<OpenVerdict> = {}): OpenVerdict => ({
  steps: [],
  recover: false,
  pause: false,
  ...overrides,
});

const missing = (data: EventData): OpenVerdict => ({
  steps: [{ event: "exits_missing", data }],
  recover: true,
  pause: false,
});

export function openVerdict(evidence: OpenEvidence): OpenVerdict {
  const { state, exits, positionSize } = evidence;
  if (evidence.oppositePosition) {
    return hold({ pause: true });
  }
  const held = new Decimal(positionSize).greaterThan(0);
  if (!held) {
    const closeUnattributed = evidence.closing && new Decimal(evidence.openSize).greaterThan(0);
    if (exits.live || !evidence.flatByFills || closeUnattributed) {
      return hold();
    }
    const data = { positionSize };
    return hold({
      steps: [
        { event: state === "recovery_required" ? "recovery_confirmed" : "close_reconciled", data },
      ],
    });
  }
  if (exits.armed) {
    return state === "open_verified"
      ? hold()
      : hold({ steps: [{ event: "exits_verified", data: { positionSize } }] });
  }
  if (exits.exiting) {
    return hold();
  }
  if (state === "recovery_required") {
    return hold({ recover: true });
  }
  if (state === "open_verifying" && evidence.sinceFillMs < exitGraceMs) {
    return hold();
  }
  return missing({ positionSize, exitsLive: exits.live });
}
