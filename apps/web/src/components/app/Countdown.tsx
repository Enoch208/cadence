import { formatRemaining } from "@/lib/format";
import { useNow } from "@/lib/use-now";

export function Countdown({ until, prefix }: { until: number; prefix: string }) {
  const now = useNow(1000);
  const remaining = until - now;
  return (
    <span className="tabular-nums" aria-live="polite">
      {remaining > 0 ? `${prefix} ${formatRemaining(remaining)}` : "Closed"}
    </span>
  );
}
