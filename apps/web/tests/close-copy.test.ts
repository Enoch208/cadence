import { describe, expect, it } from "vitest";
import { closeProgress } from "../src/lib/copy/close";
import { venueName } from "../src/lib/copy/states";

const history = (...types: string[]) => types.map((type, at) => ({ at, type }));

describe("close progress wording", () => {
  it("says nothing until the member asks to close", () => {
    expect(closeProgress(history("intent_reserved", "exits_verified"), "Strike")).toBeNull();
  });

  it("follows the latest close event and names the venue", () => {
    expect(closeProgress(history("close_requested", "close_attempted"), "Strike")).toBe(
      "Closing at the market price on Strike.",
    );
    expect(closeProgress(history("close_requested", "close_rejected"), "Strike")).toBe(
      "Strike refused the close. Your stop and target stay in place.",
    );
  });

  it("never names Strike for a replay close", () => {
    const types = ["close_requested", "close_acknowledged", "close_rejected", "close_unknown"];
    for (const type of types) {
      expect(closeProgress(history(type), venueName.replay)).not.toMatch(/Strike/);
    }
  });
});
