import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type PromptKind = "system" | "map" | "reduce";

const promptDirectory = fileURLToPath(new URL("../prompts/compaction/", import.meta.url));
const cache = new Map<string, string>();

function loadPrompt(kind: PromptKind, includeSections = true): string {
  const key = includeSections ? kind : `${kind}:without-sections`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const body = readFileSync(`${promptDirectory}${kind}.md`, "utf8").trim();
  const sections = includeSections ? readFileSync(`${promptDirectory}sections.md`, "utf8").trim() : "";
  const prompt = body.replace("{{SECTIONS}}", sections).trim();
  cache.set(key, prompt);
  return prompt;
}

function joinPrompts(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).map(part => part.trim()).join("\n\n");
}

/** One-pass compaction and the final map-reduce checkpoint share the same durable base. */
export function buildSystemPrompt(projectPrompt: string): string {
  return joinPrompts(loadPrompt("system"), projectPrompt);
}

/** The final map-reduce call additionally needs the rules for merging checkpoints. */
export function buildFinalSystemPrompt(projectPrompt: string): string {
  return joinPrompts(buildSystemPrompt(projectPrompt), loadPrompt("reduce", false));
}

export const MAP_SYSTEM_PROMPT = loadPrompt("map");
export const REDUCE_SYSTEM_PROMPT = loadPrompt("reduce");

export function buildPrompt(conversation: string, previousSummary: string | undefined, manualFocus = ""): string {
  const previous = previousSummary ? `\n<previous-summary>\n${previousSummary}\n</previous-summary>\n` : "";
  const additional = manualFocus.trim() ? `\nAdditional focus for this compaction:\n${manualFocus.trim()}\n` : "";
  return `<conversation>\n${conversation}\n</conversation>${previous}${additional}\nCreate the checkpoint now.`;
}

export function buildMapPrompt(conversationPart: string): string {
  return `<conversation-part>\n${conversationPart}\n</conversation-part>\n\nExtract the checkpoint for this part now.`;
}

export function buildReducePrompt(left: string, right: string): string {
  return `--- part 1 ---\n${left}\n\n--- part 2 ---\n${right}\n\nMerge these consecutive checkpoints now.`;
}
