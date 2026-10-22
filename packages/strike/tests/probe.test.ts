import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarketRules } from "@cadence/core";
import { afterAll, describe, expect, it } from "vitest";
import { parseProbeAccountArgs, parseProbeOrderArgs } from "../scripts/probe-args";
import { readPrivateEnvFile } from "../scripts/probe-env";
import { liveCeiling, minimumProbeOrder } from "../scripts/probe-order-plan";
import { toBookSnapshot, toMarketRules, toMarkSnapshot } from "../src/normalize";
import { capturedMarkPriceFor, fixture } from "./support/fixtures";

describe("probe:order arguments", () => {
  it("refuses to run without --live-order", () => {
    expect(() => parseProbeOrderArgs(["--credentials", "/tmp/strike.env"])).toThrow(
      "probe:order places a real order on Strike mainnet; pass --live-order to confirm",
    );
  });

  it("refuses --live-order without an env file", () => {
    expect(() => parseProbeOrderArgs(["--live-order"])).toThrow("--credentials");
  });

  it("accepts both flags, with or without pnpm's separator", () => {
    const expected = { envFile: "/tmp/strike.env", liveOrder: true };
    expect(parseProbeOrderArgs(["--credentials", "/tmp/strike.env", "--live-order"])).toEqual(
      expected,
    );
    expect(parseProbeOrderArgs(["--", "--live-order", "--credentials", "/tmp/strike.env"])).toEqual(
      expected,
    );
  });

  it("does not take Node's own --env-file flag, which tsx intercepts", () => {
    expect(() => parseProbeOrderArgs(["--env-file", "/tmp/strike.env", "--live-order"])).toThrow();
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(() =>
      parseProbeOrderArgs(["--credentials", "x", "--live-order", "--size", "1"]),
    ).toThrow();
  });
});

describe("probe:account arguments", () => {
  it("needs an env file and takes nothing that could place an order", () => {
    expect(parseProbeAccountArgs(["--credentials", "/tmp/strike.env"])).toEqual({
      envFile: "/tmp/strike.env",
    });
    expect(() => parseProbeAccountArgs([])).toThrow("--credentials");
    expect(() => parseProbeAccountArgs(["--credentials", "x", "--live-order"])).toThrow();
  });
});

describe("readPrivateEnvFile", () => {
  const directory = mkdtempSync(join(tmpdir(), "cadence-probe-test-"));
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const envFile = (name: string, mode: number) => {
    const path = join(directory, name);
    writeFileSync(path, "STRIKE_SUBACCOUNT_ID=abc\nCADENCE_LIVE_MAX_NOTIONAL=15\n");
    chmodSync(path, mode);
    return path;
  };

  it("reads a file only its owner can read", () => {
    expect(readPrivateEnvFile(envFile("owner.env", 0o600))).toMatchObject({
      STRIKE_SUBACCOUNT_ID: "abc",
      CADENCE_LIVE_MAX_NOTIONAL: "15",
    });
  });

  it.each([0o644, 0o640, 0o604])("refuses a file with mode %o", (mode) => {
    expect(() => readPrivateEnvFile(envFile(`shared-${mode.toString(8)}.env`, mode))).toThrow(
      "chmod 600",
    );
  });
});

describe("minimumProbeOrder", () => {
  const market = toMarketRules(fixture("mainnet-get-v2-markets.json")).find(
    (rules): rules is MarketRules => rules.symbol === "BTC-USD",
  );
  if (market === undefined) {
    throw new Error("The captured markets have no BTC-USD");
  }
  const book = toBookSnapshot(fixture("mainnet-get-price-v2-depth-BTC-USD.json"), "BTC-USD", 0);
  const mark = toMarkSnapshot(capturedMarkPriceFor("BTC-USD"), 0);
  const intentId = "probe-0b9c7a52-6a4f-4f8e-9a51-3e8b1f2d6c10";

  it("buys the smallest size that clears the minimum notional, at the best ask, with exits 1% away", () => {
    const probe = minimumProbeOrder({ intentId, market, book, mark, maxNotional: "15" });
    expect(probe.order).toEqual({
      strategyId: `cad-${intentId}`,
      entryClientOrderId: `cad-${intentId}-e`,
      stopClientOrderId: `cad-${intentId}-s`,
      targetClientOrderId: `cad-${intentId}-t`,
      symbol: "BTC-USD",
      side: "buy",
      size: "0.00012",
      limitPrice: "84482",
      stopPrice: "83637",
      targetPrice: "85327",
    });
    expect(probe.notional).toBe("10.13784");
  });

  it("refuses when even the minimum order exceeds the live ceiling", () => {
    expect(() => minimumProbeOrder({ intentId, market, book, mark, maxNotional: "10" })).toThrow(
      "CADENCE_LIVE_MAX_NOTIONAL",
    );
  });

  it("refuses an empty book", () => {
    const empty = { ...book, asks: [] };
    expect(() =>
      minimumProbeOrder({ intentId, market, book: empty, mark, maxNotional: "15" }),
    ).toThrow("no ask");
  });

  it("refuses a market that is not trading", () => {
    expect(() =>
      minimumProbeOrder({
        intentId,
        market: { ...market, status: "pre_trading" },
        book,
        mark,
        maxNotional: "15",
      }),
    ).toThrow("not trading");
  });
});

describe("liveCeiling", () => {
  it("requires a positive decimal and has no default", () => {
    expect(liveCeiling({ CADENCE_LIVE_MAX_NOTIONAL: "15" })).toBe("15");
    expect(() => liveCeiling({})).toThrow("CADENCE_LIVE_MAX_NOTIONAL");
    expect(() => liveCeiling({ CADENCE_LIVE_MAX_NOTIONAL: "0" })).toThrow(
      "CADENCE_LIVE_MAX_NOTIONAL",
    );
    expect(() => liveCeiling({ CADENCE_LIVE_MAX_NOTIONAL: "1e3" })).toThrow(
      "CADENCE_LIVE_MAX_NOTIONAL",
    );
  });
});
