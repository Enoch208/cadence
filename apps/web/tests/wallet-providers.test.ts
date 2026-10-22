import { describe, expect, it } from "vitest";
import { detectWallets } from "../src/lib/wallets/detect";
import { base58Encode, hexToBytes, utf8Hex } from "../src/lib/wallets/encoding";
import { WalletError } from "../src/lib/wallets/errors";

const message = 'Connect to Strike via builder "cadence".\nNonce: 1';
const evmAddress = "0x742d35cc6634c0532925a3b844bc9e7595f2bd18";
const evmSignature = `0x${"ab".repeat(65)}`;
const icon = "data:image/svg+xml;base64,PHN2Zy8+";
const cardanoBaseHex =
  "019493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251";

type Call = { method: string; params?: readonly unknown[] };

function evmProvider(calls: Call[], refuse?: Error) {
  return {
    request: (call: Call) => {
      calls.push(call);
      if (refuse !== undefined) {
        return Promise.reject(refuse);
      }
      return Promise.resolve(call.method === "eth_requestAccounts" ? [evmAddress] : evmSignature);
    },
  };
}

function hostWith(properties: Record<string, unknown>) {
  return Object.assign(new EventTarget(), properties);
}

function announce(host: EventTarget, name: string, provider: unknown, walletIcon = icon) {
  host.addEventListener("eip6963:requestProvider", () => {
    host.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: { info: { uuid: name, name, icon: walletIcon, rdns: `io.${name}` }, provider },
      }),
    );
  });
}

const only = <T>(items: readonly T[]): T => {
  const [first] = items;
  if (first === undefined || items.length !== 1) {
    throw new Error(`Expected one wallet, found ${String(items.length)}`);
  }
  return first;
};

describe("finding wallets in the browser", () => {
  it("finds nothing in a browser with no wallet, such as Telegram's", () => {
    expect(detectWallets(hostWith({}))).toEqual([]);
  });

  it("lists EIP-6963 wallets by name, keeping only image data icons", () => {
    const host = hostWith({});
    announce(host, "Rabby", evmProvider([]));
    announce(host, "Sketchy", evmProvider([]), "https://tracker.example/icon.png");
    const wallets = detectWallets(host);
    expect(wallets.map(({ name, chain, icon: shown }) => ({ name, chain, shown }))).toEqual([
      { name: "Rabby", chain: "ethereum", shown: icon },
      { name: "Sketchy", chain: "ethereum", shown: null },
    ]);
  });

  it("falls back to the injected Ethereum provider when nothing announces itself", () => {
    const wallets = detectWallets(hostWith({ ethereum: evmProvider([]) }));
    expect(only(wallets)).toMatchObject({ name: "Browser wallet", chain: "ethereum" });
  });

  it("lists Solana and CIP-30 Cardano wallets, skipping entries that are not wallets", () => {
    const solana = { connect: () => Promise.resolve({}), signMessage: () => Promise.resolve({}) };
    const cardano = {
      eternl: { name: "Eternl", icon, enable: () => Promise.resolve({}) },
      typhoncip30: { name: "Typhon", enable: () => Promise.resolve({}) },
      typhon: { name: "Typhon", enable: () => Promise.resolve({}) },
      version: "1",
    };
    const wallets = detectWallets(hostWith({ phantom: { solana }, solflare: solana, cardano }));
    expect(wallets.map(({ name, chain }) => `${name}/${chain}`)).toEqual([
      "Phantom/solana",
      "Solflare/solana",
      "Eternl/cardano",
      "Typhon/cardano",
    ]);
  });
});

describe("signing Strike's message", () => {
  it("signs with EIP-191 personal_sign over the hex of the message", async () => {
    const calls: Call[] = [];
    const wallet = only(detectWallets(hostWith({ ethereum: evmProvider(calls) })));
    const connected = await wallet.connect();
    expect(connected.address).toBe(evmAddress);
    expect(await connected.sign(message)).toBe(evmSignature);
    expect(calls).toEqual([
      { method: "eth_requestAccounts" },
      { method: "personal_sign", params: [`0x${utf8Hex(message)}`, evmAddress] },
    ]);
  });

  it("signs the UTF-8 bytes on Solana and returns the signature in base58", async () => {
    const signatureBytes = Uint8Array.from({ length: 64 }, (_value, index) => index + 1);
    const signed: Uint8Array[] = [];
    const publicKey = { toBase58: () => "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" };
    const phantom = {
      solana: {
        connect: () => Promise.resolve({ publicKey }),
        signMessage: (bytes: Uint8Array) => {
          signed.push(bytes);
          return Promise.resolve({ signature: signatureBytes, publicKey });
        },
      },
    };
    const connected = await only(detectWallets(hostWith({ phantom }))).connect();
    expect(connected.address).toBe(publicKey.toBase58());
    expect(await connected.sign(message)).toBe(base58Encode(signatureBytes));
    expect(new TextDecoder().decode(signed[0])).toBe(message);
  });

  it("signs CIP-30 data with the change address and joins the COSE parts as Strike reads them", async () => {
    const signedWith: [string, string][] = [];
    const api = {
      getNetworkId: () => Promise.resolve(1),
      getChangeAddress: () => Promise.resolve(cardanoBaseHex),
      signData: (address: string, payload: string) => {
        signedWith.push([address, payload]);
        return Promise.resolve({ signature: "845846a201", key: "a4010103" });
      },
    };
    const cardano = { lace: { name: "Lace", enable: () => Promise.resolve(api) } };
    const connected = await only(detectWallets(hostWith({ cardano }))).connect();
    expect(connected.address).toMatch(/^addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3/);
    expect(await connected.sign(message)).toBe("845846a201:a4010103");
    expect(signedWith).toEqual([[cardanoBaseHex, utf8Hex(message)]]);
    expect(hexToBytes(signedWith[0]?.[1] ?? "")).toEqual(new TextEncoder().encode(message));
  });

  it("refuses a Cardano wallet that is not on mainnet", async () => {
    const api = {
      getNetworkId: () => Promise.resolve(0),
      getChangeAddress: () => Promise.resolve(cardanoBaseHex),
      signData: () => Promise.reject(new Error("Cadence must not ask a testnet wallet to sign")),
    };
    const cardano = { nami: { name: "Nami", enable: () => Promise.resolve(api) } };
    await expect(only(detectWallets(hostWith({ cardano }))).connect()).rejects.toMatchObject({
      problem: "network",
    });
  });
});

describe("when the wallet says no", () => {
  it.each([
    ["EIP-1193", Object.assign(new Error("Request failed"), { code: 4001 })],
    ["CIP-30 refused", Object.assign(new Error(""), { code: -3, info: "user refused" })],
    ["a plain rejection", new Error("User denied message signature")],
  ])("reads %s as the member declining", async (_label, refusal) => {
    const wallet = only(detectWallets(hostWith({ ethereum: evmProvider([], refusal) })));
    const failure = await wallet.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WalletError);
    expect(failure).toMatchObject({ problem: "declined" });
  });

  it("passes on any other wallet failure in its own words", async () => {
    const wallet = only(
      detectWallets(
        hostWith({
          ethereum: evmProvider([], Object.assign(new Error("Locked"), { code: -32603 })),
        }),
      ),
    );
    await expect(wallet.connect()).rejects.toMatchObject({
      problem: "failed",
      message: "Your wallet said: Locked",
    });
  });
});
