const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const bech32Alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const bech32Generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(clean)) {
    throw new Error("The value is not hex");
  }
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const utf8Hex = (text: string): string => bytesToHex(new TextEncoder().encode(text));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  const digits: number[] = [];
  for (const byte of bytes.subarray(zeros)) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  const body = digits.reverse().map((digit) => base58Alphabet.charAt(digit));
  return `${"1".repeat(zeros)}${body.join("")}`;
}

function polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    bech32Generators.forEach((generator, bit) => {
      if ((top >>> bit) & 1) {
        checksum = (checksum ^ generator) >>> 0;
      }
    });
  }
  return checksum;
}

const expandedPrefix = (prefix: string) => [
  ...Array.from(prefix, (char) => char.charCodeAt(0) >>> 5),
  0,
  ...Array.from(prefix, (char) => char.charCodeAt(0) & 31),
];

function fiveBitWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >>> bits) & 31);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) {
    words.push((accumulator << (5 - bits)) & 31);
  }
  return words;
}

function bech32Encode(prefix: string, bytes: Uint8Array): string {
  const words = fiveBitWords(bytes);
  const residue = polymod([...expandedPrefix(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((index) => (residue >>> (5 * (5 - index))) & 31);
  return `${prefix}1${[...words, ...checksum].map((word) => bech32Alphabet.charAt(word)).join("")}`;
}

export const cardanoAddress = (addressHex: string): string =>
  bech32Encode("addr", hexToBytes(addressHex));
