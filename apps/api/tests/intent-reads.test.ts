import { eq } from "drizzle-orm";
import { executionIntents, outbox } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, type TestApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { curator } from "./support/flows";
import { previewedPlan } from "./support/member-flows";
import { insertOrder, insertReceipt } from "./support/rows";

resetDatabaseBetweenTests();

async function approvedIntent() {
  const context = await previewedPlan();
  const reply = await context.approve();
  return { ...context, intentId: (reply.body as { id: string }).id };
}

describe("reading an intent", () => {
  it("shows the state, the approved proposal, the orders and the events", async () => {
    const { app, cookie, intentId, draft, decision } = await approvedIntent();
    await insertOrder(intentId, "entry");
    const reply = await call(app, "GET", `/api/intents/${intentId}`, { cookie });
    if (decision.outcome === "BLOCKED") throw new Error("The happy path preview was blocked");
    expect(reply).toMatchObject({ status: 200 });
    expect(reply.body).toEqual({
      id: intentId,
      state: "reserved",
      environment: "replay",
      planPublicId: draft.publicId,
      planVersion: 1,
      market: "BTC-USD",
      approved: decision.proposal,
      orders: [
        {
          role: "entry",
          clientOrderId: `cad-${intentId}-e`,
          exchangeOrderId: null,
          lastStatus: null,
          filledSize: "0",
        },
      ],
      events: [{ at: testNow, type: "intent_reserved" }],
    });
  });

  it("treats another member's intent and receipt as missing", async () => {
    const { app, intentId } = await approvedIntent();
    const other = await signIn(app, curator);
    for (const path of [`/api/intents/${intentId}`, `/api/receipts/${intentId}`]) {
      expect(await call(app, "GET", path, { cookie: other })).toMatchObject({
        status: 404,
        body: { code: "NOT_FOUND" },
      });
    }
  });
});

describe("cancelling an unfilled entry", () => {
  it("queues one cancellation however often it is asked", async () => {
    const { app, cookie, intentId } = await approvedIntent();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        await call(app, "POST", `/api/intents/${intentId}/cancel-entry`, { cookie }),
      ).toMatchObject({ status: 202, body: { id: intentId } });
    }
    const queued = await db.select().from(outbox).where(eq(outbox.kind, "cancel_entry"));
    expect(queued).toMatchObject([{ intentId, status: "pending" }]);
  });

  it("refuses once nothing is left to cancel", async () => {
    const { app, cookie, intentId } = await approvedIntent();
    await db.update(executionIntents).set({ state: "open_verified" });
    expect(
      await call(app, "POST", `/api/intents/${intentId}/cancel-entry`, { cookie }),
    ).toMatchObject({ status: 409, body: { code: "NOTHING_TO_CANCEL" } });
  });
});

describe("receipts", () => {
  it("answers not ready until the worker has built the receipt", async () => {
    const { app, cookie, intentId } = await approvedIntent();
    expect(await call(app, "GET", `/api/receipts/${intentId}`, { cookie })).toMatchObject({
      status: 404,
      body: { code: "RECEIPT_NOT_READY" },
    });
    await insertReceipt(intentId, "-3.5", testNow + 60_000);
    expect(await call(app, "GET", `/api/receipts/${intentId}`, { cookie })).toMatchObject({
      status: 200,
      body: { builtAt: testNow + 60_000, receipt: { intentId, realizedPnl: "-3.5" } },
    });
  });
});

async function openStream(app: TestApp, cookie: string) {
  const abort = new AbortController();
  const response = await app.request("/api/events", { headers: { cookie }, signal: abort.signal });
  const body = response.body as ReadableStream<Uint8Array>;
  const reader = body.getReader();
  return {
    contentType: response.headers.get("content-type"),
    next: async () => new TextDecoder().decode((await reader.read()).value),
    close: async () => {
      abort.abort();
      await reader.cancel();
    },
  };
}

describe("the progress stream", () => {
  it("sends the member's own intent events and nobody else's", async () => {
    const { app, cookie, intentId } = await approvedIntent();
    const own = await openStream(app, cookie);
    expect(own.contentType).toContain("text/event-stream");
    const text = await own.next();
    await own.close();
    expect(text).toContain("event: intent");
    expect(text).toContain(`"intentId":"${intentId}"`);
    expect(text).toContain(`"type":"intent_reserved"`);
    const theirs = await openStream(app, await signIn(app, curator));
    const quiet = await Promise.race([
      theirs.next().then(() => "spoke"),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("quiet");
        }, 300);
      }),
    ]);
    await theirs.close();
    expect(quiet).toBe("quiet");
  });

  it("needs a signed-in member", async () => {
    const { app } = await approvedIntent();
    expect((await app.request("/api/events")).status).toBe(401);
  });
});
