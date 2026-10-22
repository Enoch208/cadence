import type { Environment } from "@cadence/core";
import { TicketRows } from "@/components/ui/Ticket";
import type { IntentView } from "@/lib/api/schemas";
import { venueName } from "@/lib/copy/states";

const roleLabel = {
  entry: "Entry",
  stop: "Stop",
  target: "Target",
  recovery_close: "Recovery close",
} as const;

function describe(order: IntentView["orders"][number]): string {
  const status =
    order.lastStatus === null
      ? "Not seen yet"
      : `${order.lastStatus.charAt(0).toUpperCase()}${order.lastStatus.slice(1)}`;
  const reference = order.exchangeOrderId === null ? "" : ` · order ${order.exchangeOrderId}`;
  const filled = /^0(\.0+)?$/.test(order.filledSize) ? "" : ` · ${order.filledSize} filled`;
  return `${status}${filled}${reference}`;
}

export function OrdersPanel({
  orders,
  environment,
}: {
  orders: IntentView["orders"];
  environment: Environment;
}) {
  if (orders.length === 0) {
    return <p className="t-body">Nothing has been sent to {venueName[environment]} yet.</p>;
  }
  return <TicketRows rows={orders.map((order) => [roleLabel[order.role], describe(order)])} />;
}
