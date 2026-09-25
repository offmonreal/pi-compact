import assert from "node:assert/strict";
import test from "node:test";
import { assertFitsSummarizerBudget, assertSupportsOutputProfile, estimateConservativeTokens, getSafeInputTokenBudget } from "../src/budget.js";

test("uses a conservative character-to-token estimate", () => {
  assert.equal(estimateConservativeTokens("abcde"), 3);
});

test("admits a request only when prompt, requested output, and margin fit", () => {
  assert.doesNotThrow(() => assertFitsSummarizerBudget("a".repeat(1000), 20000, 4000));
  assert.throws(
    () => assertFitsSummarizerBudget("a".repeat(30000), 20000, 4000),
    /exceeds safe budget/
  );
});

test("rejects a model whose context window is unknown", () => {
  assert.throws(() => assertFitsSummarizerBudget("short", 0, 1000), /no valid contextWindow/);
});

test("reserves output, margin, and fixed prompt before chunking", () => {
  assert.equal(getSafeInputTokenBudget(10000, 1000, "abcd"), 6950);
});

test("rejects an output profile that a small summarizer cannot reduce", () => {
  assert.throws(() => assertSupportsOutputProfile(32000, 32000, 16000, 32000), /too small/);
  assert.doesNotThrow(() => assertSupportsOutputProfile(200000, 32000, 16000, 32000));
});
