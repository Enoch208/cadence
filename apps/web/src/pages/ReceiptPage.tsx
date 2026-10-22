import { Link, useParams } from "react-router";
import { AppShell, Panel } from "@/components/app/AppShell";
import { EnvironmentBadge } from "@/components/app/EnvironmentBadge";
import { LoginGate } from "@/components/app/LoginGate";
import { Loading, Problem } from "@/components/app/Notice";
import { ActionButton } from "@/components/ui/Button";
import { TicketRows } from "@/components/ui/Ticket";
import { apiRequest } from "@/lib/api/client";
import {
  intentSchema,
  receiptResponseSchema,
  type IntentView,
  type ReceiptResponse,
} from "@/lib/api/schemas";
import { intentStateLabel } from "@/lib/copy/states";
import { formatInstant, formatPrice, formatUsd, shortDigest } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

function download(receipt: ReceiptResponse) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cadence-receipt-${receipt.receipt.intentId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

const leg = (filled: { size: string; averagePrice: string } | null) =>
  filled === null ? "None" : `${filled.size} at ${formatPrice(filled.averagePrice)}`;

function profitLine(realizedPnl: string | null): string {
  if (realizedPnl === null) {
    return "Not final yet";
  }
  return realizedPnl.startsWith("-")
    ? `Loss of ${formatUsd(realizedPnl.slice(1))}`
    : `Gain of ${formatUsd(realizedPnl)}`;
}

function ReceiptView({ data, intent }: { data: ReceiptResponse; intent: IntentView }) {
  const { receipt } = data;
  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-title">Receipt</h1>
          <EnvironmentBadge environment={intent.environment} />
        </div>
        <p className="t-body">
          {intent.market} · {intentStateLabel[receipt.state]} · reconciled with Strike{" "}
          {formatInstant(receipt.reconciledAt)}
        </p>
        <TicketRows
          rows={[
            ["Plan", `${receipt.planPublicId}, version ${String(receipt.planVersion)}`],
            ["Plan digest", shortDigest(receipt.planDigest)],
            ["Your rules", `version ${String(receipt.policyVersion)}`],
            [
              "Approved",
              receipt.approved === null
                ? "Nothing"
                : `${receipt.approved.quantity} at most, limit ${formatPrice(receipt.approved.limitPrice)}`,
            ],
            [
              "Planned risk",
              receipt.approved === null ? "None" : formatUsd(receipt.approved.plannedLoss),
            ],
            ["Entry filled", leg(receipt.entry)],
            ["Exit filled", leg(receipt.exit)],
            ["Fees paid", formatUsd(receipt.feesPaid)],
            ["Realized result", profitLine(receipt.realizedPnl)],
          ]}
        />
        {receipt.incomplete.length > 0 ? (
          <p className="t-body rounded-card border border-ink bg-butter p-4">
            <strong>Not final.</strong> Still waiting on: {receipt.incomplete.join(", ")}. Nothing
            here is estimated; missing values stay missing until Strike reports them.
          </p>
        ) : null}
      </Panel>
      <Panel>
        <h2 className="t-card">Strike order IDs</h2>
        {receipt.exchangeOrderIds.length === 0 ? (
          <p className="t-body">No order reached Strike.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {receipt.exchangeOrderIds.map((orderId) => (
              <li key={orderId} className="t-body tabular-nums">
                {orderId}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={() => {
              download(data);
            }}
          >
            Download receipt
          </ActionButton>
          <Link
            to={`/intents/${intent.id}`}
            className="t-body self-center underline underline-offset-4"
          >
            Order timeline
          </Link>
        </div>
      </Panel>
    </>
  );
}

function Receipt({ intentId }: { intentId: string }) {
  const loaded = useResource(intentId, async (signal) => {
    const [data, intent] = await Promise.all([
      apiRequest(receiptResponseSchema, `/api/receipts/${encodeURIComponent(intentId)}`, {
        signal,
      }),
      apiRequest(intentSchema, `/api/intents/${encodeURIComponent(intentId)}`, { signal }),
    ]);
    return { data, intent };
  });
  if (loaded.status === "ready") {
    return <ReceiptView data={loaded.data.data} intent={loaded.data.intent} />;
  }
  return loaded.status === "failed" ? (
    <Problem title="This receipt is not available" onRetry={loaded.reload}>
      {loaded.error.message}
    </Problem>
  ) : (
    <Loading label="Loading the receipt" />
  );
}

export function ReceiptPage() {
  const { intentId = "" } = useParams();
  return (
    <AppShell>
      <LoginGate>{() => <Receipt intentId={intentId} />}</LoginGate>
    </AppShell>
  );
}
