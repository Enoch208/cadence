type CloseEvent = { type: string };

const closeEventTypes = [
  "close_requested",
  "close_attempted",
  "close_acknowledged",
  "close_rejected",
  "close_unknown",
  "close_not_needed",
] as const;
type CloseEventType = (typeof closeEventTypes)[number];

const isCloseEvent = (type: string): type is CloseEventType =>
  (closeEventTypes as readonly string[]).includes(type);

const wording: Record<CloseEventType, (venue: string) => string> = {
  close_requested: (venue) => `Closing at the market price on ${venue}.`,
  close_attempted: (venue) => `Closing at the market price on ${venue}.`,
  close_acknowledged: (venue) =>
    `${venue} has the close. Your stop and target are canceled once it fills.`,
  close_rejected: (venue) => `${venue} refused the close. Your stop and target stay in place.`,
  close_unknown: () =>
    "The answer to the close did not arrive. Cadence is looking for it by its ID and will not send it twice.",
  close_not_needed: () => "There was no open position left to close.",
};

export function closeProgress(events: readonly CloseEvent[], venue: string): string | null {
  const latest = events.map(({ type }) => type).findLast(isCloseEvent);
  return latest === undefined ? null : wording[latest](venue);
}
