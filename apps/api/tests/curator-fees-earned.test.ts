import { eq } from "drizzle-orm";
import type { OrderRole, OrderSide } from "@cadence/core";
import { executionIntents, fills, planVersions } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { readyProposal, testNow } from "./support/fixtures";
import { planFields, planWithDraft, publish } from "./support/flows";
import { insertIntent, insertMember, insertOrder } from "./support/rows";

resetDatabaseBetweenTests();

const curatorFee = { builderCode: "range_traders", feeBps: 5 };

async function fill(intentId: string, role: OrderRole, side: OrderSide, price: string) {
  const order = await insertOrder(intentId, role);
  await db.insert(fills).values({
    exchangeFillId: `fill-${intentId}-${role}`,
    clientOrderId: order.clientOrderId,
    intentId,
    role,
    side,
    price,
    size: "0.01",
    fee: "0.42",
    filledAt: testNow,
  });
}

describe("the curator fees a plan has earned", () => {
  it("adds up the computed fee on the fills of members who paid it", async () => {
    const { app, cookie, draft } = await planWithDraft({
      ...planFields({ environment: "replay" }),
      curatorFee,
    });
    await publish(app, cookie, draft.id);
    const [version] = await db
      .select({ id: planVersions.id })
      .from(planVersions)
      .where(eq(planVersions.planId, draft.id));
    const [paying, other] = await Promise.all([insertMember(8001), insertMember(8002)]);
    const paid = await insertIntent(paying, version?.id ?? "", "closed");
    await db
      .update(executionIntents)
      .set({ approved: { ...readyProposal, curatorFee } })
      .where(eq(executionIntents.id, paid.id));
    await fill(paid.id, "entry", "buy", "84100");
    await fill(paid.id, "target", "sell", "86800");
    await fill(paid.id, "recovery_close", "sell", "86800");
    const unpaid = await insertIntent(other, version?.id ?? "", "closed");
    await fill(unpaid.id, "entry", "buy", "84100");

    const reply = await call(app, "GET", "/api/plans", { cookie });
    expect((reply.body as { plans: unknown[] }).plans).toEqual([
      expect.objectContaining({
        id: draft.id,
        curatorFee,
        curatorFeesEarned: { computed: "0.85", fills: 2 },
      }),
    ]);
  });

  it("reports nothing earned for a plan without a curator fee", async () => {
    const { app, cookie, draft } = await planWithDraft();
    await publish(app, cookie, draft.id);
    const reply = await call(app, "GET", "/api/plans", { cookie });
    expect((reply.body as { plans: unknown[] }).plans).toEqual([
      expect.objectContaining({
        curatorFee: null,
        curatorFeesEarned: { computed: "0.00", fills: 0 },
      }),
    ]);
  });
});
