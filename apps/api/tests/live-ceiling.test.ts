import { Decimal } from "decimal.js";
import type { Decision } from "@cadence/core";
import { describe, expect, it } from "vitest";
import { liveQuantityCeiling } from "../src/previews/live-ceiling";
import { call, signIn } from "./support/app";
import { resetDatabaseBetweenTests } from "./support/database";
import { member, planFields, planWithDraft, publish } from "./support/flows";
import { throwawayKeyPair } from "./support/keys";

resetDatabaseBetweenTests();

const rule = { entryMax: "84400", liveMaxNotional: "25", step: "0.00001" };

describe("the live notional ceiling as a quantity ceiling", () => {
  it("leaves replay and its requested ceiling alone", () => {
    expect(liveQuantityCeiling({ ...rule, environment: "replay", requested: null })).toBeNull();
    expect(liveQuantityCeiling({ ...rule, environment: "replay", requested: "1" })).toBe("1");
  });

  it("caps a live order at the ceiling divided by the plan's highest entry, rounded down", () => {
    expect(liveQuantityCeiling({ ...rule, environment: "live", requested: null })).toBe("0.00029");
    expect(new Decimal("0.00029").times(rule.entryMax).lessThanOrEqualTo(25)).toBe(true);
    expect(new Decimal("0.0003").times(rule.entryMax).greaterThan(25)).toBe(true);
  });

  it("keeps a smaller ceiling the member asked for", () => {
    expect(liveQuantityCeiling({ ...rule, environment: "live", requested: "0.0001" })).toBe(
      "0.0001",
    );
    expect(liveQuantityCeiling({ ...rule, environment: "live", requested: "1" })).toBe("0.00029");
  });
});

describe("previewing a live plan", () => {
  it("never proposes an order the worker's live ceiling would refuse", async () => {
    const context = await planWithDraft({ ...planFields(), environment: "live" });
    await publish(context.app, context.cookie, context.draft.id);
    const cookie = await signIn(context.app, member);
    const keys = throwawayKeyPair();
    const connected = await call(context.app, "POST", "/api/accounts", {
      cookie,
      body: { publicKey: keys.publicKeyHex, privateKey: keys.seedHex },
    });
    const { id: accountId } = connected.body as { id: string };
    const reply = await call(context.app, "POST", "/api/previews", {
      cookie,
      body: { planPublicId: context.draft.publicId, accountId },
    });
    const { decision } = reply.body as { decision: Decision };
    if (decision.outcome === "BLOCKED") {
      throw new Error(`The live preview was blocked: ${decision.reasons.join(", ")}`);
    }
    const { quantity, limitPrice, limitedBy } = decision.proposal;
    expect(limitedBy).toBe("ceiling");
    expect(new Decimal(quantity).times(limitPrice).lessThanOrEqualTo(25)).toBe(true);
    expect(new Decimal(quantity).times(limitPrice).greaterThanOrEqualTo(10)).toBe(true);
  });
});
