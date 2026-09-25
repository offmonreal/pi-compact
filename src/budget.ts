const SAFETY_MARGIN_TOKENS = 2048;

/**
 * Pi's chars/4 estimator undercounts JSON-heavy tool traffic. chars/2 is deliberately
 * conservative for an admission check: a needless fallback is safer than a length stop.
 */
export function estimateConservativeTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export function assertFitsSummarizerBudget(inputText: string, contextWindow: number, maxOutputTokens: number): void {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error("Compaction model has no valid contextWindow; refusing an unbounded request.");
  }
  const required = estimateConservativeTokens(inputText) + maxOutputTokens + SAFETY_MARGIN_TOKENS;
  if (required > contextWindow) {
    throw new Error(`Compaction input exceeds safe budget: requires ${required} tokens, model contextWindow is ${contextWindow}.`);
  }
}

/** Maximum conservative token estimate available to variable request content. */
export function getSafeInputTokenBudget(contextWindow: number, maxOutputTokens: number, fixedPromptText: string): number {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error("Compaction model has no valid contextWindow; refusing an unbounded request.");
  }
  const budget = contextWindow - maxOutputTokens - SAFETY_MARGIN_TOKENS - estimateConservativeTokens(fixedPromptText);
  if (budget <= 0) {
    throw new Error("Compaction model leaves no safe input budget after output reservation and prompt overhead.");
  }
  return budget;
}

/** Reject a summarizer whose configured outputs cannot be merged inside its own window. */
export function assertSupportsOutputProfile(
  contextWindow: number,
  modelMaxTokens: number,
  chunkOutputTokens: number,
  finalOutputTokens: number
): void {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error("summarizer contextWindow is unknown.");
  }
  if (modelMaxTokens > 0 && (chunkOutputTokens > modelMaxTokens || finalOutputTokens > modelMaxTokens)) {
    throw new Error(`configured output exceeds summarizer maxTokens (${modelMaxTokens}).`);
  }
  const reduceRequired = 3 * chunkOutputTokens + SAFETY_MARGIN_TOKENS;
  const finalRequired = 2 * chunkOutputTokens + finalOutputTokens + SAFETY_MARGIN_TOKENS;
  if (Math.max(reduceRequired, finalRequired) > contextWindow) {
    throw new Error(
      `summarizer contextWindow (${contextWindow}) is too small for chunkOutputTokens=${chunkOutputTokens} and finalOutputTokens=${finalOutputTokens}.`
    );
  }
}
