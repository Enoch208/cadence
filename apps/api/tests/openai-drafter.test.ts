import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  DraftingDeclinedError,
  DraftingUnavailableError,
  type Setup,
} from "../src/drafting/contract";
import { createOpenAiDrafter } from "../src/drafting/openai";

const setup: Setup = {
  isTradeSetup: true,
  market: { value: "BTC-USD", quote: "BTC long" },
  direction: { value: "long", quote: "BTC long" },
  entryMin: { value: "84000", quote: "Entry 84,000" },
  entryMax: { value: "84000", quote: "Entry 84,000" },
  stopPrice: { value: "83200", quote: "SL 83,200" },
  targetPrice: null,
  entryWindowMinutes: null,
  rationale: null,
};

const request = {
  text: "BTC long. Entry 84,000, SL 83,200",
  markets: ["BTC-USD", "ETH-USD"],
  now: "2026-10-22T12:00:00Z",
};

type Answer = { status?: number; body: unknown } | Error;

const textPart = (text: string) => ({ type: "output_text", text, annotations: [] });

function response(overrides: Record<string, unknown> = {}, content: unknown[] = []) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1792670400,
    status: "completed",
    model: "gpt-6.1-sol",
    incomplete_details: null,
    output: [
      { type: "reasoning", id: "rs_test", summary: [] },
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: content.length > 0 ? content : [textPart(JSON.stringify(setup))],
      },
    ],
    usage: { input_tokens: 400, output_tokens: 120, total_tokens: 520 },
    ...overrides,
  };
}

function drafterAnswering(answer: Answer) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    sent.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "null") as Record<
        string,
        unknown
      >,
    });
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const client = new OpenAI({ apiKey: "sk-test", fetch, maxRetries: 0 });
  return { drafter: createOpenAiDrafter(client), sent };
}

describe("reading a setup with OpenAI", () => {
  it("asks GPT-6.1 Sol for the strict schema at low effort, unstored, and returns what it read", async () => {
    const { drafter, sent } = drafterAnswering({ body: response() });
    expect(await drafter.read(request)).toEqual({ setup, model: "gpt-6.1-sol" });
    const [call] = sent;
    expect(call?.url).toBe("https://api.openai.com/v1/responses");
    expect(call?.headers.get("authorization")).toBe("Bearer sk-test");
    expect(call?.body).toMatchObject({
      model: "gpt-6.1-sol",
      reasoning: { effort: "low" },
      store: false,
      text: { format: { type: "json_schema", name: "trade_setup", strict: true } },
    });
    expect(call?.body).not.toHaveProperty("temperature");
    expect(String(call?.body.instructions)).toContain("character for character");
    expect(call?.body.input).toBe(
      "Strike markets: BTC-USD, ETH-USD\nCurrent time: 2026-10-22T12:00:00Z\n\n<message>\nBTC long. Entry 84,000, SL 83,200\n</message>",
    );
  });

  it("reports the model snapshot that answered", async () => {
    const { drafter } = drafterAnswering({ body: response({ model: "gpt-6.1-sol-2026-10-01" }) });
    expect((await drafter.read(request)).model).toBe("gpt-6.1-sol-2026-10-01");
  });

  it.each([
    ["a refusal", response({}, [{ type: "refusal", refusal: "I can't help with that." }])],
    [
      "a content filter stop",
      response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }),
    ],
  ])("reports %s as declined, without reading the content", async (_, body) => {
    const { drafter } = drafterAnswering({ body });
    await expect(drafter.read(request)).rejects.toBeInstanceOf(DraftingDeclinedError);
  });

  it.each([
    [
      "it ran out of output tokens",
      {
        body: response({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      },
    ],
    ["it failed", { body: response({ status: "failed" }) }],
    [
      "its answer does not match the schema",
      { body: response({}, [textPart('{"isTradeSetup":"yes"}')]) },
    ],
    ["its answer is not JSON", { body: response({}, [textPart("Sure!")]) }],
    [
      "the API is rate limited",
      { status: 429, body: { error: { message: "Rate limit", type: "rate_limit_error" } } },
    ],
    [
      "the key is refused",
      { status: 401, body: { error: { message: "Bad key", type: "invalid_request_error" } } },
    ],
    ["the network fails", new TypeError("fetch failed")],
  ])("is unavailable when %s", async (_, answer: Answer) => {
    const { drafter } = drafterAnswering(answer);
    await expect(drafter.read(request)).rejects.toBeInstanceOf(DraftingUnavailableError);
  });
});
