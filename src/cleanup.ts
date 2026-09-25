import type { Message } from "@earendil-works/pi-ai";

export const TOOL_FAILURE_MARKER = "FAIL.";

export type RejectedToolExchangeCleanup = {
  messages: Message[];
  rejectedResults: number;
  rejectedToolCalls: number;
};

function toolResultText(message: Message): string {
  if (message.role !== "toolResult") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n");
}

function isRejectedToolResult(message: Message): message is Extract<Message, { role: "toolResult" }> {
  return message.role === "toolResult" && (
    message.isError || toolResultText(message).trimStart().startsWith(TOOL_FAILURE_MARKER)
  );
}

/**
 * Removes failed tool results and their matching assistant tool calls only from the material
 * sent to the summarizer. The original Pi session remains unchanged.
 */
export function cleanRejectedToolExchanges(messages: readonly Message[]): RejectedToolExchangeCleanup {
  const rejectedCallIds = new Set<string>();
  let rejectedResults = 0;
  for (const message of messages) {
    if (isRejectedToolResult(message)) {
      rejectedCallIds.add(message.toolCallId);
      rejectedResults++;
    }
  }

  const cleaned: Message[] = [];
  let rejectedToolCalls = 0;
  for (const message of messages) {
    if (isRejectedToolResult(message)) continue;
    if (message.role !== "assistant" || rejectedCallIds.size === 0) {
      cleaned.push(message);
      continue;
    }
    const content = message.content.filter(block => {
      const rejected = block.type === "toolCall" && rejectedCallIds.has(block.id);
      if (rejected) rejectedToolCalls++;
      return !rejected;
    });
    if (content.length > 0) cleaned.push({ ...message, content });
  }
  return { messages: cleaned, rejectedResults, rejectedToolCalls };
}

export function removeRejectedToolExchanges(messages: readonly Message[]): Message[] {
  return cleanRejectedToolExchanges(messages).messages;
}
