import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events } from "@cadence/db";
import { call, testApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { testNow } from "./support/fixtures";
import { previewedPlan } from "./support/member-flows";

resetDatabaseBetweenTests();

type Seed = {
  type: string;
  environment: "live" | "replay";
  correlationId?: string;
  data?: Record<string, string>;
};

async function seed(rows: readonly Seed[]) {
  await db.insert(events).values(
    rows.map((row) => ({
      at: testNow,
      actor: "test",
      correlationId: row.correlationId ?? randomUUID(),
      environment: row.environment,
      type: row.type,
      data: row.data ?? {},
    })),
  );
}

describe("GET /api/stats", () => {
  it("counts only live activity, each plan and order once", async () => {
    const plan = randomUUID();
    const intent = randomUUID();
    const twice = randomUUID();
    await seed([
      { type: "plan_published", environment: "live", correlationId: plan },
      { type: "plan_published", environment: "live", correlationId: plan },
      { type: "plan_published", environment: "replay" },
      { type: "submit_attempted", environment: "live", correlationId: intent },
      { type: "submit_attempted", environment: "live", correlationId: twice },
      { type: "submit_attempted", environment: "live", correlationId: twice },
      { type: "submit_attempted", environment: "replay" },
      { type: "exits_verified", environment: "live", correlationId: intent },
      { type: "exits_verified", environment: "replay" },
      {
        type: "preview_decided",
        environment: "live",
        data: { outcome: "BLOCKED", reasons: "OUTSIDE_ENTRY_RANGE" },
      },
      {
        type: "preview_decided",
        environment: "live",
        data: { outcome: "BLOCKED", reasons: "STALE_DATA" },
      },
      {
        type: "preview_decided",
        environment: "replay",
        data: { outcome: "BLOCKED", reasons: "OUTSIDE_ENTRY_RANGE" },
      },
    ]);
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/stats");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      measuredAt: testNow,
      plansPublished: 1,
      ordersPlaced: 2,
      exitsVerified: 1,
      lateEntriesDeclined: 1,
      duplicateOrders: 1,
    });
    expect(reply.headers.get("cache-control")).toBe("public, max-age=30");
  });

  it("reports zero everywhere before anything has happened on live", async () => {
    const { app } = testApp();
    const reply = await call(app, "GET", "/api/stats");
    expect(reply.body).toMatchObject({ plansPublished: 0, ordersPlaced: 0, duplicateOrders: 0 });
  });
});

describe("preview audit", () => {
  it("records every decision in the event log under its environment", async () => {
    const { previewId } = await previewedPlan("late_entry");
    const [event] = await db.select().from(events).where(eq(events.correlationId, previewId));
    expect(event).toMatchObject({
      type: "preview_decided",
      environment: "replay",
      data: { outcome: "BLOCKED", reasons: "OUTSIDE_ENTRY_RANGE" },
    });
  });
});
