import type { Message } from "@earendil-works/pi-ai";
import { estimateConservativeTokens } from "./budget.js";

/** Keep an assistant tool-call message with its immediately following tool results. */
export function groupToolExchanges(messages: readonly Message[]): Message[][] {
  const groups: Message[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const group = [message];
    if (message.role === "assistant" && message.content.some(block => block.type === "toolCall")) {
      while (messages[index + 1]?.role === "toolResult") {
        index++;
        group.push(messages[index]);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Keeps chronological message or tool-exchange boundaries intact. A single oversized part is
 * surfaced to the caller instead of being text-truncated.
 */
export function chunkChronologicalParts(parts: readonly string[], maxInputTokens: number, overlapPercent = 0): string[][] {
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0) {
    throw new Error("Chunk input budget must be a positive safe integer.");
  }
  if (!Number.isFinite(overlapPercent) || overlapPercent < 0 || overlapPercent >= 100) {
    throw new Error("Chunk overlap must be a percentage from 0 up to 100.");
  }
  const chunks: string[][] = [];
  let start = 0;
  while (start < parts.length) {
    let end = start;
    let currentText = "";
    while (end < parts.length) {
      const candidateText = currentText ? `${currentText}\n${parts[end]}` : parts[end];
      const candidateTokens = estimateConservativeTokens(candidateText);
      if (candidateTokens > maxInputTokens && end === start) {
        throw new Error("A single chronological message exceeds the safe chunk input budget.");
      }
      if (candidateTokens > maxInputTokens) break;
      currentText = candidateText;
      end++;
    }
    chunks.push(parts.slice(start, end));
    if (end >= parts.length) break;

    const overlapBudget = Math.floor(maxInputTokens * overlapPercent / 100);
    let overlapStart = end;
    for (let index = end - 1; index > start; index--) {
      const overlapTokens = estimateConservativeTokens(parts.slice(index, end).join("\n"));
      if (overlapTokens > overlapBudget) break;
      overlapStart = index;
    }
    start = overlapStart > start ? overlapStart : end;
  }
  return chunks;
}
