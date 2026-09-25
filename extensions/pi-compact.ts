import {
  convertToLlm,
  getAgentDir,
  serializeConversation,
  SettingsManager,
  type ExtensionAPI
} from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";
import {
  assertFitsSummarizerBudget,
  assertSupportsOutputProfile,
  estimateConservativeTokens,
  getSafeInputTokenBudget
} from "../src/budget.js";
import { chunkChronologicalParts, groupToolExchanges } from "../src/chunks.js";
import { cleanRejectedToolExchanges } from "../src/cleanup.js";
import { parseModelReference, resolveConfig } from "../src/config.js";
import { appendDebugEvent } from "../src/debug-log.js";
import { cacheKey, getStepCache } from "../src/step-cache.js";
import {
  buildMapPrompt,
  buildPrompt,
  buildReducePrompt,
  buildFinalSystemPrompt,
  buildSystemPrompt,
  MAP_SYSTEM_PROMPT,
  REDUCE_SYSTEM_PROMPT
} from "../src/prompt.js";

function warn(message: string, error?: unknown): void {
  if (error === undefined) console.warn(`[pi-compact] ${message}`);
  else console.warn(`[pi-compact] ${message}`, error);
}

async function debug(
  enabled: boolean,
  cwd: string,
  runId: string,
  event: string,
  details: Record<string, unknown>
): Promise<void> {
  if (enabled) await appendDebugEvent(cwd, runId, event, details);
}

function reasoningOption(candidate: { reasoning: boolean }, config: { thinking: string; thinkingLevel: string }): Record<string, unknown> {
  if (!candidate.reasoning) return {};
  if (config.thinkingLevel !== "auto") return { reasoning: config.thinkingLevel };
  if (config.thinking !== "auto") return { reasoning: config.thinking };
  return {};
}

export default function piCompact(pi: ExtensionAPI): void {
  let activeDebugRun: { cwd: string; runId: string; enabled: boolean } | undefined;

  pi.on("session_compact", async event => {
    if (!activeDebugRun?.enabled) return;
    await debug(activeDebugRun.enabled, activeDebugRun.cwd, activeDebugRun.runId, "pi-compaction-saved", {
      reason: event.reason,
      fromExtension: event.fromExtension,
      implementation: (event.compactionEntry.details as { implementation?: unknown } | undefined)?.implementation ?? null,
      summaryCharacters: event.compactionEntry.summary.length
    });
    activeDebugRun = undefined;
  });

  pi.on("session_compact_failed", async event => {
    if (!activeDebugRun?.enabled) return;
    await debug(activeDebugRun.enabled, activeDebugRun.cwd, activeDebugRun.runId, "pi-compaction-not-saved", {
      reason: event.reason,
      fromExtension: event.fromExtension,
      aborted: event.aborted,
      error: event.errorMessage ?? null
    });
    activeDebugRun = undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted()
    });
    const config = resolveConfig(
      settings.getGlobalSettings(),
      ctx.isProjectTrusted() ? settings.getProjectSettings() : undefined,
      warn
    );
    if (!config) return;
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    activeDebugRun = { cwd: ctx.cwd, runId, enabled: config.debug };

    await debug(config.debug, ctx.cwd, runId, "compaction-start", {
      reason: event.reason,
      willRetry: event.willRetry,
      configuredModel: config.model ?? null,
      modelFailurePolicy: config.modelFailurePolicy,
      finalMaxTokens: config.finalMaxTokens,
      chunkMaxTokens: config.chunkMaxTokens,
      chunkOverlapPercent: config.chunkOverlapPercent,
      cacheEnabled: config.cache.enabled
    });

    const reference = config.model ? parseModelReference(config.model) : null;
    const primary = reference ? ctx.modelRegistry.find(reference.provider, reference.modelId) : undefined;
    const active = ctx.model;
    const unavailableReason = config.model
      ? `summarizer model ${config.model} is unavailable.`
      : "summarizer model is not configured.";
    if (!primary) warn(`[pi-compact] CONFIGURATION ERROR: ${unavailableReason} modelFailurePolicy=${config.modelFailurePolicy}.`);
    const model = primary ?? (config.modelFailurePolicy === "session-model" ? active : undefined);
    // A session-model fallback must preserve room for the session model to produce a
    // durable result. Never ask it to read the entire source history and produce the
    // final checkpoint in the same request: use at least map -> final instead.
    const forceMapReduceForSessionFallback = !primary && model === active;
    await debug(config.debug, ctx.cwd, runId, "model-resolution", {
      dedicatedModelFound: Boolean(primary),
      activeSessionModel: active ? `${active.provider}/${active.id}` : null,
      selectedModel: model ? `${model.provider}/${model.id}` : null,
      selectedSessionFallback: forceMapReduceForSessionFallback,
      forceMapReduce: forceMapReduceForSessionFallback
    });
    if (!model) {
      warn(`[pi-compact] COMPACTION BLOCKED: ${unavailableReason} Configure piCompact.model or set modelFailurePolicy=session-model.`);
      return { cancel: true };
    }

    const originalLlmMessages = convertToLlm(event.preparation.messagesToSummarize);
    const cleanup = config.cleanupRejectedToolExchanges
      ? cleanRejectedToolExchanges(originalLlmMessages)
      : { messages: originalLlmMessages, rejectedResults: 0, rejectedToolCalls: 0 };
    const llmMessages = cleanup.messages;
    const conversation = serializeConversation(llmMessages);
    await debug(config.debug, ctx.cwd, runId, "compaction-input", {
      originalMessageCount: originalLlmMessages.length,
      summarizerMessageCount: llmMessages.length,
      rejectedResultsRemoved: cleanup.rejectedResults,
      rejectedToolCallsRemoved: cleanup.rejectedToolCalls,
      estimatedInputTokens: estimateConservativeTokens(conversation),
      hasPreviousSummary: Boolean(event.preparation.previousSummary),
      hasManualFocus: Boolean(event.customInstructions?.trim())
    });
    const stepCache = config.cache.enabled
      ? getStepCache(ctx.cwd, config.cache.maxEntries, config.cache.persistence)
      : undefined;
    const projectPrompt = config.prompt;
    const manualFocus = event.customInstructions?.trim() ?? "";

    const compactWith = async (candidate: typeof model, forceMapReduce = false) => {
      assertSupportsOutputProfile(candidate.contextWindow, candidate.maxTokens, config.chunkMaxTokens, config.finalMaxTokens);
      const request = async (
        stage: "one-pass" | "map" | "reduce" | "final",
        systemPrompt: string,
        prompt: string,
        requestedMaxTokens: number,
        cacheable = false
      ) => {
        const maxTokens = requestedMaxTokens;
        assertFitsSummarizerBudget(`${systemPrompt}\n${prompt}`, candidate.contextWindow, maxTokens);
        const key = cacheable ? cacheKey({
          model: `${candidate.provider}/${candidate.id}`,
          systemPrompt,
          prompt,
          maxTokens
        }) : undefined;
        const cached = key ? await stepCache?.get(key) : undefined;
        if (cached) {
          await debug(config.debug, ctx.cwd, runId, "request-cache-hit", {
            stage,
            model: `${candidate.provider}/${candidate.id}`,
            requestedMaxTokens: maxTokens,
            estimatedInputTokens: estimateConservativeTokens(`${systemPrompt}\n${prompt}`)
          });
          return { summary: cached, usage: undefined, cached: true };
        }
        await debug(config.debug, ctx.cwd, runId, "request-start", {
          stage,
          model: `${candidate.provider}/${candidate.id}`,
          contextWindow: candidate.contextWindow,
          requestedMaxTokens: maxTokens,
          estimatedInputTokens: estimateConservativeTokens(`${systemPrompt}\n${prompt}`)
        });
        const response = await ctx.modelRegistry.complete(candidate, {
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }]
        }, {
          maxTokens,
          signal: event.signal,
          cacheRetention: "none",
          ...reasoningOption(candidate, config)
        });
        if (response.stopReason === "length") throw new Error("Summary reached its output token limit.");
        if (response.stopReason === "error") throw new Error(response.errorMessage || "Compaction model returned an error.");
        if (response.content.some(block => block.type === "toolCall")) throw new Error("Compaction model attempted a tool call.");
        const summary = contentText(response.content).trim();
        if (!summary) throw new Error("Compaction model returned an empty summary.");
        if (key) await stepCache?.put(key, summary);
        await debug(config.debug, ctx.cwd, runId, "request-complete", {
          stage,
          model: `${candidate.provider}/${candidate.id}`,
          summaryCharacters: summary.length,
          inputTokens: response.usage.input,
          outputTokens: response.usage.output,
          totalTokens: response.usage.totalTokens,
          cached: false
        });
        return { summary, usage: response.usage, cached: false };
      };

      const onePassSystemPrompt = buildSystemPrompt(projectPrompt);
      const finalSystemPrompt = buildFinalSystemPrompt(projectPrompt);
      const finalPrompt = buildPrompt(conversation, event.preparation.previousSummary, manualFocus);
      if (!forceMapReduce) {
        try {
          assertFitsSummarizerBudget(`${onePassSystemPrompt}\n${finalPrompt}`, candidate.contextWindow, config.finalMaxTokens);
          const result = await request("one-pass", onePassSystemPrompt, finalPrompt, config.finalMaxTokens);
          return { ...result, mode: "one-pass", mapChunks: 0, reduceSteps: 0 };
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("Compaction input exceeds safe budget")) throw error;
        }
      }

      const chunkOutput = Math.min(config.chunkMaxTokens, candidate.maxTokens > 0 ? candidate.maxTokens : config.chunkMaxTokens);
      const chunkInputBudget = getSafeInputTokenBudget(
        candidate.contextWindow,
        chunkOutput,
        `${MAP_SYSTEM_PROMPT}\n${buildMapPrompt("")}`
      );
      const parts = groupToolExchanges(llmMessages).map(group => serializeConversation(group));
      const rawChunks = chunkChronologicalParts(parts, chunkInputBudget, config.chunkOverlapPercent);
      await debug(config.debug, ctx.cwd, runId, "map-reduce-plan", {
        chunkInputBudget,
        chunkCount: rawChunks.length,
        chunkOverlapPercent: config.chunkOverlapPercent,
        chunkOutputTokens: chunkOutput,
        finalOutputTokens: config.finalMaxTokens,
        forceMapReduce
      });
      if (rawChunks.length < 2 && !forceMapReduce) {
        throw new Error("Compaction input did not fit final output but cannot be split into chronological chunks.");
      }

      const finalCheckpointPrompt = (checkpoints: string[]) => buildPrompt(
        checkpoints.map((checkpoint, index) => `--- checkpoint ${index + 1} ---\n${checkpoint}`).join("\n\n"),
        event.preparation.previousSummary,
        manualFocus
      );
      const fitsFinal = (checkpoints: string[]): boolean => {
        try {
          assertFitsSummarizerBudget(
            `${finalSystemPrompt}\n${finalCheckpointPrompt(checkpoints)}`,
            candidate.contextWindow,
            config.finalMaxTokens
          );
          return true;
        } catch {
          return false;
        }
      };

      let checkpoints: string[] = [];
      let reduceSteps = 0;
      for (const rawChunk of rawChunks) {
        const map = await request("map", MAP_SYSTEM_PROMPT, buildMapPrompt(rawChunk.join("\n")), chunkOutput, true);
        checkpoints.push(map.summary);
        // Do not wait for every map result. As soon as the future final request would overflow,
        // merge adjacent intermediate checkpoints until that final request is admissible again.
        while (!fitsFinal(checkpoints)) {
          if (checkpoints.length < 2) {
            throw new Error("A single map checkpoint cannot fit the final context with the configured output limits.");
          }
          const reduced = await request(
            "reduce",
            REDUCE_SYSTEM_PROMPT,
            buildReducePrompt(checkpoints[0], checkpoints[1]),
            chunkOutput,
            true
          );
          checkpoints.splice(0, 2, reduced.summary);
          reduceSteps++;
        }
      }

      const result = await request(
        "final",
        finalSystemPrompt,
        finalCheckpointPrompt(checkpoints),
        config.finalMaxTokens
      );
      return { ...result, mode: "map-reduce", mapChunks: rawChunks.length, reduceSteps };
    };

    try {
      let result;
      let usedFallback = false;
      try {
        result = await compactWith(model, forceMapReduceForSessionFallback);
      } catch (primaryError) {
        if (!event.signal.aborted && primary && active && config.modelFailurePolicy === "session-model" && primary !== active) {
          warn(`[pi-compact] CONFIGURATION ERROR: summarizer ${config.model} cannot run with this output profile or failed. Retrying with the session model because modelFailurePolicy=session-model.`, primaryError);
          await debug(config.debug, ctx.cwd, runId, "session-model-fallback", {
            configuredModel: config.model,
            sessionModel: `${active.provider}/${active.id}`,
            reason: primaryError instanceof Error ? primaryError.message : String(primaryError)
          });
          result = await compactWith(active, true);
          usedFallback = true;
        } else {
          throw primaryError;
        }
      }

      const effectiveModel = usedFallback && active ? active : model;
      await debug(config.debug, ctx.cwd, runId, "compaction-complete", {
        model: `${effectiveModel.provider}/${effectiveModel.id}`,
        mode: result.mode,
        mapChunks: result.mapChunks,
        reduceSteps: result.reduceSteps,
        usedSessionFallback: usedFallback,
        summaryCharacters: result.summary.length,
        tokensBefore: event.preparation.tokensBefore
      });
      await debug(config.debug, ctx.cwd, runId, "custom-result-returned", {
        summaryCharacters: result.summary.length,
        firstKeptEntryId: event.preparation.firstKeptEntryId
      });
      return {
        compaction: {
          summary: result.summary,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          usage: result.usage,
          details: {
            implementation: "pi-compact",
            model: `${usedFallback && active ? active.provider : model.provider}/${usedFallback && active ? active.id : model.id}`,
            reason: event.reason,
            mode: result.mode,
            mapChunks: result.mapChunks,
            reduceSteps: result.reduceSteps,
            retainedBy: "pi-native-preparation"
          }
        }
      };
    } catch (error) {
      if (event.signal.aborted) {
        await debug(config.debug, ctx.cwd, runId, "compaction-aborted", { reason: event.reason });
        return { cancel: true };
      }
      const detail = error instanceof Error ? error.message : String(error);
      await debug(config.debug, ctx.cwd, runId, "compaction-failed", { reason: event.reason, error: detail });
      warn(
        `[pi-compact] COMPACTION BLOCKED: summarizer configuration is invalid or the model failed. ${detail} ` +
        `modelFailurePolicy=${config.modelFailurePolicy}.`,
        error
      );
      return { cancel: true };
    }
  });
}
