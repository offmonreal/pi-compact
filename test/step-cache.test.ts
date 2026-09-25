import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheKey, StepCache } from "../src/step-cache.js";

test("cache key changes when the model or prompt changes", () => {
  const base = { model: "p/a", systemPrompt: "system", prompt: "input", maxTokens: 10 };
  assert.notEqual(cacheKey(base), cacheKey({ ...base, model: "p/b" }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, prompt: "different" }));
});

test("persistent cache retains its newest bounded entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-compact-cache-"));
  const filePath = join(directory, "cache.json");
  const cache = new StepCache(filePath, 2, true);
  await cache.put("one", "first");
  await cache.put("two", "second");
  await cache.put("three", "third");
  assert.equal(await cache.get("one"), undefined);
  assert.equal(await cache.get("three"), "third");
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.deepEqual(saved.entries.map((entry: string[]) => entry[0]), ["two", "three"]);
  const restored = new StepCache(filePath, 2, true);
  assert.equal(await restored.get("two"), "second");
});
