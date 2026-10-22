import {
  StrikeAmbiguousError,
  StrikeRateLimitedError,
  StrikeReadError,
  StrikeRejectedError,
} from "@cadence/strike";
import { describeFailure, HttpError, unprocessable } from "./errors";

export async function askStrike<T>(purpose: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StrikeRejectedError && (error.status === 401 || error.status === 403)) {
      throw unprocessable(
        "KEY_NOT_ACCEPTED",
        "Strike did not accept this API key. Check that it is registered for your Cadence sub-account.",
      );
    }
    if (error instanceof StrikeRejectedError) {
      throw unprocessable("STRIKE_REFUSED", `Strike refused to ${purpose}. ${error.message}`);
    }
    if (error instanceof StrikeRateLimitedError) {
      throw new HttpError(
        503,
        "STRIKE_BUSY",
        "Strike asked Cadence to slow down. Try again shortly.",
      );
    }
    if (error instanceof StrikeReadError || error instanceof StrikeAmbiguousError) {
      process.stderr.write(`Strike could not ${purpose}. ${describeFailure(error)}\n`);
      throw new HttpError(
        502,
        "STRIKE_UNAVAILABLE",
        `Cadence could not reach Strike to ${purpose}. Try again in a moment.`,
      );
    }
    throw error;
  }
}
