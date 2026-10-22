import { Decimal } from "decimal.js";
import type { ExchangeOrderSnapshot, IntentEvent } from "@cadence/core";
import type { EventData } from "./events";
import type { Step } from "./settle";

export const submitGraceMs = 10_000;
export const silentDropMs = 30_000;

export type EntryEvidence = {
  state: "submitted" | "unknown";
  entry: ExchangeOrderSnapshot | null;
  sinceSubmitMs: number;
  traced: boolean;
};

export type EntryVerdict = { steps: readonly Step[]; pause: boolean };

const wait: EntryVerdict = { steps: [], pause: false };

const terminalEvents: Partial<Record<ExchangeOrderSnapshot["status"], IntentEvent>> = {
  rejected: "exchange_rejected",
  expired: "entry_unfilled",
  canceled: "entry_canceled",
};

const entryData = (entry: ExchangeOrderSnapshot): EventData => ({
  exchangeOrderId: entry.orderId,
  status: entry.status,
  filled: entry.filled,
  closeReason: entry.closeReason,
});

function foundEntry(state: EntryEvidence["state"], entry: ExchangeOrderSnapshot): EntryVerdict {
  const data = entryData(entry);
  const found: Step[] = state === "unknown" ? [{ event: "acknowledged", data }] : [];
  if (new Decimal(entry.filled).greaterThan(0)) {
    return { steps: [...found, { event: "fill_observed", data }], pause: false };
  }
  const ended = terminalEvents[entry.status];
  return { steps: ended === undefined ? found : [...found, { event: ended, data }], pause: false };
}

export function entryVerdict(evidence: EntryEvidence): EntryVerdict {
  if (evidence.entry !== null) {
    return foundEntry(evidence.state, evidence.entry);
  }
  if (evidence.sinceSubmitMs < submitGraceMs) {
    return wait;
  }
  if (evidence.traced) {
    const data = { evidence: "an order, position or fill exists but the entry cannot be found" };
    return {
      steps: evidence.state === "submitted" ? [{ event: "submit_timed_out", data }] : [],
      pause: true,
    };
  }
  if (evidence.sinceSubmitMs < silentDropMs) {
    return wait;
  }
  return {
    steps: [{ event: "exchange_rejected", data: { evidence: "no order, position or fill" } }],
    pause: false,
  };
}
