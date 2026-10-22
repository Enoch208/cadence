import OpenAI from "openai";
import { createOpenAiDrafter, draftingModel } from "../src/drafting/openai";
import { verifySetup, type VerifiedDraft } from "../src/drafting/verify";
import { draftingCases, type DraftingCase } from "./drafting-cases";

const markets = ["BTC-USD", "ETH-USD"];

const line = (text: string) => process.stdout.write(`${text}\n`);
const instant = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
const closesAfter = (now: number, minutes: number) =>
  instant(Math.floor((now + minutes * 60_000) / 60_000) * 60_000);

function mismatches(
  expected: NonNullable<DraftingCase["setup"]>,
  draft: VerifiedDraft,
  now: number,
): string[] {
  const wanted = {
    ...expected.fields,
    entryExpiresAt:
      expected.windowMinutes === null ? null : closesAfter(now, expected.windowMinutes),
  };
  const found = Object.entries(wanted).flatMap(([key, value]) => {
    const actual = draft.filled[key as keyof typeof wanted]?.value ?? null;
    return actual === value ? [] : [`${key}: wanted ${String(value)}, got ${String(actual)}`];
  });
  const rationale = draft.filled.rationale?.value ?? null;
  const rationaleFits =
    expected.rationaleIncludes === null
      ? rationale === null
      : rationale?.includes(expected.rationaleIncludes) === true;
  return rationaleFits ? found : [...found, `rationale: got ${String(rationale)}`];
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    process.stderr.write("Set OPENAI_API_KEY in apps/api/.env to run the drafting check.\n");
    process.exit(1);
  }
  const drafter = createOpenAiDrafter(new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 }));
  line(`Drafting check: ${String(draftingCases.length)} messages, ${draftingModel}, effort low`);
  const timings: number[] = [];
  let passed = 0;
  for (const testCase of draftingCases) {
    const now = Date.now();
    const started = performance.now();
    const read = await drafter.read({ text: testCase.text, markets, now: instant(now) });
    const elapsed = Math.round(performance.now() - started);
    timings.push(elapsed);
    const problems =
      testCase.setup === null
        ? read.setup.isTradeSetup
          ? ["read as a trade setup"]
          : []
        : mismatches(
            testCase.setup,
            verifySetup(read.setup, { text: testCase.text, markets, now }),
            now,
          );
    passed += problems.length === 0 ? 1 : 0;
    line(
      `${problems.length === 0 ? "PASS" : "FAIL"}  ${String(elapsed).padStart(6)} ms  ${read.model}  ${testCase.name}`,
    );
    problems.forEach((problem) => {
      line(`      ${problem}`);
    });
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  line(
    `${String(passed)} of ${String(draftingCases.length)} passed. Median ${String(median)} ms, slowest ${String(sorted.at(-1) ?? 0)} ms.`,
  );
  process.exit(passed === draftingCases.length ? 0 : 1);
}

void main();
