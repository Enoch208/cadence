import {
  builderChallengeLifetimeMs,
  builderFeeShareBps,
  generateSignerKeys,
  StrikeAmbiguousError,
  StrikeRejectedError,
  walletChains,
  walletSignatureSchema,
  type BuilderConnectClient,
  type BuilderWallet,
  type RegisteredBuilderWallet,
} from "@cadence/strike";
import type { AppDeps } from "../deps";
import { invalidRequest } from "../http/body";
import { describeFailure, HttpError, unprocessable } from "../http/errors";
import { askStrike } from "../http/strike";
import {
  claimPendingChallenge,
  livePendingChallenge,
  savePendingChallenge,
} from "./builder-challenges";
import { storeLiveConnection } from "./live-connection";

const challengeMarginMs = 30_000;

const switchedOff = () =>
  new HttpError(
    503,
    "BUILDER_CONNECT_OFF",
    "Connecting with a wallet signature is not switched on here. Paste a sub-account API key instead.",
  );

const unavailable = () =>
  new HttpError(
    503,
    "BUILDER_CONNECT_UNAVAILABLE",
    "Strike is not accepting wallet connections for Cadence right now. Paste a sub-account API key instead, or try again later.",
  );

const walletRefused = () =>
  unprocessable(
    "WALLET_REFUSED",
    "Strike did not accept that wallet. Check that it is a mainnet wallet on the chain you chose.",
  );

const signatureRefused = () =>
  unprocessable(
    "WALLET_SIGNATURE_REFUSED",
    "Strike could not verify that signature. Start again and sign the new message with the same wallet.",
  );

const challengeSpent = () =>
  new HttpError(410, "CHALLENGE_EXPIRED", "That signing request expired. Start again.");

const unconfirmed = () =>
  new HttpError(
    502,
    "BUILDER_CONNECT_UNCONFIRMED",
    "Strike did not confirm the connection, so Cadence stored nothing. Start again: a new connection replaces any key from this attempt.",
  );

export function builderClient(deps: AppDeps): BuilderConnectClient {
  if (deps.builderConnect === null) {
    throw switchedOff();
  }
  return deps.builderConnect;
}

export const builderAvailability = (deps: AppDeps) => ({
  available: deps.builderConnect !== null,
  builderCode: deps.builderConnect?.builderCode ?? null,
  feeBps: builderFeeShareBps,
  chains: walletChains,
});

function logged(error: StrikeRejectedError): StrikeRejectedError {
  process.stderr.write(`Builder connect refused. ${describeFailure(error)}\n`);
  return error;
}

async function refusalsAs<T>(work: () => Promise<T>, as: (error: StrikeRejectedError) => Error) {
  try {
    return await work();
  } catch (error) {
    throw error instanceof StrikeRejectedError ? as(logged(error)) : error;
  }
}

const startRefusal = (error: StrikeRejectedError) =>
  error.status === 404 || /builder/i.test(error.strikeMessage) ? unavailable() : walletRefused();

function verifyRefusal(error: StrikeRejectedError): HttpError {
  if (error.status === 401) {
    return signatureRefused();
  }
  return /challenge/i.test(error.strikeMessage) ? challengeSpent() : walletRefused();
}

export async function startBuilderConnect(deps: AppDeps, userId: string, wallet: BuilderWallet) {
  const builder = builderClient(deps);
  const startedAt = deps.now();
  const keys = generateSignerKeys();
  const challenge = await askStrike("start connecting your wallet", () =>
    refusalsAs(
      () => builder.requestSignature({ ...wallet, publicKeyHex: keys.publicKeyHex }),
      startRefusal,
    ),
  );
  const expiresAt = startedAt + builderChallengeLifetimeMs - challengeMarginMs;
  const row = await savePendingChallenge(deps, userId, { wallet, keys, challenge, expiresAt });
  return {
    challengeId: row.id,
    chain: row.walletChain,
    address: row.walletAddress,
    message: row.consentMessage,
    expiresAt: row.expiresAt,
  };
}

function registered(
  builder: BuilderConnectClient,
  request: { nonce: string; walletSignature: string; publicKeyHex: string },
): Promise<RegisteredBuilderWallet | null> {
  return askStrike("connect your wallet", async () => {
    try {
      return await refusalsAs(() => builder.verifySignature(request), verifyRefusal);
    } catch (error) {
      if (error instanceof StrikeAmbiguousError) {
        process.stderr.write(
          `Builder connect outcome unknown, checking the new key. ${describeFailure(error)}\n`,
        );
        return null;
      }
      throw error;
    }
  });
}

function confirmedLater<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    throw error instanceof HttpError && error.code === "KEY_NOT_ACCEPTED" ? unconfirmed() : error;
  });
}

export async function finishBuilderConnect(
  deps: AppDeps,
  userId: string,
  input: { challengeId: string; signature: string },
) {
  const builder = builderClient(deps);
  const pending = await livePendingChallenge(deps, userId, input.challengeId);
  const signature = walletSignatureSchema(pending.walletChain).safeParse(input.signature);
  if (!signature.success) {
    throw invalidRequest(`That is not a ${pending.walletChain} wallet signature.`);
  }
  const { signer, privateKeyHex } = await claimPendingChallenge(deps, pending);
  const wallet = await registered(builder, {
    nonce: pending.strikeNonce,
    walletSignature: signature.data,
    publicKeyHex: pending.publicKey,
  });
  const store = () =>
    storeLiveConnection(deps, userId, {
      signer,
      privateKeyHex,
      source: "builder",
      reportedAccountId: wallet?.accountId ?? null,
      detail: {
        walletChain: pending.walletChain,
        walletAddress: pending.walletAddress,
        builderCode: builder.builderCode,
        apiWalletId: wallet?.apiWalletId ?? null,
      },
    });
  return wallet === null ? confirmedLater(store) : store();
}
