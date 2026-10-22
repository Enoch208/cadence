import { StrikeReadError, StrikeRejectedError, type ReplayStrikeClient } from "@cadence/strike";
import { describe, expect, it } from "vitest";
import { runPass } from "../src/pass";
import { submitIntent } from "../src/submit";
import { resetDatabaseBetweenTests } from "./support/database";
import { approved } from "./support/flows";
import { connectionStatus, intentState, lastEventData } from "./support/read";
import { rejectingStrategies } from "./support/strike";

resetDatabaseBetweenTests();

const refusingKey = (client: ReplayStrikeClient): ReplayStrikeClient => ({
  ...client,
  placeStrategy: () =>
    Promise.reject(
      new StrikeRejectedError({
        operation: "placeStrategy",
        status: 401,
        code: null,
        message: "wallet expired or revoked",
      }),
    ),
});

describe("a key Strike refuses", () => {
  it("rejects the order and disconnects the account so nothing else is attempted", async () => {
    const { intent, member, deps } = await approved({ client: refusingKey });

    await expect(submitIntent(deps, intent.id)).resolves.toBe("rejected");

    expect(await intentState(intent.id)).toBe("rejected");
    expect(await connectionStatus(member.connection.id)).toBe("disconnected");
    expect(await lastEventData(intent.id, "connection_disconnected")).toMatchObject({
      connectionId: member.connection.id,
    });
  });

  it("disconnects the account when reads are refused, without inventing an outcome", async () => {
    const { intent, member, deps, replay } = await approved();
    await expect(submitIntent(deps, intent.id)).resolves.toBe("acknowledged");
    const refusedReads = {
      ...deps,
      strikeFor: () => ({
        ...replay,
        accountState: () =>
          Promise.reject(
            new StrikeReadError({ operation: "account", status: 403, detail: "access denied" }),
          ),
      }),
    };

    await runPass(refusedReads);

    expect(await connectionStatus(member.connection.id)).toBe("disconnected");
    expect(await intentState(intent.id)).toBe("submitted");
  });

  it("leaves the account connected when Strike refuses only the order", async () => {
    const { intent, member, deps } = await approved({ client: rejectingStrategies });

    await submitIntent(deps, intent.id);

    expect(await connectionStatus(member.connection.id)).toBe("active");
  });
});
