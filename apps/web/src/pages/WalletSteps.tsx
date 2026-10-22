import { CheckmarkCircle02Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ActionButton } from "@/components/ui/Button";
import { chainLabel, type ConnectedWallet, type WalletOption } from "@/lib/wallets/chains";

function NoWallet() {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-ink bg-sky p-5">
      <p className="t-card flex items-center gap-2">
        <HugeiconsIcon icon={Wallet01Icon} size={20} strokeWidth={1.6} />
        No wallet in this browser
      </p>
      <p className="t-body">
        Open this page in a browser with your wallet extension, or in your wallet app’s own browser.
        Telegram’s browser has no wallet in it.
      </p>
    </div>
  );
}

export function WalletList(props: {
  wallets: WalletOption[];
  onPick: (wallet: WalletOption) => void;
}) {
  if (props.wallets.length === 0) {
    return <NoWallet />;
  }
  return (
    <ul className="flex flex-wrap gap-3">
      {props.wallets.map((wallet) => (
        <li key={wallet.id}>
          <ActionButton
            onClick={() => {
              props.onPick(wallet);
            }}
          >
            <span className="flex items-center gap-2">
              {wallet.icon === null ? null : (
                <img src={wallet.icon} alt="" width={20} height={20} className="size-5" />
              )}
              {wallet.name} · {chainLabel[wallet.chain]}
            </span>
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}

export function MessageReview(props: {
  walletName: string;
  connected: ConnectedWallet;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-body">
        Strike’s message for {props.walletName} on {chainLabel[props.connected.chain]}, signing as{" "}
        <span className="break-all font-mono tabular-nums">{props.connected.address}</span>:
      </p>
      <pre className="whitespace-pre-wrap break-words rounded-card border border-ink bg-hover p-4 font-mono text-[14px] leading-relaxed">
        {props.message}
      </pre>
    </div>
  );
}

export function ConnectedNote({ strikeAccountId }: { strikeAccountId: string }) {
  return (
    <p
      role="status"
      className="t-body flex items-center gap-2 rounded-card border border-ink bg-mint p-5"
    >
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} strokeWidth={1.6} />
      <span>
        <span className="font-medium">Connected.</span> Strike account{" "}
        <span className="break-all tabular-nums">{strikeAccountId}</span> is now listed under your
        accounts.
      </span>
    </p>
  );
}
