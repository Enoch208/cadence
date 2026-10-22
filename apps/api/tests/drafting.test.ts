import { describe, expect, it } from "vitest";
import {
  DraftingDeclinedError,
  DraftingUnavailableError,
  type PlanDrafter,
  type ReadSetup,
  type Setup,
  type SetupRequest,
} from "../src/drafting/contract";
import { call, signIn, testApp } from "./support/app";
import { resetDatabaseBetweenTests } from "./support/database";
import { curator, member } from "./support/flows";

resetDatabaseBetweenTests();

const text = "BTC long. Entry 84,000 - 84,500, SL 83,200. Valid 4h.";

const setup: Setup = {
  isTradeSetup: true,
  market: { value: "BTC-USD", quote: "BTC long" },
  direction: { value: "long", quote: "BTC long" },
  entryMin: { value: "84000", quote: "Entry 84,000 - 84,500" },
  entryMax: { value: "84500", quote: "Entry 84,000 - 84,500" },
  stopPrice: { value: "83200", quote: "SL 83,200" },
  targetPrice: { value: "86000", quote: "TP 86,000" },
  entryWindowMinutes: { value: "240", quote: "Valid 4h" },
  rationale: null,
};

function drafterAnswering(answer: ReadSetup | Error) {
  const requests: SetupRequest[] = [];
  const drafter: PlanDrafter = {
    read: (request) => {
      requests.push(request);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { drafter, requests };
}

async function signedInWith(answer: ReadSetup | Error) {
  const { drafter, requests } = drafterAnswering(answer);
  const { app, telegram } = testApp({ drafter });
  const cookie = await signIn(app, curator);
  const draft = (body: unknown = { text }) =>
    call(app, "POST", "/api/drafting/plan", { cookie, body });
  return { app, telegram, cookie, draft, requests };
}

describe("drafting a plan from a curator's message", () => {
  it("is off, and says so, when the server has no drafter", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, curator);
    expect(await call(app, "GET", "/api/drafting", { cookie })).toMatchObject({
      status: 200,
      body: { available: false },
    });
    expect(await call(app, "POST", "/api/drafting/plan", { cookie, body: { text } })).toMatchObject(
      { status: 503, body: { code: "DRAFTING_OFF" } },
    );
  });

  it("needs a signed-in member", async () => {
    const { drafter, requests } = drafterAnswering({ setup, model: "gpt-6.1-sol" });
    const { app } = testApp({ drafter });
    expect(await call(app, "GET", "/api/drafting")).toMatchObject({ status: 401 });
    expect(await call(app, "POST", "/api/drafting/plan", { body: { text } })).toMatchObject({
      status: 401,
    });
    expect(requests).toEqual([]);
  });

  it("fills what the message verifiably states and lists the rest as missing", async () => {
    const { app, cookie, draft, requests } = await signedInWith({
      setup,
      model: "gpt-6.1-sol",
    });
    expect(await call(app, "GET", "/api/drafting", { cookie })).toMatchObject({
      body: { available: true },
    });
    expect(await draft()).toEqual({
      status: 200,
      headers: expect.any(Headers) as unknown,
      body: {
        model: "gpt-6.1-sol",
        draft: {
          filled: {
            market: { value: "BTC-USD", quote: "BTC long" },
            direction: { value: "long", quote: "BTC long" },
            entryMin: { value: "84000", quote: "Entry 84,000 - 84,500" },
            entryMax: { value: "84500", quote: "Entry 84,000 - 84,500" },
            stopPrice: { value: "83200", quote: "SL 83,200" },
            entryExpiresAt: { value: "2026-10-22T16:00:00Z", quote: "Valid 4h" },
          },
          missing: ["targetPrice", "rationale"],
        },
      },
    });
    expect(requests).toEqual([
      { text, markets: ["BTC-USD", "ETH-USD"], now: "2026-10-22T12:00:00Z" },
    ]);
  });

  it("stores and publishes nothing", async () => {
    const { app, telegram, cookie, draft } = await signedInWith({
      setup,
      model: "gpt-6.1-sol",
    });
    expect((await draft()).status).toBe(200);
    expect(await call(app, "GET", "/api/plans", { cookie })).toMatchObject({
      body: { plans: [] },
    });
    expect(telegram.cards).toEqual([]);
  });

  it.each([
    ["an empty message", { text: "   " }],
    ["a message over 4,000 characters", { text: "a".repeat(4001) }],
    ["no message", {}],
  ])("refuses %s without asking the model", async (_, body) => {
    const { draft, requests } = await signedInWith({ setup, model: "gpt-6.1-sol" });
    expect(await draft(body)).toMatchObject({ status: 400, body: { code: "INVALID_REQUEST" } });
    expect(requests).toEqual([]);
  });

  it.each([
    [
      "a message that is not a setup",
      { setup: { ...setup, isTradeSetup: false }, model: "gpt-6.1-sol" },
      422,
      "NOT_A_SETUP",
    ],
    ["a declined read", new DraftingDeclinedError("declined"), 422, "DRAFT_DECLINED"],
    ["an unavailable drafter", new DraftingUnavailableError("down"), 503, "DRAFTING_UNAVAILABLE"],
  ])("answers %s with %i %s", async (_, answer, status, code) => {
    const { draft } = await signedInWith(answer);
    expect(await draft()).toMatchObject({ status, body: { code } });
  });

  it("limits how often one member drafts, without slowing anyone else", async () => {
    const { app, draft } = await signedInWith({ setup, model: "gpt-6.1-sol" });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await draft()).status).toBe(200);
    }
    expect(await draft()).toMatchObject({ status: 429, body: { code: "DRAFTING_BUSY" } });
    const other = await signIn(app, member);
    expect(
      (await call(app, "POST", "/api/drafting/plan", { cookie: other, body: { text } })).status,
    ).toBe(200);
  });
});
