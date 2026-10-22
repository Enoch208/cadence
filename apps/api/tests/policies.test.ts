import { riskPolicies } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { member } from "./support/flows";
import { throwawayKeyPair } from "./support/keys";

resetDatabaseBetweenTests();

const budgets = {
  perTradeBudget: "15",
  aggregateBudget: "45",
  sessionBudget: "30",
  leverageCap: 3,
  minRewardRisk: "2",
};

describe("risk policies", () => {
  it("saves a new version each time, with the house assumptions filled in", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    expect(await call(app, "PUT", "/api/policies", { cookie, body: budgets })).toEqual({
      status: 200,
      body: { version: 1 },
      headers: expect.any(Headers) as Headers,
    });
    const second = await call(app, "PUT", "/api/policies", {
      cookie,
      body: { ...budgets, perTradeBudget: "10" },
    });
    expect(second.body).toEqual({ version: 2 });
    const rows = await db.select().from(riskPolicies).orderBy(riskPolicies.version);
    expect(rows.map((row) => row.policy)).toEqual([
      {
        version: 1,
        ...budgets,
        maxEntrySlippageBps: 20,
        stopSlippageReserveBps: 50,
        fundingHorizonHours: 24,
        liquidationBufferBps: 100,
        allowedMarkets: ["BTC-USD", "ETH-USD"],
      },
      expect.objectContaining({ version: 2, perTradeBudget: "10" }),
    ]);
  });

  it.each([
    ["a leverage cap above 20", { leverageCap: 50 }],
    ["a budget that is not positive", { perTradeBudget: "0" }],
    ["a missing budget", { sessionBudget: undefined }],
  ])("refuses %s", async (_, overrides) => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    const reply = await call(app, "PUT", "/api/policies", {
      cookie,
      body: { ...budgets, ...overrides },
    });
    expect(reply).toMatchObject({ status: 422, body: { code: "POLICY_INVALID" } });
    expect(await db.select().from(riskPolicies)).toHaveLength(0);
  });

  it("refuses fields the member cannot set", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, member);
    const reply = await call(app, "PUT", "/api/policies", {
      cookie,
      body: { ...budgets, allowedMarkets: ["DOGE-USD"] },
    });
    expect(reply.status).toBe(400);
  });

  it("configures a newly connected account at the saved leverage cap", async () => {
    const { app, live } = testApp();
    const cookie = await signIn(app, member);
    await call(app, "PUT", "/api/policies", { cookie, body: budgets });
    const keys = throwawayKeyPair();
    await call(app, "POST", "/api/accounts", {
      cookie,
      body: { publicKey: keys.publicKeyHex, privateKey: keys.seedHex },
    });
    expect(live.configured.map(({ settings }) => settings.leverage)).toEqual([3, 3]);
  });

  it("needs a signed-in member", async () => {
    const { app } = testApp();
    expect((await call(app, "PUT", "/api/policies", { body: budgets })).status).toBe(401);
  });
});
