import { Link } from "react-router";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import type { IntentSummary } from "@/lib/api/schemas";
import { intentStateLabel } from "@/lib/copy/states";
import { formatInstant, formatPrice, formatUsd } from "@/lib/format";

function OrderRow({ order, history }: { order: IntentSummary; history: boolean }) {
  const destination =
    history && order.receiptReady ? `/receipts/${order.id}` : `/intents/${order.id}`;
  return (
    <li className="border-t border-ink first:border-t-0">
      <Link
        to={destination}
        className="flex flex-wrap items-center justify-between gap-3 py-4 transition-colors hover:bg-hover"
      >
        <span className="flex flex-col gap-1">
          <span className="t-body font-medium">
            {order.market} {order.direction === "long" ? "long" : "short"} ·{" "}
            {intentStateLabel[order.state]}
          </span>
          <span className="t-body tabular-nums">
            {order.quantity} at {formatPrice(order.limitPrice)} · planned risk{" "}
            {formatUsd(order.plannedLoss)} · {formatInstant(order.updatedAt)}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <EnvironmentBadge environment={order.environment} />
          <span className="t-meta">{history && order.receiptReady ? "Receipt" : "Order"} →</span>
        </span>
      </Link>
    </li>
  );
}

export function OrderRows({
  orders,
  history,
}: {
  orders: readonly IntentSummary[];
  history: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} history={history} />
      ))}
    </ul>
  );
}
