import { describe, expect, it } from "vitest";
import { createServerClock } from "../src/clock";

const serverEpoch = 1_792_603_881_365;

function localClock(start: number) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createServerClock", () => {
  it("estimates the offset from the midpoint of the round trip", () => {
    const local = localClock(serverEpoch + 1450);
    const clock = createServerClock(local.now);
    clock.observe({
      sentAt: serverEpoch + 1450 - 100,
      receivedAt: serverEpoch + 1450 + 100,
      serverTime: serverEpoch,
    });
    expect(clock.nowMs()).toBe(serverEpoch);
    local.advance(2500);
    expect(clock.nowMs()).toBe(serverEpoch + 2500);
  });

  it("signs one second behind the estimated server second", () => {
    const local = localClock(serverEpoch + 1450);
    const clock = createServerClock(local.now);
    clock.observe({ sentAt: local.now(), receivedAt: local.now(), serverTime: serverEpoch });
    expect(clock.restTimestampSeconds()).toBe(Math.floor(serverEpoch / 1000) - 1);
  });

  it("uses the local clock until the first sample arrives", () => {
    const clock = createServerClock(() => 1_792_600_000_999);
    expect(clock.syncedAt()).toBeNull();
    expect(clock.nowMs()).toBe(1_792_600_000_999);
    expect(clock.restTimestampSeconds()).toBe(1_792_599_999);
  });

  it("records when the last accepted sample arrived", () => {
    const clock = createServerClock(() => serverEpoch);
    clock.observe({ sentAt: serverEpoch - 40, receivedAt: serverEpoch, serverTime: serverEpoch });
    expect(clock.syncedAt()).toBe(serverEpoch);
  });

  const scenarios = [
    { localAheadMs: 1450, roundTripMs: 0, stampedAt: 0.5 },
    { localAheadMs: 1450, roundTripMs: 300, stampedAt: 0 },
    { localAheadMs: 1450, roundTripMs: 300, stampedAt: 1 },
    { localAheadMs: 1450, roundTripMs: 1998, stampedAt: 0 },
    { localAheadMs: 1450, roundTripMs: 1998, stampedAt: 1 },
    { localAheadMs: -1450, roundTripMs: 800, stampedAt: 0 },
    { localAheadMs: -1450, roundTripMs: 800, stampedAt: 1 },
    { localAheadMs: 0, roundTripMs: 120, stampedAt: 0.25 },
    { localAheadMs: 7_000, roundTripMs: 1500, stampedAt: 0 },
  ];

  it.each(scenarios)(
    "never signs ahead of the server second (local $localAheadMs ms off, round trip $roundTripMs ms, stamped at $stampedAt)",
    ({ localAheadMs, roundTripMs, stampedAt }) => {
      const sentAtLocal = serverEpoch + localAheadMs;
      const local = localClock(sentAtLocal + roundTripMs);
      const clock = createServerClock(local.now);
      clock.observe({
        sentAt: sentAtLocal,
        receivedAt: sentAtLocal + roundTripMs,
        serverTime: serverEpoch + Math.round(roundTripMs * stampedAt),
      });
      for (let step = 0; step < 2000; step += 37) {
        const serverNow = local.now() - localAheadMs;
        const timestamp = clock.restTimestampSeconds();
        expect(timestamp * 1000).toBeLessThanOrEqual(serverNow);
        expect(serverNow - timestamp * 1000).toBeLessThan(180_000);
        local.advance(37);
      }
    },
  );

  it("ignores a sample whose round trip is too slow to bound the error inside the margin", () => {
    const local = localClock(serverEpoch + 1450);
    const clock = createServerClock(local.now);
    clock.observe({
      sentAt: local.now() - 100,
      receivedAt: local.now(),
      serverTime: serverEpoch,
    });
    clock.observe({
      sentAt: local.now() - 2500,
      receivedAt: local.now(),
      serverTime: serverEpoch + 5000,
    });
    expect(clock.nowMs()).toBe(serverEpoch + 50);
  });

  it("ignores a sample that arrives before it was sent", () => {
    const clock = createServerClock(() => serverEpoch);
    clock.observe({ sentAt: serverEpoch, receivedAt: serverEpoch - 1, serverTime: 0 });
    expect(clock.syncedAt()).toBeNull();
    expect(clock.nowMs()).toBe(serverEpoch);
  });
});
