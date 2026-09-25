import assert from "node:assert/strict";
import test from "node:test";
import { cleanRejectedToolExchanges, removeRejectedToolExchanges } from "../src/cleanup.js";

test("removes an errored tool result and only its matching tool call", () => {
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Trying two calls." },
        { type: "toolCall", id: "bad", name: "read", arguments: {} },
        { type: "toolCall", id: "good", name: "pwd", arguments: {} }
      ]
    },
    { role: "toolResult", toolCallId: "bad", toolName: "read", content: [{ type: "text", text: "error" }], isError: true },
    { role: "toolResult", toolCallId: "good", toolName: "pwd", content: [{ type: "text", text: "/tmp" }], isError: false }
  ] as any[];
  const cleaned = removeRejectedToolExchanges(messages);
  assert.equal(cleaned.length, 2);
  assert.deepEqual((cleaned[0] as any).content.map((block: any) => block.id ?? block.text), ["Trying two calls.", "good"]);
  assert.equal((cleaned[1] as any).toolCallId, "good");
  const report = cleanRejectedToolExchanges(messages);
  assert.equal(report.rejectedResults, 1);
  assert.equal(report.rejectedToolCalls, 1);
});

test("recognizes the FAIL marker at the start of a tool result", () => {
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "failed", name: "write", arguments: {} }] },
    { role: "toolResult", toolCallId: "failed", toolName: "write", content: [{ type: "text", text: "  FAIL. validation rejected" }], isError: false }
  ] as any[];
  assert.deepEqual(removeRejectedToolExchanges(messages), []);
});
