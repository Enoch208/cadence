import { eq } from "drizzle-orm";
import { canonicalJson, sha256Hex, type Decision, type Proposal } from "@cadence/core";
import { executionIntents, planVersions, riskPolicies } from "@cadence/db";
import { describe, expect, it } from "vitest";
import { call, signIn, type TestApp } from "./support/app";
import { db, resetDatabaseBetweenTests } from "./support/database";
import { member, planFields, planWithDraft, publish } from "./support/flows";

resetDatabaseBetweenTests();

const curatorFee = { builderCode: "range_traders", feeBps: 5 };

type PreviewReply = { previewId: string; decision: Decision };

async function feePlanAndMember() {
  const { app, cookie, draft } = await planWithDraft({
    ...planFields({ targetPrice: "88000" }),
    environment: "replay",
    curatorFee,
  });
  await publish(app, cookie, draft.id);
  const memberCookie = await signIn(app, member);
  const connect = async (body: Record<string, unknown>) =>
    (
      (await call(app, "POST", "/api/accounts/replay", { cookie: memberCookie, body })).body as {
        id: string;
      }
    ).id;
  const preview = async (accountId: string) =>
    (
      await call(app, "POST", "/api/previews", {
        cookie: memberCookie,
        body: { planPublicId: draft.publicId, accountId },
      })
    ).body as PreviewReply;
  return { app, memberCookie, planPublicId: draft.publicId, connect, preview };
}

const proposalOf = ({ decision }: PreviewReply): Proposal => {
  if (decision.outcome === "BLOCKED") {
    throw new Error(`Expected a proposal, got ${decision.reasons.join(", ")}`);
  }
  return decision.proposal;
};

async function approve(app: TestApp, cookie: string, previewId: string) {
  const reply = await call(app, "POST", "/api/intents", { cookie, body: { previewId } });
  return (reply.body as { id: string }).id;
}

describe("a preview of a plan with a curator fee", () => {
  it("charges the fee only on an account connected under the curator's code", async () => {
    const { connect, preview, planPublicId } = await feePlanAndMember();
    const underCode = await connect({ scenario: "happy_path", planPublicId });
    const plain = await connect({ scenario: "happy_path" });

    const charged = proposalOf(await preview(underCode));
    const free = proposalOf(await preview(plain));

    expect(charged.curatorFee).toEqual(curatorFee);
    expect(Number(charged.costs.curatorFee)).toBeGreaterThan(0);
    expect(free.curatorFee).toBeNull();
    expect(free.costs.curatorFee).toBe("0.00");
    expect(Number(charged.quantity)).toBeLessThanOrEqual(Number(free.quantity));
  });

  it("binds the fee into the approval the worker will check", async () => {
    const { app, memberCookie, connect, preview, planPublicId } = await feePlanAndMember();
    const accountId = await connect({ scenario: "happy_path", planPublicId });
    const previewed = await preview(accountId);
    const intentId = await approve(app, memberCookie, previewed.previewId);
    const [intent] = await db
      .select()
      .from(executionIntents)
      .where(eq(executionIntents.id, intentId));
    if (intent === undefined) {
      throw new Error("The approval stored no intent");
    }
    expect(intent.approved.curatorFee).toEqual(curatorFee);
    expect(intent.approved).toEqual(proposalOf(previewed));
    const [version] = await db
      .select()
      .from(planVersions)
      .where(eq(planVersions.id, intent.planVersionId));
    const [policy] = await db
      .select()
      .from(riskPolicies)
      .where(eq(riskPolicies.id, intent.policyId));
    const consent = (proposal: Proposal) =>
      sha256Hex(
        canonicalJson({
          previewId: previewed.previewId,
          accountConnectionId: accountId,
          planVersionId: intent.planVersionId,
          planDigest: version?.digest,
          policyId: intent.policyId,
          policyVersion: policy?.version,
          quantityCeiling: null,
          proposal,
        }),
      );
    expect(intent.approvedDigest).toBe(consent(intent.approved));
    expect(intent.approvedDigest).not.toBe(consent({ ...intent.approved, curatorFee: null }));
  });
});
