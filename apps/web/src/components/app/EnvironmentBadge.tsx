import type { Environment } from "@cadence/core";
import { PlayCircle02Icon, Pulse01Icon } from "@hugeicons/core-free-icons";
import { StatusPill } from "@/components/ui/Ticket";

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return environment === "live" ? (
    <StatusPill label="Live on Strike mainnet" tone="mint" icon={Pulse01Icon} />
  ) : (
    <StatusPill label="Replay, no real orders" tone="butter" icon={PlayCircle02Icon} />
  );
}
