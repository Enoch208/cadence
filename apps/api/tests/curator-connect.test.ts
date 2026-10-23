import { accountConnections, builderChallenges } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import {
  fakeBuilderStrike,
  memberSignature,
  solanaWallet,
  testBuilderCode,
} from "./support/builder-strike";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { member, planFields, planWithDraft, publish } from "./support/flows";

resetDatabaseBetweenTests();

const curatorFee = { builderCode: "range_traders", feeBps: 5 };

async function publishedPlan(fields: Record<string, unknown>) {
  const { app, cookie, draft } = await planWithDraft(fields);
  await publish(app, cookie, draft.id);
  return draft.publicId;
}

async function memberConnecting() {
  const strike = fakeBuilderStrike();
  const { app } = testApp({ builderConnect: strike.client });
  const cookie = await signIn(app, member);
  const start = (body: Record<string, unknown>) =>
    call(app, "POST", "/api/accounts/builder/start", { cookie, body });
  const finish = (challengeId: string) =>
    call(app, "POST", "/api/accounts/builder/finish", {
      cookie,
      body: { challengeId, signature: memberSignature },
    });
  return { app, cookie, strike: strike.state, start, finish };
}

describe("connecting a wallet under a plan's curator code", () => {
  it("asks the member to approve the curator's code at the plan's fee and records both", async () => {
    const planPublicId = await publishedPlan({
      ...planFields({ environment: "replay" }),
      curatorFee,
    });
    const { app, cookie, strike, start, finish } = await memberConnecting();
    const started = await start({ ...solanaWallet, planPublicId });
    expect(started).toMatchObject({
      status: 201,
      body: { builderCode: "range_traders", feeBps: 5 },
    });
    expect(strike.asked[0]).toMatchObject({ code: "range_traders", fee_share_bps: 5 });
    const [pending] = await db.select().from(builderChallenges);
    expect(pending).toMatchObject({ builderCode: "range_traders", builderFeeBps: 5 });

    const { challengeId } = started.body as { challengeId: string };
    expect(await finish(challengeId)).toMatchObject({
      status: 201,
      body: { credentialSource: "builder", builderCode: "range_traders", builderFeeBps: 5 },
    });
    const [row] = await db.select().from(accountConnections);
    expect(row).toMatchObject({ builderCode: "range_traders", builderFeeBps: 5 });
    expect((await call(app, "GET", "/api/accounts", { cookie })).body).toMatchObject({
      accounts: [{ builderCode: "range_traders", builderFeeBps: 5 }],
    });
  });

  it("uses Cadence's own code at no fee when no plan is named", async () => {
    const { strike, start, finish } = await memberConnecting();
    const started = await start(solanaWallet);
    expect(started.body).toMatchObject({ builderCode: testBuilderCode, feeBps: 0 });
    expect(strike.asked[0]).toMatchObject({ code: testBuilderCode, fee_share_bps: 0 });
    await finish((started.body as { challengeId: string }).challengeId);
    const [row] = await db.select().from(accountConnections);
    expect(row).toMatchObject({ builderCode: testBuilderCode, builderFeeBps: 0 });
  });

  it("refuses a plan without a curator fee before asking Strike", async () => {
    const planPublicId = await publishedPlan(planFields());
    const { strike, start } = await memberConnecting();
    expect(await start({ ...solanaWallet, planPublicId })).toMatchObject({
      status: 422,
      body: { code: "PLAN_HAS_NO_CURATOR_FEE" },
    });
    expect(strike.asked).toEqual([]);
  });

  it("connects a replay account as if approved under the plan's curator code", async () => {
    const planPublicId = await publishedPlan({
      ...planFields(),
      environment: "replay",
      curatorFee,
    });
    const { app, cookie } = await memberConnecting();
    const reply = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "happy_path", planPublicId },
    });
    expect(reply).toMatchObject({
      status: 201,
      body: {
        environment: "replay",
        credentialSource: null,
        builderCode: "range_traders",
        builderFeeBps: 5,
      },
    });
    const plain = await call(app, "POST", "/api/accounts/replay", {
      cookie,
      body: { scenario: "happy_path" },
    });
    expect(plain.body).toMatchObject({ builderCode: null, builderFeeBps: null });
  });
});
