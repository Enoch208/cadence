import { z } from "zod";
import type { WalletOption } from "./chains";
import { cardanoAddress, utf8Hex } from "./encoding";
import { WalletError, walletStep } from "./errors";
import { dataImage, field, text } from "./fields";

type Cip30Wallet = { enable(): Promise<unknown> };

type Cip30Api = {
  getNetworkId(): Promise<unknown>;
  getChangeAddress(): Promise<unknown>;
  signData(address: string, payload: string): Promise<unknown>;
};

const mainnetNetworkId = 1;
const hex = z.string().regex(/^(?:[0-9a-fA-F]{2})+$/);
const dataSignatureSchema = z.object({ signature: hex, key: hex });

const isCip30Wallet = (value: unknown): value is Cip30Wallet =>
  typeof field(value, "enable") === "function";

const isCip30Api = (value: unknown): value is Cip30Api =>
  ["getNetworkId", "getChangeAddress", "signData"].every(
    (name) => typeof field(value, name) === "function",
  );

function cardanoOption(
  id: string,
  name: string,
  icon: string | null,
  wallet: Cip30Wallet,
): WalletOption {
  return {
    id,
    name,
    chain: "cardano",
    icon,
    connect: () =>
      walletStep(async () => {
        const api = await wallet.enable();
        if (!isCip30Api(api)) {
          throw new WalletError("failed", `${name} cannot sign messages for Strike.`);
        }
        if ((await api.getNetworkId()) !== mainnetNetworkId) {
          throw new WalletError(
            "network",
            "Switch your Cardano wallet to mainnet, then try again.",
          );
        }
        const addressHex = hex.parse(await api.getChangeAddress());
        return {
          chain: "cardano",
          address: cardanoAddress(addressHex),
          sign: (message) =>
            walletStep(async () => {
              const signed = dataSignatureSchema.parse(
                await api.signData(addressHex, utf8Hex(message)),
              );
              return `${signed.signature}:${signed.key}`;
            }),
        };
      }),
  };
}

export function cardanoWallets(host: EventTarget): WalletOption[] {
  const namespace = field(host, "cardano");
  if (typeof namespace !== "object" || namespace === null) {
    return [];
  }
  const names = new Set<string>();
  return Object.keys(namespace).flatMap((id) => {
    const wallet = field(namespace, id);
    const name = text(field(wallet, "name")).slice(0, 64);
    if (!isCip30Wallet(wallet) || name === "" || names.has(name)) {
      return [];
    }
    names.add(name);
    return [cardanoOption(`cardano:${id}`, name, dataImage(field(wallet, "icon")), wallet)];
  });
}
