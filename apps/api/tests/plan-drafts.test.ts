import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import { resetDatabaseBetweenTests } from "./support/database";
import { curatorWithCommunity, member, planFields, planWithDraft, publish } from "./support/flows";

resetDatabaseBetweenTests();

async function curatorDrafting() {
  const { app, telegram } = testApp();
  const { cookie, communityId } = await curatorWithCommunity(app, telegram);
  return (fields: Record<string, unknown>) =>
    call(app, "POST", "/api/plans", { cookie, body: { communityId, fields } });
}

const draftReply = async (fields: Record<string, unknown>) => (await curatorDrafting())(fields);

describe("plan drafts", () => {
  it("creates a live draft unless the curator asks for replay", async () => {
    const draft = await curatorDrafting();
    expect(await draft(planFields())).toMatchObject({
      status: 201,
      body: { plan: { status: "draft", currentVersion: 0, draft: { environment: "live" } } },
    });
    expect(await draft({ ...planFields(), environment: "replay" })).toMatchObject({
      status: 201,
      body: { plan: { draft: { ...planFields(), environment: "replay" } } },
    });
  });

  it("refuses an environment other than live or replay", async () => {
    expect(await draftReply({ ...planFields(), environment: "testnet" })).toMatchObject({
      status: 422,
      body: { code: "PLAN_INVALID" },
    });
  });

  it.each([
    ["an unknown market", { market: "PEPE-USD" }, "UNKNOWN_MARKET"],
    ["a market that is not trading", { market: "DOGE-USD" }, "MARKET_NOT_TRADING"],
    [
      "an entry window that already closed",
      { entryExpiresAt: "2026-10-22T11:59:59Z" },
      "ENTRY_WINDOW_CLOSED",
    ],
    ["a stop above a long entry", { stopPrice: "84100" }, "PLAN_INVALID"],
  ])("refuses %s", async (_, overrides, code) => {
    expect(await draftReply(planFields(overrides))).toMatchObject({ status: 422, body: { code } });
  });

  it.each([
    ["entryMax", { entryMax: "84400.5" }],
    ["entryMin", { entryMin: "83999.25" }],
    ["stopPrice", { stopPrice: "5" }],
    ["targetPrice", { targetPrice: "100001" }],
  ])("names %s when Strike cannot accept that price", async (field, overrides) => {
    const reply = await draftReply(planFields(overrides));
    expect(reply).toMatchObject({ status: 422, body: { code: "PRICE_NOT_ORDERABLE" } });
    expect((reply.body as { message: string }).message).toMatch(new RegExp(`^${field}: `));
    expect((reply.body as { message: string }).message).toContain(
      "BTC-USD prices go in steps of 1 from 10 to 100000.",
    );
  });

  it("lets only the community's publishers create and publish", async () => {
    const { app, communityId, draft } = await planWithDraft();
    const outsider = await signIn(app, member);
    const created = await call(app, "POST", "/api/plans", {
      cookie: outsider,
      body: { communityId, fields: planFields() },
    });
    expect(created).toMatchObject({ status: 403, body: { code: "NOT_A_PUBLISHER" } });
    expect(await publish(app, outsider, draft.id)).toMatchObject({
      status: 403,
      body: { code: "NOT_A_PUBLISHER" },
    });
  });
});
