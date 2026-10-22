import type { Decision, PublishedPlan } from "@cadence/core";
import {
  createReplayStrikeClient,
  replayScenarios,
  type ReplayScenario,
  type ReplayStrikeClient,
} from "@cadence/strike";
import { replayPlan, testClock } from "./fixtures";
import { approve, insertMember, insertPlan, type ConnectionSpec } from "./rows";
import { asLive, previewOn, replayOf, workerDeps } from "./strike";

export type Setup = {
  spec?: ConnectionSpec;
  plan?: PublishedPlan;
  exchange?: ReplayScenario;
  client?: (replay: ReplayStrikeClient) => ReplayStrikeClient;
  approved?: (decision: Decision) => Decision;
  liveMaxNotional?: string;
};

export async function approved(setup: Setup = {}) {
  const clock = testClock();
  const spec = setup.spec ?? { environment: "replay", scenario: "happy_path" };
  const plan = setup.plan ?? replayPlan;
  const { planRow, version } = await insertPlan(plan);
  const member = await insertMember(spec);
  const replay =
    spec.environment === "live"
      ? asLive(createReplayStrikeClient(setup.exchange ?? replayScenarios.happy_path, clock.now))
      : setup.exchange === undefined
        ? replayOf(member.connection, clock)
        : createReplayStrikeClient(setup.exchange, clock.now);
  const client = setup.client?.(replay) ?? replay;
  const decision = await previewOn(client, plan, clock.now());
  const intent = await approve(member, version.id, setup.approved?.(decision) ?? decision);
  const deps = workerDeps(clock, () => client, setup.liveMaxNotional);
  return { clock, planRow, member, replay, client, intent, deps };
}
