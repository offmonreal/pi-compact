import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinalSystemPrompt,
  buildMapPrompt,
  buildPrompt,
  buildReducePrompt,
  buildSystemPrompt,
  MAP_SYSTEM_PROMPT,
  REDUCE_SYSTEM_PROMPT
} from "../src/prompt.js";

test("final prompt retains the previous checkpoint and one-run focus", () => {
  const prompt = buildPrompt("old conversation", "previous checkpoint", "Preserve test logs.");
  assert.match(prompt, /<conversation>\nold conversation\n<\/conversation>/);
  assert.match(prompt, /<previous-summary>\nprevious checkpoint\n<\/previous-summary>/);
  assert.match(prompt, /Additional focus for this compaction:\nPreserve test logs\./);
});

test("all stage prompts share the durable checkpoint format", () => {
  for (const prompt of [buildSystemPrompt(""), MAP_SYSTEM_PROMPT, REDUCE_SYSTEM_PROMPT]) {
    for (const heading of ["### Goal", "### Constraints", "### Decisions", "### Progress", "### Failures", "### Next Steps", "### Artifacts", "### Access", "### Critical Context"]) {
      assert.match(prompt, new RegExp(heading.replaceAll("#", "\\#")));
    }
  }
});

test("map and reduce prompts retain chronology and project prompt is final-only", () => {
  assert.match(buildMapPrompt("first"), /first/);
  const prompt = buildReducePrompt("older", "newer");
  assert.match(prompt, /older/);
  assert.match(prompt, /newer/);
  assert.match(buildSystemPrompt("Preserve deployment state."), /Preserve deployment state\.$/);
  assert.match(buildFinalSystemPrompt("Preserve deployment state."), /Merge Step/);
  assert.doesNotMatch(MAP_SYSTEM_PROMPT, /Preserve deployment state/);
  assert.doesNotMatch(REDUCE_SYSTEM_PROMPT, /Preserve deployment state/);
});
