export type ClockSample = {
  sentAt: number;
  receivedAt: number;
  serverTime: number;
};

export type ServerClock = {
  observe(sample: ClockSample): void;
  restTimestampSeconds(): number;
  nowMs(): number;
  syncedAt(): number | null;
};

export const maxSampleRoundTripMs = 2_000;

const isUsable = (sample: ClockSample) =>
  Number.isFinite(sample.sentAt) &&
  Number.isFinite(sample.receivedAt) &&
  Number.isFinite(sample.serverTime) &&
  sample.receivedAt >= sample.sentAt &&
  sample.receivedAt - sample.sentAt <= maxSampleRoundTripMs;

export function createServerClock(now: () => number): ServerClock {
  let offsetMs = 0;
  let lastSyncedAt: number | null = null;
  return {
    observe(sample) {
      if (!isUsable(sample)) {
        return;
      }
      offsetMs = sample.serverTime - (sample.sentAt + sample.receivedAt) / 2;
      lastSyncedAt = sample.receivedAt;
    },
    restTimestampSeconds: () => Math.floor((now() + offsetMs) / 1000) - 1,
    nowMs: () => Math.floor(now() + offsetMs),
    syncedAt: () => lastSyncedAt,
  };
}
