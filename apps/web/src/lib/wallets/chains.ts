export const walletChains = ["ethereum", "solana", "cardano"] as const;
export type WalletChain = (typeof walletChains)[number];

export const chainLabel: Record<WalletChain, string> = {
  ethereum: "Ethereum",
  solana: "Solana",
  cardano: "Cardano",
};

export type ConnectedWallet = {
  chain: WalletChain;
  address: string;
  sign(message: string): Promise<string>;
};

export type WalletOption = {
  id: string;
  name: string;
  chain: WalletChain;
  icon: string | null;
  connect(): Promise<ConnectedWallet>;
};
