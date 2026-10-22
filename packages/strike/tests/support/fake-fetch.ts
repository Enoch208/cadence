export type RecordedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
};

export type Reply = Response | Error | "hang";

export type FakeFetch = {
  fetch: typeof fetch;
  requests: RecordedRequest[];
};

const bodyText = (body: RequestInit["body"]): string => {
  if (body === undefined || body === null) {
    return "";
  }
  if (typeof body !== "string") {
    throw new Error("The client must send its body as the exact string it signed");
  }
  return body;
};

const hangUntilAborted = (signal: AbortSignal | null | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    });
  });

export function fakeFetch(route: (request: RecordedRequest) => Reply): FakeFetch {
  const requests: RecordedRequest[] = [];
  const handler = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (!(input instanceof URL)) {
      throw new Error("The client must pass a URL object");
    }
    const request: RecordedRequest = {
      url: input,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: bodyText(init?.body),
    };
    requests.push(request);
    const reply = route(request);
    if (reply === "hang") {
      return hangUntilAborted(init?.signal);
    }
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  };
  return { fetch: handler, requests };
}

export const json = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "application/json" } });

export const serverTimeReply = (serverTime: number) =>
  json(200, `{"serverTime":${String(serverTime)}}`);
