import assert from "node:assert/strict";
import test from "node:test";
import { parseModelReference, resolveConfig } from "../src/config.js";

test("parses provider/model with slashes in the model id", () => {
  assert.deepEqual(parseModelReference("cloud/vendor/model"), { provider: "cloud", modelId: "vendor/model" });
  assert.equal(parseModelReference("missing"), null);
});

test("project config overrides global fields", () => {
  const messages: string[] = [];
  const config = resolveConfig(
    { piCompact: { model: "global/a", finalMaxTokens: 9000 } },
    { piCompact: { model: "project/b", prompt: "Keep paths." } },
    message => messages.push(message)
  );
  assert.deepEqual(messages, []);
  assert.equal(config?.model, "project/b");
  assert.equal(config?.finalMaxTokens, 9000);
  assert.equal(config?.prompt, "Keep paths.");
});

test("parses the chunk output limit", () => {
  const config = resolveConfig({ piCompact: { model: "p/m", chunks: { maxTokens: 3000 } } }, undefined, () => {});
  assert.equal(config?.chunkMaxTokens, 3000);
});

test("uses auto defaults for both thinking controls", () => {
  const config = resolveConfig({ piCompact: { model: "p/m" } }, undefined, () => {});
  assert.equal(config?.thinking, "auto");
  assert.equal(config?.thinkingLevel, "auto");
  assert.equal(config?.debug, false);
});

test("uses the agreed output, chunk, cache, and cleanup defaults", () => {
  const config = resolveConfig({ piCompact: { model: "p/m" } }, undefined, () => {});
  assert.equal(config?.finalMaxTokens, 32000);
  assert.equal(config?.chunkMaxTokens, 16000);
  assert.equal(config?.chunkOverlapPercent, 5);
  assert.deepEqual(config?.cache, { enabled: true, maxEntries: 300, persistence: true });
  assert.equal(config?.cleanupRejectedToolExchanges, true);
});

test("parses cleanup, cache, and overlap settings", () => {
  const config = resolveConfig({
    piCompact: {
      model: "p/m",
      debug: true,
      chunks: { overlapPercent: 12.5 },
      cache: { enabled: false, maxEntries: 42, persistence: false },
      cleanup: { rejectedToolExchanges: false }
    }
  }, undefined, () => {});
  assert.equal(config?.chunkOverlapPercent, 12.5);
  assert.equal(config?.debug, true);
  assert.deepEqual(config?.cache, { enabled: false, maxEntries: 42, persistence: false });
  assert.equal(config?.cleanupRejectedToolExchanges, false);
});

test("missing or invalid model blocks at runtime instead of silently selecting a model", () => {
  const messages: string[] = [];
  const config = resolveConfig({}, { piCompact: { model: "not-a-reference" } }, message => messages.push(message));
  assert.equal(config?.model, undefined);
  assert.equal(config?.modelFailurePolicy, "block");
  assert.equal(messages.length, 0);
});
