import { z } from "zod";
import { field, text } from "./fields";

export type WalletProblem = "declined" | "network" | "failed";

export class WalletError extends Error {
  override readonly name = "WalletError";
  readonly problem: WalletProblem;

  constructor(problem: WalletProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

const declinedCodes: ReadonlySet<number> = new Set([4001, -3, 3]);
const declinedWords = /reject|declin|denied|refus|cancel/i;
const longestQuote = 160;

export const unreadable = () =>
  new WalletError("failed", "Your wallet answered in a form Cadence cannot read.");

export function walletFailure(error: unknown): WalletError {
  if (error instanceof WalletError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return unreadable();
  }
  const code = field(error, "code");
  const said = (text(field(error, "message")) || text(field(error, "info"))).slice(0, longestQuote);
  if ((typeof code === "number" && declinedCodes.has(code)) || declinedWords.test(said)) {
    return new WalletError("declined", "You declined in your wallet, so nothing was connected.");
  }
  return new WalletError(
    "failed",
    said === "" ? "Your wallet could not finish that request." : `Your wallet said: ${said}`,
  );
}

export async function walletStep<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw walletFailure(error);
  }
}
