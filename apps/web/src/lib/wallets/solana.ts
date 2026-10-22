import { z } from "zod";
import type { WalletOption } from "./chains";
import { base58Encode } from "./encoding";
import { unreadable, walletStep } from "./errors";
import { field } from "./fields";

type SolanaProvider = {
  connect(): Promise<unknown>;
  signMessage(message: Uint8Array, display?: string): Promise<unknown>;
};

type PublicKey = { toBase58(): unknown };

const isSolana = (value: unknown): value is SolanaProvider =>
  typeof field(value, "connect") === "function" &&
  typeof field(value, "signMessage") === "function";

const isPublicKey = (value: unknown): value is PublicKey =>
  typeof field(value, "toBase58") === "function";

const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const signatureByteList = z.array(z.number().int().min(0).max(255)).length(64);

function signatureBytes(reply: unknown): Uint8Array {
  const signature = reply instanceof Uint8Array ? reply : field(reply, "signature");
  if (signature instanceof Uint8Array) {
    return signature;
  }
  const listed = signatureByteList.safeParse(Array.isArray(signature) ? signature : null);
  if (!listed.success) {
    throw unreadable();
  }
  return Uint8Array.from(listed.data);
}

function solanaOption(id: string, name: string, provider: SolanaProvider): WalletOption {
  return {
    id,
    name,
    chain: "solana",
    icon: null,
    connect: () =>
      walletStep(async () => {
        const reply = await provider.connect();
        const key = field(reply, "publicKey") ?? field(provider, "publicKey");
        if (!isPublicKey(key)) {
          throw unreadable();
        }
        const address = solanaAddress.parse(key.toBase58());
        return {
          chain: "solana",
          address,
          sign: (message) =>
            walletStep(async () =>
              base58Encode(
                signatureBytes(
                  await provider.signMessage(new TextEncoder().encode(message), "utf8"),
                ),
              ),
            ),
        };
      }),
  };
}

export function solanaWallets(host: EventTarget): WalletOption[] {
  const named: [string, string, unknown][] = [
    ["solana:phantom", "Phantom", field(field(host, "phantom"), "solana")],
    ["solana:solflare", "Solflare", field(host, "solflare")],
  ];
  const found = named.flatMap(([id, name, provider]) =>
    isSolana(provider) ? [solanaOption(id, name, provider)] : [],
  );
  const injected = field(host, "solana");
  if (found.length === 0 && isSolana(injected)) {
    return [solanaOption("solana:injected", "Solana wallet", injected)];
  }
  return found;
}
