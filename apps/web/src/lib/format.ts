const price = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const instant = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const asLiteral = (value: string) => value as Intl.StringNumericLiteral;

export const formatPrice = (value: string) => price.format(asLiteral(value));

export const formatUsd = (value: string) => `$${usd.format(asLiteral(value))}`;

export const formatInstant = (value: string | number) => instant.format(new Date(value));

export const shortDigest = (digest: string) => `${digest.slice(0, 8)}…${digest.slice(-4)}`;

export function formatRemaining(ms: number): string {
  if (ms <= 0) {
    return "closed";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}
