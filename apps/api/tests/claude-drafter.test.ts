import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createClaudeDrafter } from "../src/drafting/claude";
import {
  DraftingDeclinedError,
  DraftingUnavailableError,
  type Setup,
} from "../src/drafting/contract";

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

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "Reading the levels.", signature: "sig" },
      { type: "text", text: JSON.stringify(setup), citations: null },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 400, output_tokens: 120 },
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
  const client = new Anthropic({ apiKey: "sk-ant-test", fetch, maxRetries: 0 });
  return { drafter: createClaudeDrafter(client), sent };
}

describe("reading a setup with Claude", () => {
  it("asks Claude Opus 5.5 for the schema, with a fallback, and returns what it read", async () => {
    const { drafter, sent } = drafterAnswering({ body: message() });
    expect(await drafter.read(request)).toEqual({ setup, model: "claude-opus-5-5" });
    const [call] = sent;
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(call?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call?.body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(call?.body).not.toHaveProperty("thinking");
    const turn = JSON.stringify(call?.body.messages);
    expect(turn).toContain("BTC-USD, ETH-USD");
    expect(turn).toContain("2026-10-22T12:00:00Z");
    expect(turn).toContain("<message>\\nBTC long. Entry 84,000, SL 83,200\\n</message>");
  });

  it("reports the model that answered when a fallback took over", async () => {
    const { drafter } = drafterAnswering({ body: message({ model: "claude-opus-4-8" }) });
    expect((await drafter.read(request)).model).toBe("claude-opus-4-8");
  });

  it("reports a refusal as declined, without reading the content", async () => {
    const { drafter } = drafterAnswering({
      body: message({ stop_reason: "refusal", content: [] }),
    });
    await expect(drafter.read(request)).rejects.toBeInstanceOf(DraftingDeclinedError);
  });

  it.each([
    ["it stopped at the token limit", { body: message({ stop_reason: "max_tokens" }) }],
    [
      "its answer does not match the schema",
      { body: message({ content: [{ type: "text", text: '{"isTradeSetup":"yes"}' }] }) },
    ],
    ["its answer is not JSON", { body: message({ content: [{ type: "text", text: "Sure!" }] }) }],
    [
      "the API is overloaded",
      { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "x" } } },
    ],
    ["the network fails", new TypeError("fetch failed")],
  ])("is unavailable when %s", async (_, answer: Answer) => {
    const { drafter } = drafterAnswering(answer);
    await expect(drafter.read(request)).rejects.toBeInstanceOf(DraftingUnavailableError);
  });
});
