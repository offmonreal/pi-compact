import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type CacheFile = { version: 1; entries: Array<[string, string]> };

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}

export function cacheKey(parts: { model: string; systemPrompt: string; prompt: string; maxTokens: number }): string {
  const payload = JSON.stringify(parts);
  return `${hash(payload)}:${payload.length}`;
}

export class StepCache {
  private readonly entries = new Map<string, string>();
  private loaded = false;

  constructor(
    private readonly filePath: string,
    private readonly maxEntries: number,
    private readonly persistence: boolean
  ) {}

  async get(key: string): Promise<string | undefined> {
    await this.load();
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    if (!value.trim()) return;
    await this.load();
    this.entries.delete(key);
    this.entries.set(key, value);
    this.trim();
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persistence) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<CacheFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const entry of parsed.entries) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
          this.entries.set(entry[0], entry[1]);
        }
      }
      this.trim();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[pi-compact] could not read the step cache; continuing without cached entries.", error);
      }
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private async save(): Promise<void> {
    if (!this.persistence) return;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const document: CacheFile = { version: 1, entries: [...this.entries] };
      await writeFile(temporaryPath, JSON.stringify(document), "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      console.warn("[pi-compact] could not persist the step cache; continuing with the in-memory cache.", error);
    }
  }
}

export function cachePathForProject(cwd: string): string {
  return join(cwd, ".pi", "pi-compact-step-cache.json");
}

const caches = new Map<string, StepCache>();

/** Reuse the in-memory cache between compaction events; persistence controls only disk storage. */
export function getStepCache(cwd: string, maxEntries: number, persistence: boolean): StepCache {
  const filePath = cachePathForProject(cwd);
  const key = `${filePath}:${maxEntries}:${persistence}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = new StepCache(filePath, maxEntries, persistence);
    caches.set(key, cache);
  }
  return cache;
}
