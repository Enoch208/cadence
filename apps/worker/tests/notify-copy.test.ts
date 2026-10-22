import { intentStates, type IntentState } from "@cadence/core";
import { describe, expect, it } from "vitest";
import { orderMessage, type MessageFacts } from "../src/notify-message";
import { worthAnnouncing } from "../src/notify-queue";
import { intentStateDetail, intentStateLabel } from "../src/notify-words";

const facts = (state: IntentState, overrides: Partial<MessageFacts> = {}): MessageFacts => ({
  chatId: 5001,
  intentId: "4f0c8a52-8f1e-4a55-9d0e-3d4a3c2b1a00",
  state,
  market: "BTC-USD",
  direction: "long",
  environment: "replay",
  receiptReady: false,
  ...overrides,
});

const everyWord = (environment: "live" | "replay") =>
  intentStates.flatMap((state) => [
    intentStateLabel(state, environment),
    intentStateDetail(state, environment),
  ]);

describe("order message words", () => {
  it("never credits Strike with what the replay exchange did", () => {
    for (const words of everyWord("replay")) {
      expect(words).not.toMatch(/strike/i);
    }
    for (const state of intentStates) {
      expect(orderMessage(facts(state), "https://cadence.test").text).not.toMatch(/strike/i);
    }
    expect(intentStateLabel("submitted", "replay")).toBe("Sent to the replay exchange");
    expect(intentStateLabel("rejected", "replay")).toBe("Rejected by the replay exchange");
    expect(intentStateDetail("closed", "replay")).toBe(
      "The position is closed and reconciled with the replay exchange.",
    );
  });

  it("names Strike wherever a live message names the venue", () => {
    expect(intentStateLabel("submitted", "live")).toBe("Sent to Strike");
    expect(intentStateLabel("rejected", "live")).toBe("Rejected by Strike");
    expect(intentStateDetail("submitted", "live")).toBe(
      "Strike acknowledged the order. Waiting for the fill.",
    );
    expect(intentStateDetail("open_verified", "live")).toBe(
      "Your stop and target are confirmed on Strike for the filled size.",
    );
  });

  it("never claims protection, guarantees or a fill before one is observed", () => {
    for (const words of [...everyWord("live"), ...everyWord("replay")]) {
      expect(words).not.toMatch(/protect|guarantee|risk-free|trustless/i);
    }
    const sayFilled = intentStates.filter((state) =>
      intentStateLabel(state, "live").startsWith("Filled"),
    );
    expect(sayFilled).toEqual(["open_verifying"]);
  });

  it("says the state, the market, Live or Replay, and links to the order", () => {
    expect(
      orderMessage(facts("open_verified", { environment: "live" }), "https://cadence.test"),
    ).toEqual({
      chatId: 5001,
      text: [
        "Exits verified",
        "BTC-USD long · Live",
        "Your stop and target are confirmed on Strike for the filled size.",
      ].join("\n"),
      button: {
        label: "Open order",
        url: "https://cadence.test/intents/4f0c8a52-8f1e-4a55-9d0e-3d4a3c2b1a00",
      },
    });
  });

  it("links to the receipt once the order has one", () => {
    const message = orderMessage(
      facts("closed", { direction: "short", receiptReady: true }),
      "https://cadence.test",
    );
    expect(message.text.split("\n")).toEqual([
      "Closed",
      "BTC-USD short · Replay",
      "The position is closed and reconciled with the replay exchange.",
    ]);
    expect(message.button).toEqual({
      label: "Open receipt",
      url: "https://cadence.test/receipts/4f0c8a52-8f1e-4a55-9d0e-3d4a3c2b1a00",
    });
  });
});

describe("which state changes are announced", () => {
  it("announces Strike's acknowledgement, the fill, the exits and every outcome", () => {
    expect(worthAnnouncing("acknowledged", "submitted")).toBe(true);
    expect(worthAnnouncing("fill_observed", "open_verifying")).toBe(true);
    expect(worthAnnouncing("exits_verified", "open_verified")).toBe(true);
    expect(worthAnnouncing("exits_missing", "recovery_required")).toBe(true);
    expect(worthAnnouncing("close_reconciled", "closed")).toBe(true);
    expect(worthAnnouncing("entry_unfilled", "unfilled")).toBe(true);
    expect(worthAnnouncing("exchange_rejected", "rejected")).toBe(true);
    expect(worthAnnouncing("entry_canceled", "canceled")).toBe(true);
    expect(worthAnnouncing("entry_window_closed", "expired")).toBe(true);
  });

  it("stays quiet before Strike answers and while an answer is missing", () => {
    expect(worthAnnouncing("submit_attempted", "submitted")).toBe(false);
    expect(worthAnnouncing("submit_timed_out", "unknown")).toBe(false);
    expect(worthAnnouncing("approved", "reserved")).toBe(false);
    expect(worthAnnouncing("validation_failed", "blocked")).toBe(false);
  });
});
