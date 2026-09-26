import assert from "node:assert/strict";
import test from "node:test";
import { chunkChronologicalParts, groupToolExchanges } from "../src/chunks.js";

test("keeps chronological parts intact while splitting at the input budget", () => {
  assert.deepEqual(chunkChronologicalParts(["aaaa", "bbbb", "cccc"], 4), [["aaaa"], ["bbbb"], ["cccc"]]);
});

test("accounts for separators used to serialize each map chunk", () => {
  assert.deepEqual(chunkChronologicalParts(["aa", "bb"], 2), [["aa"], ["bb"]]);
});

test("rejects a single oversized chronological part", () => {
  assert.throws(() => chunkChronologicalParts(["123456789"], 4), /single chronological message/);
});

test("keeps a tool call and its results in one chronological group", () => {
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [], isError: false },
    { role: "user", content: "next" }
  ] as any[];
  assert.equal(groupToolExchanges(messages).length, 2);
  assert.equal(groupToolExchanges(messages)[0].length, 2);
});

test("repeats a bounded overlap at chunk boundaries", () => {
  assert.deepEqual(
    chunkChronologicalParts(["aaaa", "bbbb", "cccc"], 5, 50),
    [["aaaa", "bbbb"], ["bbbb", "cccc"]]
  );
});
