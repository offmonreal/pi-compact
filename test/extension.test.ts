import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
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

function failureHarness(t: TestContext, policy: "block" | "session-model", options: {
  dedicatedAvailable?: boolean;
  hasUI?: boolean;
  failFallback?: boolean;
  primaryReturnsError?: boolean;
} = {}) {
  t.mock.method(SettingsManager, "create", () => SettingsManager.inMemory({
    piCompact: { model: "test/summarizer", modelFailurePolicy: policy, cache: { enabled: false } }
  } as any));
  const warnings = t.mock.method(console, "warn", () => {});
  const notify = t.mock.fn((_message: string, _type?: string) => {});
  let compact: any;
  piCompact({ on: (event: string, handler: any) => {
    if (event === "session_before_compact") compact = handler;
  } } as ExtensionAPI);

  const summarizer = { provider: "test", id: "summarizer", contextWindow: 200000, maxTokens: 32000, reasoning: false };
  const session = { ...summarizer, id: "session-model" };
  const calls: string[] = [];
  const run = () => compact({
    preparation: {
      messagesToSummarize: [{ role: "user", content: "Preserve the current task.", timestamp: 0 }],
      firstKeptEntryId: "retained-tail",
      tokensBefore: 1000
    },
    signal: new AbortController().signal,
    reason: "manual"
  }, {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    hasUI: options.hasUI ?? true,
    ui: { notify },
    model: session,
    modelRegistry: {
      find: () => options.dedicatedAvailable === false ? undefined : summarizer,
      complete: async (candidate: typeof session, context: any, request: any) => {
        assertFitsSummarizerBudget(
          `${context.systemPrompt}\n${context.messages[0].content[0].text}`,
          candidate.contextWindow,
          request.maxTokens
        );
        calls.push(candidate.id);
        if (candidate === summarizer && !options.primaryReturnsError) {
          throw new Error("Summarizer unavailable: HTTP 503.");
        }
        const error = candidate === summarizer
          ? "Summarizer unavailable: HTTP 503."
          : options.failFallback ? "Session model unavailable: HTTP 502." : undefined;
        return {
          content: error ? [] : [{ type: "text", text: "Complete checkpoint." }],
          stopReason: error ? "error" : "stop",
          errorMessage: error,
          usage: { input: 100, output: 10, totalTokens: 110 }
        };
      }
    }
  });
  return { run, calls, warnings, notify };
}

test("reports the failure reason and disabled fallback in one UI notification", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "block");
  assert.deepEqual(await run(), { cancel: true });
  assert.deepEqual(calls, ["summarizer"]);
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(notify.mock.callCount(), 1);
  const [message, type] = notify.mock.calls[0].arguments;
  assert.equal(type, "error");
  assert.match(message, /Summarizer test\/summarizer failed/);
  assert.match(message, /Reason: Summarizer unavailable: HTTP 503/);
  assert.match(message, /Fallback to the session model is disabled/);
  assert.match(message, /Session history was not changed/);
  assert.ok(message.split("\n").length >= 4);
  assert.equal(message.match(/\[pi-compact\]/g)?.length, 1);
});

test("falls back silently when the summarizer request throws", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "session-model");
  const result = await run();
  assert.equal(result.compaction.details.model, "test/session-model");
  assert.equal(result.compaction.details.mode, "map-reduce");
  assert.deepEqual(calls, ["summarizer", "session-model", "session-model"]);
  assert.equal(notify.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 0);
});

test("falls back silently when the summarizer returns a provider error", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "session-model", { primaryReturnsError: true });
  assert.equal((await run()).compaction.details.model, "test/session-model");
  assert.deepEqual(calls, ["summarizer", "session-model", "session-model"]);
  assert.equal(notify.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 0);
});

test("uses the session model silently when the dedicated model is missing", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "session-model", { dedicatedAvailable: false });
  assert.equal((await run()).compaction.details.model, "test/session-model");
  assert.deepEqual(calls, ["session-model", "session-model"]);
  assert.equal(notify.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 0);
});

test("reports both causes once if the summarizer and fallback both fail", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "session-model", { failFallback: true });
  assert.deepEqual(await run(), { cancel: true });
  assert.deepEqual(calls, ["summarizer", "session-model"]);
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(notify.mock.callCount(), 1);
  const [message] = notify.mock.calls[0].arguments;
  assert.match(message, /Session model test\/session-model failed/);
  assert.match(message, /HTTP 502/);
  assert.match(message, /HTTP 503/);
  assert.doesNotMatch(message, /fallback.*disabled/i);
});

test("explains that a missing summarizer cannot be replaced when fallback is disabled", async t => {
  const { run, calls, warnings, notify } = failureHarness(t, "block", { dedicatedAvailable: false });
  assert.deepEqual(await run(), { cancel: true });
  assert.deepEqual(calls, []);
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(notify.mock.callCount(), 1);
  const [message] = notify.mock.calls[0].arguments;
  assert.match(message, /summarizer model test\/summarizer is unavailable/);
  assert.match(message, /Fallback to the session model is disabled/);
});

test("reports a single plain message without a stack trace when no UI is available", async t => {
  const { run, warnings, notify } = failureHarness(t, "block", { hasUI: false });
  assert.deepEqual(await run(), { cancel: true });
  assert.equal(notify.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 1);
  const args = warnings.mock.calls[0].arguments;
  assert.equal(args.length, 1);
  assert.match(String(args[0]), /Fallback to the session model is disabled/);
});
