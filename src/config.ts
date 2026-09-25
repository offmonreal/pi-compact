export const THINKING_MODES = ["auto", "on", "off"] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];
export const THINKING_LEVELS = ["auto", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ModelFailurePolicy = "block" | "session-model";

export type PiCompactConfig = {
  enabled: boolean;
  debug: boolean;
  model?: string;
  modelFailurePolicy: ModelFailurePolicy;
  thinking: ThinkingMode;
  thinkingLevel: ThinkingLevel;
  finalMaxTokens: number;
  chunkMaxTokens: number;
  chunkOverlapPercent: number;
  cache: {
    enabled: boolean;
    maxEntries: number;
    persistence: boolean;
  };
  cleanupRejectedToolExchanges: boolean;
  prompt: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(value: unknown): unknown {
  return isRecord(value) ? value.piCompact : undefined;
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 100;
}

export function parseModelReference(value: string): { provider: string; modelId: string } | null {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  const provider = value.slice(0, separator).trim();
  const modelId = value.slice(separator + 1).trim();
  return provider && modelId ? { provider, modelId } : null;
}

/** Global and trusted project config are shallow-merged, project values win. */
export function resolveConfig(globalSettings: unknown, projectSettings: unknown, warn: (message: string) => void): PiCompactConfig | null {
  const globalSection = section(globalSettings);
  const projectSection = section(projectSettings);
  if (projectSection === false || (globalSection === false && projectSection === undefined)) return null;

  const raw: UnknownRecord = {
    ...(isRecord(globalSection) ? globalSection : {}),
    ...(isRecord(projectSection) ? projectSection : {})
  };
  if (raw.enabled === false) return null;
  const debug = raw.debug === undefined ? false : raw.debug;
  if (typeof debug !== "boolean") {
    warn("piCompact.debug must be true or false; using false.");
  }
  const model = typeof raw.model === "string" && parseModelReference(raw.model) ? raw.model.trim() : undefined;
  const modelFailurePolicy = raw.modelFailurePolicy === undefined ? "block" : raw.modelFailurePolicy;
  if (modelFailurePolicy !== "block" && modelFailurePolicy !== "session-model") {
    warn("piCompact.modelFailurePolicy must be block or session-model; using block.");
  }

  const thinking = raw.thinking === undefined ? "auto" : raw.thinking;
  if (typeof thinking !== "string" || !(THINKING_MODES as readonly string[]).includes(thinking)) {
    warn("piCompact.thinking must be auto, on, or off; using auto.");
  }
  const thinkingLevel = raw.thinkingLevel === undefined ? "auto" : raw.thinkingLevel;
  if (typeof thinkingLevel !== "string" || !(THINKING_LEVELS as readonly string[]).includes(thinkingLevel)) {
    warn("Invalid piCompact.thinkingLevel; using auto.");
  }

  const finalMaxTokens = raw.finalMaxTokens === undefined ? 32000 : raw.finalMaxTokens;
  if (!validPositiveInteger(finalMaxTokens)) {
    warn("piCompact.finalMaxTokens must be a positive safe integer; using 32000.");
  }
  const chunks = isRecord(raw.chunks) ? raw.chunks : {};
  if (raw.chunks !== undefined && !isRecord(raw.chunks)) {
    warn("piCompact.chunks must be an object; using default chunk settings.");
  }
  const chunkMaxTokens = chunks.maxTokens === undefined ? 16000 : chunks.maxTokens;
  if (!validPositiveInteger(chunkMaxTokens)) {
    warn("piCompact.chunks.maxTokens must be a positive safe integer; using 16000.");
  }
  const chunkOverlapPercent = chunks.overlapPercent === undefined ? 5 : chunks.overlapPercent;
  if (!validPercentage(chunkOverlapPercent)) {
    warn("piCompact.chunks.overlapPercent must be a number from 0 up to 100; using 5.");
  }

  const cache = isRecord(raw.cache) ? raw.cache : {};
  if (raw.cache !== undefined && !isRecord(raw.cache)) {
    warn("piCompact.cache must be an object; using default cache settings.");
  }
  const cacheEnabled = cache.enabled === undefined ? true : cache.enabled;
  if (typeof cacheEnabled !== "boolean") {
    warn("piCompact.cache.enabled must be true or false; using true.");
  }
  const cacheMaxEntries = cache.maxEntries === undefined ? 300 : cache.maxEntries;
  if (!validPositiveInteger(cacheMaxEntries)) {
    warn("piCompact.cache.maxEntries must be a positive safe integer; using 300.");
  }
  const cachePersistence = cache.persistence === undefined ? true : cache.persistence;
  if (typeof cachePersistence !== "boolean") {
    warn("piCompact.cache.persistence must be true or false; using true.");
  }

  const cleanup = isRecord(raw.cleanup) ? raw.cleanup : {};
  if (raw.cleanup !== undefined && !isRecord(raw.cleanup)) {
    warn("piCompact.cleanup must be an object; using default cleanup settings.");
  }
  const cleanupRejectedToolExchanges = cleanup.rejectedToolExchanges === undefined ? true : cleanup.rejectedToolExchanges;
  if (typeof cleanupRejectedToolExchanges !== "boolean") {
    warn("piCompact.cleanup.rejectedToolExchanges must be true or false; using true.");
  }
  const prompt = raw.prompt === undefined ? "" : raw.prompt;
  if (typeof prompt !== "string") {
    warn("piCompact.prompt must be a string; omitting it.");
  }

  return {
    enabled: true,
    debug: typeof debug === "boolean" ? debug : false,
    model,
    modelFailurePolicy: modelFailurePolicy === "session-model" ? "session-model" : "block",
    thinking: thinking === "on" || thinking === "off" ? thinking : "auto",
    thinkingLevel: (THINKING_LEVELS as readonly string[]).includes(thinkingLevel as string) ? thinkingLevel as ThinkingLevel : "auto",
    finalMaxTokens: validPositiveInteger(finalMaxTokens) ? finalMaxTokens : 32000,
    chunkMaxTokens: validPositiveInteger(chunkMaxTokens) ? chunkMaxTokens : 16000,
    chunkOverlapPercent: validPercentage(chunkOverlapPercent) ? chunkOverlapPercent : 5,
    cache: {
      enabled: typeof cacheEnabled === "boolean" ? cacheEnabled : true,
      maxEntries: validPositiveInteger(cacheMaxEntries) ? cacheMaxEntries : 300,
      persistence: typeof cachePersistence === "boolean" ? cachePersistence : true
    },
    cleanupRejectedToolExchanges: typeof cleanupRejectedToolExchanges === "boolean" ? cleanupRejectedToolExchanges : true,
    prompt: typeof prompt === "string" ? prompt.trim() : ""
  };
}
