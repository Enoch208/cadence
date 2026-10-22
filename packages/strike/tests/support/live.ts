import { restSigningMessage, type HttpMethod } from "../../src/canonical";
import { createServerClock } from "../../src/clock";
import { createLiveStrikeClient } from "../../src/live-client";
import { createSigner } from "../../src/signer";
import { fakeFetch, json, serverTimeReply, type RecordedRequest, type Reply } from "./fake-fetch";
import { fixtureText } from "./fixtures";
import { throwawayKeys, verifies } from "./keys";

export const serverEpoch = 1_792_603_881_365;
export const localAheadMs = 1_450;

export const reply = (name: string, status = 200) => json(status, fixtureText(name));

export function liveHarness(route: (request: RecordedRequest) => Reply) {
  let local = serverEpoch + localAheadMs;
  const now = () => local;
  const keys = throwawayKeys();
  const signer = createSigner(keys);
  const serverNowAt = new Map<RecordedRequest, number>();
  const localAt = new Map<RecordedRequest, number>();
  const fake = fakeFetch((request) => {
    localAt.set(request, local);
    local += 20;
    serverNowAt.set(request, local - localAheadMs);
    return request.url.pathname === "/v2/time"
      ? serverTimeReply(local - localAheadMs)
      : route(request);
  });
  const client = createLiveStrikeClient({
    baseUrl: "https://api.strikefinance.org",
    signer,
    clock: createServerClock(now),
    fetch: fake.fetch,
    timeoutMs: 200,
    now,
  });
  const exchange = () => fake.requests.filter((request) => request.url.pathname !== "/v2/time");
  const signatureVerifies = (request: RecordedRequest) =>
    verifies(
      keys.publicKeyHex,
      restSigningMessage({
        method: request.method as HttpMethod,
        pathWithQuery: `${request.url.pathname}${request.url.search}`,
        timestampSeconds: Number(request.headers.get("x-api-wallet-timestamp")),
        nonce: request.headers.get("x-api-wallet-nonce") ?? "",
        body: request.body,
      }),
      request.headers.get("x-api-wallet-signature") ?? "",
    );
  const signedAheadOfServer = (request: RecordedRequest) =>
    Number(request.headers.get("x-api-wallet-timestamp")) * 1000 > (serverNowAt.get(request) ?? 0);
  return {
    client,
    keys,
    requests: fake.requests,
    exchange,
    signatureVerifies,
    signedAheadOfServer,
    sentAt: (request: RecordedRequest) => localAt.get(request) ?? Number.NaN,
    now,
    advance: (ms: number) => {
      local += ms;
    },
  };
}
