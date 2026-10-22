import type { WalletOption } from "./chains";
import { cardanoWallets } from "./cardano";
import { evmWallets } from "./evm";
import { solanaWallets } from "./solana";

export const detectWallets = (host: EventTarget): WalletOption[] => [
  ...evmWallets(host),
  ...solanaWallets(host),
  ...cardanoWallets(host),
];
