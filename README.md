# pi-compact

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/offmonreal)

**Use a dedicated, smaller-context model for Pi Coding Agent compaction—without spending the
token budget of the primary coding model.**

## Illustrative compaction savings

The table compares **20M billed input tokens per day** used for compaction. It does not include
output tokens from the primary model, so it understates the saving: output from the expensive
models costs substantially more than output from GLM-4.5. These are approximate public API prices,
not a quote from any gateway or reseller.

| Primary model | Public input / output price per 1M tokens | 20M input cost per day | GLM-4.5 input cost per day | Estimated daily saving | Estimated 30-day saving |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Fable 5.1 | $10 / $50 | $200 | $12 | **$188 (94%)** | **$5,640** |
| Claude Opus 5.5 | $4 / $20 | $80 | $12 | **$68 (85%)** | **$2,040** |
| GPT-5.6 Terra | $2 / $12 | $40 | $12 | **$28 (70%)** | **$840** |

The GLM-4.5 reference rate used above is $0.60 input and $2.20 output per 1M tokens. Your gateway
can charge a different rate. The calculation uses billed compaction input across map, reduce, and final calls;
chunk overlap and retries can make this larger than the raw source history.

Savings can be greater when the dedicated summarizer is a self-hosted model or a free provider.

## Stage-aware prompts for one coherent checkpoint

`pi-compact` uses a dedicated prompt for each compaction stage: one-pass checkpointing, factual
map extraction for every chronological slice, intermediate merges, and the final merge. Every
stage uses the same strict output structure, so splitting a large session does not turn its final
checkpoint into unrelated summaries. The final prompt preserves goals, constraints, decisions,
progress, failures, next steps, artifacts, access details, and critical context.

The project-level `piCompact.prompt` is appended to the durable system prompt for one-pass and
final checkpoints; map and intermediate reduce steps keep their specialized prompts.

`pi-compact` is a safety-first Pi Coding Agent extension. It routes context
compaction to a project-configurable summarizer model while leaving the primary agent model
unchanged. Pi still retains a recent verbatim tail, so the agent continues from both a durable
checkpoint and the latest raw conversation.

## Why this exists

Long-running coding sessions need compaction. The usual approach asks the same, expensive,
large-context model to summarize its own history. A well-prompted summarizer with a smaller
context window can often produce an equally useful engineering checkpoint at a much lower cost.
It does not need to solve the task again; it needs to preserve decisions, files, commands, tests,
risks, and the next actionable step.

My experiments found no value in paying a premium model for the same structured compaction result
when a suitable dedicated summarizer is available. `pi-compact` makes this routing explicit, safe,
and configurable.

This is not a claim that every smaller model is interchangeable. Evaluate the summarizer on your
own codebase, languages, tool output, and task types. A fallback path is included because model
availability and output quality remain operational concerns.

## Features

- Routes every Pi compaction event to a dedicated `provider/model` whenever `piCompact` is
  enabled.
- Preserves Pi's native recent raw tail via `compaction.keepRecentTokens`.
- Uses one fast final-summary request when the prepared history fits the summarizer window.
- Automatically switches to chronological **map → reduce → final** when
  the source history is larger than the dedicated model's window.
- Exposes separate output reservations for map/reduce chunks and the final checkpoint.
- Appends a project-specific prompt to the durable system prompt, plus `/compact <focus>` instructions.
- Can cache completed map/reduce steps, including across Pi restarts.
- Excludes rejected tool exchanges from the material sent to the summarizer.
- Rejects empty replies, tool calls, provider errors, and length-stopped replies; a partial
  checkpoint is never saved.
- Falls back to the active model or cancels without changing the session when no valid checkpoint
  can be produced.

## Installation

Install from npm and the Pi package catalog:

```bash
pi install npm:@offmonreal/pi-compact
```

Confirm that Pi sees it:

```bash
pi list
```

Install only for the current project instead of globally:

```bash
pi install --local npm:@offmonreal/pi-compact
```

For local development, run the extension directly from this checkout:

```bash
npm install
pi --extension ./extensions/pi-compact.ts
```

## Publishing to npm and the Pi package catalog

`@offmonreal/pi-compact` is an npm package. The `pi-package` keyword makes a published version
eligible for automatic discovery in the Pi package catalog; no separate Pi upload is required.

Before each release:

```bash
npm login
npm run check
npm pack --dry-run
npm publish --access public
```

## Register a summarizer model

The model must already be registered in Pi as `provider/model`. Register your OpenAI-compatible
or other provider in Pi's local model configuration, and keep credentials outside tracked project
files—use an environment reference, Keychain command, or another secret mechanism.

Accurate `contextWindow` and `maxTokens` model metadata is required. The extension refuses an
unbounded request rather than relying on provider-side truncation.

## `piCompact` settings

Put `piCompact` in global settings or in a trusted project's `.pi/settings.json`. Project values
override global values. Use `{ "piCompact": false }` to disable the extension in one project.

| Key | Values | Default | What it changes |
| --- | --- | --- |
| `enabled` | `true`, `false` | `true` | Enables this extension. `false` disables it. |
| `debug` | `true`, `false` | `false` | Writes diagnostic events to `.pi/pi-compact-debug.jsonl`: safe token estimates, selected model, cache hits, cleanup counts, pipeline stages, and provider token usage. It never writes conversation text, prompts, API keys, or summary content. |
| `model` | Pi model reference: `"provider/model"` | not set | Dedicated summarizer. Without it, the failure policy applies. |
| `modelFailurePolicy` | `"block"`, `"session-model"` | `"block"` | `block` stops compaction with a console error. `session-model` uses the active session model and logs a warning when the dedicated model is missing, unavailable, incompatible with the output limits, or fails. A session-model fallback always uses at least `map → final`; it never sends the whole source history directly to the final-summary request. |
| `thinking` | `"auto"`, `"on"`, `"off"` | `"auto"` | Controls whether the summarizer's reasoning mode is requested. `auto` sends nothing to the endpoint. |
| `thinkingLevel` | `"auto"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"` | `"auto"` | Requests a reasoning level for models that support levels. `auto` sends nothing. |
| `finalMaxTokens` | positive integer | `32000` | Output reservation for the final durable summary. It must fit the summarizer's advertised output limit and context window. |
| `chunks.maxTokens` | positive integer | `16000` | Output reservation for every map and reduce step. It must fit the summarizer's advertised output limit and context window. |
| `chunks.overlapPercent` | number from `0` to under `100` | `5` | Repeats the end of one source chunk at the beginning of the next, preserving context across a chunk boundary. |
| `prompt` | string | empty string | Appended to the end of the durable system prompt for one-pass and final checkpoints. Manual `/compact <focus>` instructions apply only to that one run. |
| `cache.enabled` | `true`, `false` | `true` | Reuses completed map/reduce summaries instead of calling the summarizer again for identical work. |
| `cache.maxEntries` | positive integer | `300` | Maximum number of cached map/reduce summaries. Older entries are discarded first. |
| `cache.persistence` | `true`, `false` | `true` | Keeps the cache across Pi restarts in `.pi/pi-compact-step-cache.json` in the project. |
| `cleanup.rejectedToolExchanges` | `true`, `false` | `true` | Excludes failed tool results and their matching tool calls from the material sent to the summarizer. A result is failed when Pi marks it `isError: true` or its text starts with `FAIL.`. The original session is never changed. |

The recent raw tail is a Pi setting (`compaction.keepRecentTokens`), not a `pi-compact` setting.
This extension does not set or alter it.

### Local diagnostic and cache files

When `debug` is enabled, the extension creates `.pi/pi-compact-debug.jsonl`. With persistent
caching enabled, it also creates `.pi/pi-compact-step-cache.json` and may briefly create its
`.tmp` companion. These are local runtime artifacts: add all three paths to the host project's
`.gitignore` and do not commit them.

### Marking a failed custom tool result

Custom tools can prefix a rejected result with `FAIL.`. With
`cleanup.rejectedToolExchanges: true`, the extension excludes that result and its matching tool
call from the compaction input. It never removes either record from the Pi session.

## Context budget and output safety

An output budget must be reserved before a request begins. Sending a 200K input to a 200K model
and asking for another 16K output is unsafe: the provider may reject it or stop the checkpoint
early. Every request has to pass this admission check:

```text
conservative serialized input + requested output + 2,048 safety tokens
    <= summarizer contextWindow
```

If a one-pass final request does not fit, the extension constructs chronological chunks at message
boundaries. Each chunk becomes a map checkpoint. As soon as accumulated checkpoints would not fit
the final request, the earliest adjacent checkpoints are reduced. The final request then
incorporates the previous compaction summary and custom focus.
If any stage cannot return a complete non-empty result, no partial checkpoint is stored.

This is an extension-level safety guarantee, not a promise about a provider that reports incorrect
model metadata or silently violates its API contract.

## Chunking details

The map/reduce pipeline is designed for the common case where the primary agent context is much
larger than the summarizer context:

```text
old chronological history
  └─ map chunks (each ≤ safe input budget, each output ≤ chunks.maxTokens)
       └─ merge adjacent checkpoints whenever the future final request would overflow
            └─ final durable checkpoint (output ≤ finalMaxTokens)
```

Only adjacent chronological checkpoints are reduced together; semantic clustering never reorders
the conversation. A single serialized message that exceeds the safe chunk input budget is rejected
rather than truncated. The configured model-failure policy then applies, or Pi keeps the original session.

## Security

- Never commit literal API keys to `.pi/settings.json`, a model catalog, or this repository.
- Use environment references, Keychain, a secret manager, or Pi-supported credential commands.
- Project settings are read only when Pi trusts the project. Review project-local extension
  settings before approving trust.

## Development and verification

```bash
npm install
npm run check
pi --offline --no-extensions --extension ./extensions/pi-compact.ts --approve --list-models
```

`npm run check` runs TypeScript type checking and unit tests for configuration parsing, prompts,
chronological chunking, and the context/output admission guard.

## License

MIT. See [LICENSE](./LICENSE).
