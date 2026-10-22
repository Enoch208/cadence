import { describe, expect, it } from "vitest";
import { base58Encode, cardanoAddress, hexToBytes, utf8Hex } from "../src/lib/wallets/encoding";

const paymentKeyHash = "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e";
const stakeKeyHash = "337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251";

describe("base58, as Solana encodes signatures", () => {
  it.each([
    ["", ""],
    ["61", "2g"],
    ["626262", "a3gV"],
    ["73696d706c792061206c6f6e6720737472696e67", "2cFupjhnEsSn59qHXstmK2ffpLv2"],
    ["00eb15231dfceb60925886b67d065299925915aeb172c06647", "1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L"],
    ["bf4f89001e670274dd", "3SEo3LWLoPntC"],
    ["ecac89cad93923c02321", "EJDM8drfXA6uyA"],
    ["00000000000000000000", "1111111111"],
  ])("encodes %s", (hex, encoded) => {
    expect(base58Encode(hexToBytes(hex))).toBe(encoded);
  });
});

describe("Cardano addresses for Strike", () => {
  it("encodes CIP-19's mainnet base address from the bytes a CIP-30 wallet returns", () => {
    expect(cardanoAddress(`01${paymentKeyHash}${stakeKeyHash}`)).toBe(
      "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
    );
  });

  it("encodes CIP-19's mainnet enterprise address", () => {
    expect(cardanoAddress(`61${paymentKeyHash}`)).toBe(
      "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8",
    );
  });

  it("refuses bytes that are not hex", () => {
    expect(() => cardanoAddress("01zz")).toThrow();
  });
});

describe("hex helpers", () => {
  it("hex-encodes the UTF-8 bytes of a message, as CIP-30 signData expects", () => {
    expect(utf8Hex("Connect to Strike")).toBe("436f6e6e65637420746f20537472696b65");
    expect(utf8Hex("é")).toBe("c3a9");
  });

  it("reads hex with or without 0x, in either case", () => {
    expect([...hexToBytes("0xAbCd")]).toEqual([0xab, 0xcd]);
    expect(() => hexToBytes("abc")).toThrow();
  });
});
