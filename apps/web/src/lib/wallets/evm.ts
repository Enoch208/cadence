import { z } from "zod";
import type { WalletOption } from "./chains";
import { utf8Hex } from "./encoding";
import { walletStep } from "./errors";
import { dataImage, field } from "./fields";

type Eip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

const isEip1193 = (value: unknown): value is Eip1193Provider =>
  typeof field(value, "request") === "function";

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const accountsSchema = z.tuple([evmAddress], evmAddress);
const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);

const announcementSchema = z.object({
  info: z.object({
    name: z.string().min(1).max(64),
    rdns: z.string().min(1).max(256),
    icon: z.unknown(),
  }),
});

function evmOption(
  id: string,
  name: string,
  icon: string | null,
  provider: Eip1193Provider,
): WalletOption {
  return {
    id,
    name,
    chain: "ethereum",
    icon,
    connect: () =>
      walletStep(async () => {
        const [address] = accountsSchema.parse(
          await provider.request({ method: "eth_requestAccounts" }),
        );
        return {
          chain: "ethereum",
          address,
          sign: (message) =>
            walletStep(async () =>
              signatureSchema.parse(
                await provider.request({
                  method: "personal_sign",
                  params: [`0x${utf8Hex(message)}`, address],
                }),
              ),
            ),
        };
      }),
  };
}

export function evmWallets(host: EventTarget): WalletOption[] {
  const found = new Map<string, WalletOption>();
  const listen = (event: Event) => {
    const detail = field(event, "detail");
    const announced = announcementSchema.safeParse(detail);
    const provider = field(detail, "provider");
    if (!announced.success || !isEip1193(provider)) {
      return;
    }
    const { name, rdns, icon } = announced.data.info;
    found.set(rdns, evmOption(`ethereum:${rdns}`, name, dataImage(icon), provider));
  };
  host.addEventListener("eip6963:announceProvider", listen);
  host.dispatchEvent(new Event("eip6963:requestProvider"));
  host.removeEventListener("eip6963:announceProvider", listen);
  if (found.size > 0) {
    return [...found.values()];
  }
  const injected = field(host, "ethereum");
  return isEip1193(injected)
    ? [evmOption("ethereum:injected", "Browser wallet", null, injected)]
    : [];
}
