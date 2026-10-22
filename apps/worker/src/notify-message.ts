import type { Direction, Environment, IntentState } from "@cadence/core";
import { environmentLabel, intentStateDetail, intentStateLabel } from "./notify-words";

export type OutgoingMessage = {
  chatId: number;
  text: string;
  button: { label: string; url: string };
};

export type MessageFacts = {
  chatId: number;
  intentId: string;
  state: IntentState;
  market: string;
  direction: Direction;
  environment: Environment;
  receiptReady: boolean;
};

export function orderMessage(facts: MessageFacts, webOrigin: string): OutgoingMessage {
  const { state, environment } = facts;
  const id = encodeURIComponent(facts.intentId);
  return {
    chatId: facts.chatId,
    text: [
      intentStateLabel(state, environment),
      `${facts.market} ${facts.direction} · ${environmentLabel[environment]}`,
      intentStateDetail(state, environment),
    ].join("\n"),
    button: facts.receiptReady
      ? { label: "Open receipt", url: `${webOrigin}/receipts/${id}` }
      : { label: "Open order", url: `${webOrigin}/intents/${id}` },
  };
}
