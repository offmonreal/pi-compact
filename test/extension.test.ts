import assert from "node:assert/strict";
import test from "node:test";
import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piCompact from "../extensions/pi-compact.js";
import { assertFitsSummarizerBudget } from "../src/budget.js";

test("splits history that fits with chunk output but not with final output reserved", async t => {
  t.mock.method(SettingsManager, "create", () => SettingsManager.inMemory({
    piCompact: { model: "test/summarizer", cache: { enabled: false } }
  } as any));
  const warnings = t.mock.method(console, "warn", () => {});
  let compact: any;
  piCompact({ on: (event: string, handler: any) => {
    if (event === "session_before_compact") compact = handler;
  } } as ExtensionAPI);

  const model = { provider: "test", id: "summarizer", contextWindow: 200000, maxTokens: 32000, reasoning: false };
  const requests: Array<{ prompt: string; maxTokens: number }> = [];
  const result = await compact({
    preparation: {
      messagesToSummarize: [
        { role: "user", content: "a".repeat(170000), timestamp: 0 },
        { role: "user", content: "b".repeat(170000), timestamp: 1 }
      ],
      firstKeptEntryId: "retained-tail",
      tokensBefore: 190000
    },
    signal: new AbortController().signal,
    reason: "manual"
  }, {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    model,
    modelRegistry: {
      find: () => model,
      complete: async (_model: unknown, context: any, options: any) => {
        const prompt = context.messages[0].content[0].text;
        assertFitsSummarizerBudget(`${context.systemPrompt}\n${prompt}`, model.contextWindow, options.maxTokens);
        requests.push({ prompt, maxTokens: options.maxTokens });
        return {
          content: [{ type: "text", text: "Complete checkpoint." }],
          stopReason: "stop",
          usage: { input: 100, output: 10, totalTokens: 110 }
        };
      }
    }
  });

  assert.equal(result?.compaction?.details.mode, "map-reduce");
  assert.equal(result.compaction.details.mapChunks, 2);
  assert.equal(result.compaction.firstKeptEntryId, "retained-tail");
  assert.deepEqual(requests.map(request => request.maxTokens), [16000, 16000, 32000]);
  assert.ok(requests[0].prompt.includes("a".repeat(170000)));
  assert.ok(requests[1].prompt.includes("b".repeat(170000)));
  assert.equal(warnings.mock.callCount(), 0);
});
