# DevForge Local Coding Agent Smart Harness v2 - Approved Canonical Plan

Build the coding-agent harness behavior-first: concrete model profiles, master loop, validated tools, edit appliers, repo intelligence, detection/benchmarking, streaming/context policy, modes, then IPC/storage.

This document is the canonical implementation anchor for the harness. If implementation drifts, return to this sequence and the acceptance tests below.

## Phase 1 - ModelProfile Schema And Target Profiles

Deliverable: `src/agent-harness/modelProfiles.ts`.

Define `ModelProfile` with concrete model identity, capability, tool-format, sampling, context, edit-format, loop, reasoning, quality, eval, and structured detection-trace fields. Do not store a fixed compaction threshold; compute `Math.floor(profile.context_window * 0.85)`.

Target defaults:

- GPT-OSS: native JSON tools, `native-tools` loop, `diff` SEARCH/REPLACE edits, reasoning levels `{ default: 'medium', tool_turns: 'low', hard_tasks: 'high' }`.
- Qwen3-Coder: `qwen3-xml`, `diff`, thinking defaults temperature `0.6`, `top_p 0.95`, `top_k 20`, `presence_penalty 1.5`.
- Gemma 3/4: JSON-schema fallback unless metadata explicitly proves native tool capability.
- Venice Dolphin Mistral 24B: `react-text`, whole-file edits, experimental tool tier, usable coding tier, temperature `0.08`.

Initial reliability/TPS/cold-start numbers are priors only. Phase 6 benchmark results are the truth source.

## Phase 2 - Agent Master Loop

Deliverable: `src/agent-harness/masterLoop.ts`.

Single-threaded Claude-Code-style master loop: continue while assistant turns contain tool calls, terminate on plain text, use one `AbortController`, max-turn budget, repeated identical tool-call guard, Plan/Act tool gates, 85% context compaction, structured `[ERROR]` tool failures, and TODO reminder injection after Act-mode tool calls once TODOs exist.

## Phase 3 - Tool Registry And Minimum Tool Set

Deliverable: `src/agent-harness/tools/`.

Zod-schema-validated tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `grep`, `run_terminal_command`, `run_tests`, `repo_map`, `codebase_search`, `todo_write`, `attempt_completion`.

The registry owns permission tiers, examples, structured result envelopes, fuzzy suggestions, schema errors, Plan/Act filtering, read parallelization, write/execute serialization, and the `edit_file` recent-read guard.

## Phase 4 - Edit-Format Appliers

Deliverable: `src/agent-harness/edits/`.

Implement SEARCH/REPLACE `diff`, whole-file, strict unified diff, diff-fenced, and future patch dispatch. SEARCH/REPLACE failure output must include `[ERROR] SEARCH_REPLACE_NO_MATCH`, preview, closest-match context, line numbers, similarity score, and corrected SEARCH guidance.

## Phase 5 - Codebase Intelligence

Deliverables: `repoMap.ts`, `vectorIndex.ts`, `hybridSearch.ts`.

Repo map uses a pluggable parser registry with JS/TS/JSX/TSX enabled in v1 and PageRank-style symbol importance. RAG uses SQLite + `sqlite-vec`, Qwen3-Embedding-0.6B at 768 dimensions, syntax-aware chunking with token fallback. Hybrid search combines ripgrep and vector nearest neighbors through reciprocal rank fusion. Expose exactly `repo_map`, `codebase_search`, and `grep`.

## Phase 6 - Detection Pipeline

Deliverable: `src/agent-harness/detection/detectModelProfile.ts`.

Pipeline: name regex under 5ms, `/api/show` metadata extraction, opt-in runtime microbenchmark cached by digest. Metadata may override priors. Gemma 3 must fall back to JSON-schema mode when metadata does not include tools. Benchmark overwrites reliability, parallel tool calls, quality tiers, TPS, and cold start, and persists into the profile blob keyed by digest.

## Phase 7 - Sampling, Streaming, Context Strategy

Deliverable: `src/agent-harness/runtime/ollamaHarnessClient.ts`.

Profile-specific sampling, coding-agent `num_ctx >= 32768`, computed 85% compaction, byte-identical system prompt across turns for KV prefix cache, explicit per-request `keep_alive`, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, 4-minute heartbeat, one `AbortController` per stream, MessagePort streaming, and final usage metrics.

## Phase 8 - Mode System

Deliverable: `src/agent-harness/modes.ts`.

Resolution order: mode defaults, profile defaults, user session overrides, request-level overrides. Modes: Coding, Chat, Creative, Vault. Mode determines tools and prompt layer; profile determines sampling, edit format, wire format, reasoning, context, and keep_alive.

## Phase 9 - IPC And Profile Storage

Deliverable: IPC/storage after Phases 1-8 exist.

Versioned `model_harness_profiles`, keyed by `model + workspace`, stores profile, trace, benchmark cache by digest, eval summary, last-good options, and user overrides. IPC: `agent:harnessDetectModel`, `agent:harnessRun`, `agent:harnessAbort`, `agent:harnessRunEval`, `agent:harnessGetProfile`, `agent:harnessSaveProfileOverride`. Streams use MessagePort.

## Acceptance Tests

- GPT-OSS uses native JSON tool calls, native-tools loop, `diff`, and reasoning levels.
- Qwen3-Coder uses `diff`, not `udiff`.
- Gemma3 without metadata `tools` capability falls back to JSON-schema mode.
- Dolphin has experimental tool tier and usable coding tier.
- Reliability numbers update from benchmark cache and are not treated as authoritative priors.
- Benchmark results persist and are reused by digest.
- Compaction threshold recomputes after context override.
- `keep_alive` is sent on every agent request.
- Master loop terminates on plain text and continues on tool calls.
- TODO reminder injects after Act-mode tool calls once TODOs exist.
- `edit_file` rejects without recent `read_file`.
- Repeated identical tool-call guard fires.
- SEARCH/REPLACE failure includes closest-match context and line numbers.
- Unknown tool suggestions work.
- Zod invalid args return structured errors.
- Reads parallelize; writes serialize.
- Parser registry supports JS/TS now and pluggable languages later.
- Streaming emits through MessagePort and aborts cleanly.
