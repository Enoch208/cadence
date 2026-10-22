import type { BuilderTerms } from "@/lib/api/builder";

export function WalletTerms({ terms }: { terms: BuilderTerms }) {
  const builder = terms.builderCode ?? "";
  const points = [
    "It connects your main Strike account, the one this wallet signs in to, not a sub-account. If the wallet has no Strike account yet, Strike creates an empty one.",
    `Strike’s message says you are entrusting an API key to builder “${builder}”, which is Cadence. The key does not expire. Cadence keeps it encrypted and never shows it.`,
    `Cadence uses it only to place, read and cancel orders within your risk rules, and never sends an order above $${terms.liveMaxNotional} notional.`,
    "The key itself can do more: it can start deposits and withdrawals, each of which still needs your wallet’s signature, and move balance into Strike vaults. Cadence has no code that does any of this.",
    "Cadence sets the markets you allow to isolated margin at your leverage cap on that account, which also applies to your own trades there. While the account holds positions or orders Cadence did not place, Cadence declines new plans.",
    `You approve a builder fee of ${String(terms.feeBps / 100)}%. Cadence charges members no fee.`,
    "To revoke the key, open API keys in the Strike app and revoke it there. Connecting again from Cadence also replaces the old key.",
  ];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="t-body font-medium">Before you sign</h3>
      <ul className="flex flex-col">
        {points.map((point) => (
          <li key={point} className="t-body border-t border-ink py-3">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}
