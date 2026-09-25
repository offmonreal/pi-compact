import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type DebugDetails = Record<string, unknown>;

export function debugLogPathForProject(cwd: string): string {
  return join(cwd, ".pi", "pi-compact-debug.jsonl");
}

/**
 * Debugging must not change the compaction result. Events are deliberately
 * metadata-only: callers must never pass conversation text, prompts, keys, or
 * generated summary text here.
 */
export async function appendDebugEvent(
  cwd: string,
  runId: string,
  event: string,
  details: DebugDetails
): Promise<void> {
  const filePath = debugLogPathForProject(cwd);
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    runId,
    event,
    ...details
  });
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await appendFile(filePath, `${record}\n`, "utf8");
  } catch {
    // Debugging is optional: never make a successful compaction fail because a
    // project directory is read-only or its diagnostic file cannot be written.
    console.warn("[pi-compact] DEBUG LOGGING UNAVAILABLE: could not write .pi/pi-compact-debug.jsonl.");
  }
}
