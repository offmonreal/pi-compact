import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendDebugEvent, debugLogPathForProject } from "../src/debug-log.js";

test("writes metadata-only debug events as JSONL in the project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-compact-debug-"));
  await appendDebugEvent(directory, "run-1", "request-complete", {
    stage: "map",
    inputTokens: 42
  });
  const lines = (await readFile(debugLogPathForProject(directory), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.runId, "run-1");
  assert.equal(record.event, "request-complete");
  assert.equal(record.stage, "map");
  assert.equal(record.inputTokens, 42);
  assert.equal(typeof record.timestamp, "string");
});
