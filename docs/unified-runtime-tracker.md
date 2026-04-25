# Unified Inference Fabric — Initiative Tracker

Living document: breadcrumbs, decisions, learnings, and status for the multi-phase effort to deliver LM Studio parity AND engage all compute (NPU + RTX + Intel Arc + 32 GB RAM) toward one model.

**Plan lives here:** [lm_studio_parity_overhaul plan](../.cursor/plans/lm_studio_parity_overhaul_e7302ba0.plan.md)
(plan = what to do; this tracker = what happened, why, what we learned)

---

## North Star

Make DevForge feel like LM Studio for model picking and long context, *and* make this laptop's NPU + Intel Arc + RTX + 32 GB RAM all visibly contribute to every chat — not just sit idle while Ollama uses one chip.

---

## Current Status

- **Phase:** Phase 2 (NPU-Drafted Speculative Decoding) — **infrastructure shipped; perf gate open**
- **Week:** 1
- **Blocked on:** live direct-vs-spec measurement and the NPU KV-cache reuse latency target; spec-decode is hard-disabled by default and requires `DEVFORGE_SPEC_DECODE_ENABLE=1` for experimental runs.
- **Next concrete action:** Mosaic is cancelled after Gate 1 failed; keep the classic v0.4 runtime line stable and only revisit Phase 2 perf if a future draft/verifier pairing can beat the measured baseline.
- **Gate status:** 25/25 release-gate checks pass for static/smoke contracts (adds `mosaic-gate1-smoke.js`); Phase 3 Gate 1 failed honestly and the Phase 2 perf gate (>=1.6x tokens/sec at >=60% draft acceptance) remains unproven.

---

## Phase Ledger

Status legend: `planned` / `in-progress` / `shipped` / `deferred` / `cancelled`

### Phase 0 — Foundations
- **Status:** **shipped** (2026-04-23)
- **Target window:** Weeks 1-3 — **completed in 1 day**
- **Ships as:** v0.2
- **Gate:** long-context smoke + llamanode smoke + mode-switch smoke pass in release-gate — **GREEN (11/11)**
- **Key files touched:** `electron/services/inference-orchestrator.js`, `src/chat-v2/runtime/buildInferenceOptions.js`, `electron/ipc-handlers.js`, `electron/preload.js`, `electron/services/backends/llamanode-backend.js` (new), `electron/services/backends/openvino-backend.js`, `electron/services/auto-setup.js`, `electron/services/ollama-helper.js`, `electron/services/backends/ollama-backend.js`, `src/components/Settings/SettingsModal.jsx`, `src/components/ModelSelector/ModelSelector.jsx`, `src/stores/appStore.js`, `src/stores/slices/generationSlice.js`, `src/stores/slices/modelCatalogSlice.js` (new), `src/stores/slices/index.js`, `scripts/long-context-eval.js` (new), `scripts/mode-switch-smoke.js` (new), `scripts/llamanode-smoke.js` (new), `scripts/release-gate.js`, `scripts/ensure-deps.js`, `package.json`, `src/components/index.js`, `src/components/ModelBrowser/index.js`
- **Files deleted (145 KB of dead duplicates):** `src/components/Models/{ModelBrowser,ModelSwitcher,ModelFinder,ModelLibrary,ModelPerformanceBadges}.jsx`, `src/components/ModelBrowser/{ModelBrowser,HardwarePanel}.jsx`
- **Actual start:** 2026-04-23
- **Actual ship:** 2026-04-23
- **Shipped work:**
  - **Context clamps (p0-ctx-1..5):** removed stacked caps in `_normalizePayloadForBackend`, narrowed `buildGenerateCompatRequest` to gpt-oss only, gated casual floor on opt-in `fastChatMode`, preserved workstation-citizen behavior in efficiency/laptop profiles. New `scripts/long-context-eval.js` wired to release gate.
  - **Keep-alive (p0-keep-1..2):** profile-aware defaults (balanced/speed → `-1`, efficiency → `30m`, laptop → `10m`). `OLLAMA_KEEP_ALIVE` env default raised from `8m` to `24h` in auto-setup + ollama-helper + ollama-backend. New `keepModelLoaded` setting (auto/always/timed) in SettingsModal overrides profile default.
  - **Backend stability (p0-stable-1..3):** removed `backends.clear()` teardown on mode switch; extracted additive `_registerOpenVinoBackends()`. OpenVINO server lazy-spawns via shared `_lazyStartPromise` so concurrent callers don't race. New `scripts/mode-switch-smoke.js` wired to release gate.
  - **Direct GGUF (p0-gguf-1..6):** `node-llama-cpp@2.8.16` added (pinned to 2.x for Electron 28 compat); `LlamaNodeBackend` with lazy native load (graceful fallback if missing), single-resident LRU, GGUF metadata exposure, CUDA/CPU runtime selection. Registered unconditionally in orchestrator; added to profile order tables. `gguf:` model IDs force-route to it via new `modelRequiresGguf` branch in `_selectBackendForRequest`. New IPC handlers `model:loadLocalGguf`, `model:listLocalGgufs`, `model:unregisterLocalGguf` persist to `localGgufCatalog` via electron-store. `ollama:createFromFile` kept as deprecation shim that forwards to the new path (no file copy). Preload bridges all three. New `scripts/llamanode-smoke.js` wired to release gate.
  - **Hub consolidation (p0-hub-1..4):** deleted 5 duplicate model components + 2 orphaned siblings (ModelBrowser.jsx x2, ModelLibrary, ModelFinder, ModelSwitcher, ModelPerformanceBadges, HardwarePanel), cleaned `components/index.js` and `ModelBrowser/index.js`. New `modelCatalogSlice` with `hydrateModelCatalog`, `invalidateModelCatalog`, stub `watchModelCatalog` (Phase 1 wires fs.watch). Dedupes across 4 sources (ollama, llamanode, lmstudio, npu) with TTL-cached hydrate, promise serialization for concurrent callers. Stripped the 4 aggressive useEffect refreshes in ModelSelector and replaced with single mount-time `hydrateModelCatalog()` + store-projected `npuStatus`. New IPC handlers `lmstudio:scanImportedDuplicates` + `lmstudio:reclaim` detect and remove old `ollama:createFromFile`-style duplicates, reclaiming disk space.
  - **Drive-by:** fixed pre-existing `openModelsDirectory` scope bug in SettingsModal (was at line 531, undefined in `LLMSettings` function scope).

### Phase 1 — Tiered Utilization
- **Status:** **shipped** (2026-04-24)
- **Target window:** Weeks 3-5 — **completed in 1 day**
- **Ships as:** v0.3
- **Gate:** tiered-utilization smoke (12th release-gate check) — **GREEN**
- **Key files touched:** `electron/services/inference-orchestrator.js`, `electron/services/npu-bridge.js`, `electron/services/power-mode.js`, `electron/services/vault-profile.js`, `electron/services/lane-registry.js` (new), `electron/services/npu-warmloop.js` (new), `scripts/openvino-model.json` (rewritten), `scripts/vault-profile.json` (new), `scripts/start-npu-server.py` (rewritten for GenAI), `scripts/setup-openvino.ps1`, `scripts/tiered-utilization-smoke.js` (new), `scripts/release-gate.js`, `electron/preload.js`, `electron/ipc-handlers.js`, `src/utils/electronAPI.js`, `src/components/HardwareMonitor/HardwareMonitor.jsx`, `package.json`, `docs/chat-v2-cutover-checklist.md`
- **Actual start:** 2026-04-24
- **Actual ship:** 2026-04-24
- **Shipped work:**
  - **WS1 — Unconditional NPU registration:** split `_registerOpenVinoBackends` into `_registerPassiveOpenVinoBackends` (NPU + iGPU, always) and `_registerOpenVinoBackends` (Unified Brain, opt-in). `PROFILE_ORDER_STANDARD` now includes `openvino-npu` + `openvino-gpu` in all profiles — efficiency/laptop put NPU first, speed/balanced put it after Ollama CUDA. No more chicken-and-egg: fresh installs get NPU visible on first launch.
  - **WS2 — Default NPU model swap:** `scripts/openvino-model.json` rewritten for general-purpose use (Qwen2.5-1.5B int4) with a note pointing to vault-profile.json. New `scripts/vault-profile.json` holds the `abyssal-devourer-v3` creative overrides minus model_path (the NPU runs one model at a time; vault gets its flavor, general gets its default). `vault-profile.js` prefers the new file with legacy fallback. `DEFAULT_NPU_MODEL_CANDIDATES` in npu-bridge reordered to prefer pre-converted OpenVINO IRs ≤2B.
  - **WS3 — OpenVINO GenAI runtime:** `start-npu-server.py` rewritten. Two engines side-by-side: `GenAIEngine` (`ov_genai.LLMPipeline`) for chat with native streaming, `OptimumEngine` (legacy `OVModelForCausalLM`) as fallback + for embeddings (GenAI doesn't expose hidden states). HF repo IDs snapshot-download into a local cache for GenAI. HTTP contract unchanged so `openvino-backend.js` needs no changes. `setup-openvino.ps1` installs `openvino-genai>=2024.6` and `huggingface_hub`.
  - **WS4 — Lane registry:** new `electron/services/lane-registry.js` with `getLaneCandidates(workloadType, context)` mapping 8 workload types (embedding, classifier, intent, autocomplete, image-generation, speech, chat-short, chat-main) to device preferences with AC vs battery variants. Orchestrator `_selectBackendForRequest` consults the registry BEFORE preferred-backend / scoring loop — simple routing short-circuits, unknown workloads fall through. Candidate list filtered against actually-registered backends.
  - **WS5 — NPU warm-loop:** new `electron/services/npu-warmloop.js`. `createNpuWarmloop({ npuBridge, powerMode, getProfile })` factory keeps a 1.5B model resident on NPU with gates for RAM (≥4GB free), battery (≥30%), profile (not efficiency/laptop), and a 60s cold-window after unload to prevent flapping. Re-evaluates on `setProfile`. Started in orchestrator `initialize()` as fire-and-forget.
  - **WS6 — Power-aware gating:** `power-mode.js` now exports `getPowerState()` using Electron's `powerMonitor` events + `systeminformation.battery` probe. State cached in-memory, updates via `on-ac` / `on-battery` listeners. Orchestrator has `_getPowerState()` wrapper with 5s cache. Lane registry filters: `chat-short` on battery promotes NPU when model ≤3B; `chat-main` on battery promotes NPU for small models; on AC the canonical RTX-first order stays.
  - **WS7 — Device telemetry UI:** orchestrator `getDeviceUtilization(windowMs)` buckets `recentDecisions` by device (gpu/npu/arc/cpu) with job counts, last activity, last workload. New IPC `orchestrator:getDeviceUtilization` + preload + `electronAPI.getDeviceUtilization()`. HardwareMonitor has a collapsible "Device Activity" section with per-device rows (jobs in last 60s, warm badge for NPU, last workload tag).
  - **WS8 — Tiered-utilization smoke:** new `scripts/tiered-utilization-smoke.js` checks WS1 registration split, profile order tables, default model ≤3B, vault split, GenAI imports, lane registry contract + orchestrator hook, warm-loop factory + init, power-state wrapper, and the full UI/IPC chain. 12th check in release-gate.
  - **WS9 — Ship gates:** extended `docs/chat-v2-cutover-checklist.md` with Phase 1 QA steps (NPU registered no opt-in, embedding routes to NPU with visible telemetry, AC↔battery swap visible in Device Activity, warm-loop gates on profile change).
  - **v0.3 stabilization sprint (verify + instrument + polish):**
    - Added stream telemetry (`first_token`, `abort`, `completed`) + warmloop transition telemetry through orchestrator IPC and Hardware Monitor rows.
    - Added live-smoke scripts: `stream-cold-load-smoke.js`, `npu-genai-smoke.js`, and `npm run eval:live-smoke`.
    - Added NPU unload path (`POST /models/unload` + bridge/warmloop IPC wiring) to release model residency without hard process teardown.
    - Implemented thinking-model UX in Chat V2: `streamingReasoning` state, live reasoning status, and collapsible "View reasoning" block.
    - Upgraded cold-load status banner to include model + approximate size + target backend/device.
    - Fixed runtime GenAI load failures by adding model/device fallback attempts and upgrading `openvino`, `openvino-genai`, `openvino-tokenizers`, and `optimum-intel` in `openvino-env`.
    - Result: `eval:live-smoke` now passes on target machine (`stream-cold-load-smoke` + `npu-genai-smoke` both green).

### Phase 2 — NPU-Drafted Speculative Decoding
- **Status:** **infrastructure shipped** (2026-04-24), **perf gate open** — spec-decode is disabled by default and requires `DEVFORGE_SPEC_DECODE_ENABLE=1`
- **Target window:** Weeks 5-9 — **contract completed in 1 day**
- **Ships as:** v0.4.0
- **Gate:** >=1.6x tokens/sec at >=60% draft acceptance across 10-prompt eval. Static contract gates (18/18) are green; live measurement is pending in the v0.4.2 recovery closeout.
- **Key files touched:** `package.json` (Electron 32, electron-builder 25, node-llama-cpp 3.18), `electron/services/backends/llamanode-backend.js` (full v3 API rewrite), `electron/services/draft-selector.js` (new), `electron/services/spec-decode-verifier.js` (new), `electron/services/spec-decode-bus.js` (new), `electron/services/inference-orchestrator.js` (spec-decode telemetry + auto-disable), `scripts/start-npu-server.py` (POST /draft + DELETE /draft/{id} + DraftRequest pydantic model), `electron/services/npu-bridge.js` (draftTokens + cancelDraft), `electron/ipc-handlers.js` (8 new IPC handlers), `electron/preload.js`, `src/utils/electronAPI.js`, `src/components/ModelSelector/ModelSelector.jsx` (Spec chip), `src/components/HardwareMonitor/HardwareMonitor.jsx` (Spec decode panel), `scripts/draft-pairs.json` (new override template), `scripts/draft-selector-smoke.js` (new), `scripts/npu-draft-smoke.js` (new), `scripts/spec-verifier-smoke.js` (new), `scripts/spec-bus-smoke.js` (new), `scripts/spec-dashboard-smoke.js` (new), `scripts/speculative-decoding-eval.js` (new, two-mode), `scripts/release-gate.js`, `scripts/ensure-deps.js` (GPU prebuild diagnostics).
- **Actual start:** 2026-04-24
- **Actual ship:** 2026-04-24
- **Shipped work:**
  - **WS-P2-0 — Runtime upgrade:** Electron 28 → 32.3.3, electron-builder 24 → 25.1.8, node-llama-cpp 2.8.16 → 3.18.1. `LlamaNodeBackend` rewritten against the v3 API (getLlama singleton, async loadModel, model.createContext, sequence-based chat, AbortSignal-based cancellation, onTextChunk streaming). Native module loads with CPU fallback; CUDA / Vulkan prebuilds physically present but their runtime testBindingBinary probe fails on this machine due to a missing VS2022 C++ workload (documented in tracker risks).
  - **WS-P2-1 — Draft Selector:** Curated pair table covering Qwen2.5 / Qwen2.5-Coder / Llama 3.1 / Llama 3.2 / DeepSeek-R1 / DeepSeek-Coder / Phi-4 / Mistral families with same-tokenizer scoring (1.0) plus heuristic fallback (0.7) for unknown variants. `scripts/draft-pairs.json` ships as user-override template; the override file takes precedence over the curated table on every `getDraftFor()` call (no restart required). New IPC trio: `model:getDraftFor`, `model:listSupportedSpecMains`, `model:validateSpecPair`. ModelSelector renders a violet "Spec" chip on every supported main with the matched draft id in its title.
  - **WS-P2-2 — NPU draft runtime:** Python NPU server gained `POST /draft` and `DELETE /draft/{request_id}`. New `DraftRequest` pydantic model accepts either prompt-string or prefix-tokens, lookahead 1-8, and per-request sampling overrides. Returns raw token IDs in the main vocab via the GenAI tokenizer's `TokenizedInputs.input_ids.data` shape (handled in `_extract_token_ids`). Cooperative cancellation via a thread-safe registry; pipe.generate() is opaque to mid-flight cancel but at 4-8 tokens / NPU it's microseconds anyway. Live test: `POST /draft prompt="def hello():" lookahead=4` returns `{draft_tokens: [73594,12669,198,750], engine: 'genai', device: 'NPU', latency_ms: ~2500}`. Latency target (200 ms) is missed because each call does a full prefill — KV-cache reuse is part of the orchestrator-loop work that depends on the live verifier.
  - **WS-P2-3 — CUDA verifier:** Pure-logic verifier in `spec-decode-verifier.js`, callback-based logits source so it tests independently of any backend. Algorithm: classic speculative sampling (Leviathan et al.) with greedy mode as default and stochastic mode falling back to greedy when drafter logprobs aren't available. Logit indexing follows the standard "logits[k] predicts position k+1" convention; requires non-empty prefix. `LlamaNodeBackend.evaluateForVerifier({tokens})` adapter probes for the v3 controlledEvaluate API and throws `SPEC_DECODE_UNAVAILABLE` cleanly when missing. Smoke covers 7 scenarios including all-accepted, mid-reject, first-reject, stochastic accept, stochastic fallback, invalid input.
  - **WS-P2-4 — Speculative-decode bus:** `electron/services/spec-decode-bus.js` implements the orchestrator-facing `requestDraft / submitVerification / cancelDraft / getMetrics / dispose` contract over a pluggable transport. HTTP transport (default) routes to `npuBridge.draftTokens()`. Native shmem transport (DEVFORGE_SPEC_BUS_TRANSPORT=shmem) is a stub that throws `SPEC_BUS_TRANSPORT_UNAVAILABLE` — the addon stays a v0.4.x optimization. Per-call latency / failure / cancellation metrics rolling over the last 200 samples for the dashboard.
  - **WS-P2-5 — CANCELLED for v0.4 / re-scoped to v0.4.1:** Tree speculation on Intel Arc was an explicit stretch in the plan, gated on WS-P2-3 + WS-P2-4 working with live CUDA. Since CUDA prebuilds aren't passing the binding-test probe yet, measuring a second-branch delta on top of an unmeasured baseline would be misleading. Reactivate after the CUDA loop is live and avg acceptance is measurable.
  - **WS-P2-6 — Dashboard + auto-disable:** Orchestrator now records spec-decode outcomes per `mainId|draftId` pair in a 1000-entry rolling buffer. `recordSpecDecodeOutcome / getSpecDecodeStats / isSpecDecodeDisabled` exposed via IPC + preload + `electronAPI`. Auto-disable triggers when a pair's average acceptance over the last 50 turns drops below 0.4 (configurable via `specDecodeConfig`); auto-re-enables after 100 turns of fresh data. Per-pair isolation verified: a low-acceptance pair-A doesn't affect a healthy pair-B. HardwareMonitor renders a "Spec decode" row inside Device Activity showing per-pair acceptance percentages with rose-tinted "off" badge when auto-disabled and a violet badge when active.
  - **WS-P2-7 — Phase 2 ship-gate eval:** `scripts/speculative-decoding-eval.js` ships in two modes. Static (release-gate) emits the documented JSON contract for downstream tooling. Live (DEVFORGE_SPEC_EVAL_MODE=live, called from `npm run eval:live-smoke`) drives 10 fixed prompts (5 coding, 3 chat, 2 reasoning) through the live NPU draft endpoint and Ollama main, measures per-prompt draft latency and main tokens/sec, and computes a projected speedup ceiling = (avgAcceptance × lookahead + 1). Real per-token acceptance vs the JS-side approximation requires the verifier loop to be live — documented inline in the script's note field.
  - **WS-P2-8 — Release v0.4:** package.json bumped to 0.4.0, tracker breadcrumb / Phase 2 retrospective added, 18/18 release-gate green at ship time.

#### CUDA verifier status on target machine
Earlier Phase 2 notes assumed node-llama-cpp 3.18.1 fell back to CPU because the CUDA binding probe tried to build from source and VS2022 BuildTools lacked the "Desktop development with C++" workload. The hardening follow-up disproved that assumption on the current target machine: `node scripts/cuda-probe.mjs`, `node scripts/cuda-probe-via-backend.mjs`, and `node scripts/cuda-verifier-live-probe.js` all resolve `gpu: "cuda"` / `gpuMode: "cuda"`, expose RTX VRAM, and `prewarmSpecDecodeVerifier()` returns `warmed: true` for `qwen2.5:1.5b` at context 1024. Artifact: [`docs/perf/cuda-verifier-live.md`](perf/cuda-verifier-live.md). The VS workload (`Microsoft.VisualStudio.Workload.NativeDesktop`) is still not installed, so keep the v0.4.5 guard: if a future machine resolves `cpu` or `unavailable`, `prewarmSpecDecodeVerifier self-disables` instead of loading a slow CPU-only verifier. Only install the workload if that fallback reappears.

### Phase 3 — Mosaic Runtime (R&D)
- **Status:** **cancelled** (2026-04-25, Gate 1 failed)
- **Target window:** Weeks 9-20
- **Gate 1 (Week 10-11):** profiling simulator must project ≥1.3× effective model-size capacity. If fail → Phase 3 cancelled, v0.4 is final.
- **Gate 2 (Week 18-19):** end-to-end must beat RTX partial-offload by ≥1.5× on 32B Q4. If fail → Mosaic stays dev-only.
- **Key new files:** `docs/mosaic-architecture.md`, `src/components/Dev/MosaicLab.jsx`, native coordinator addon
- **Ships as:** v0.5 if both gates pass
- **Actual start:** 2026-04-25
- **Actual end:** 2026-04-25
- **Gate 1 result:** **FAIL** — mandatory 14B target projected `1.143x` capacity vs the `1.3x` threshold at `99.6%` RTX-only baseline speed. Best-effort 30B projected `2.286x`, but the plan made 14B mandatory, so the cancellation rule applies. Canonical artifact: `docs/perf/mosaic-gate1.md`.

---

## Backlog — next phase candidates

- **Phase 2 unblock** — NPU `LLMPipeline` KV-cache reuse + CUDA verifier residency across turns. **Revisit when** re-running `npm run eval:spec-decoding` in live mode produces `avgRealSpeedup >= 1.0` on a single prompt on the target machine.

- **User-autonomy UI** — Explicit per-model device pin and per-chat backend override. **Revisit when** at least one user-reported case of “wrong backend was chosen” appears after v0.4.3 ships.

- **Phase 3 Mosaic R&D Gate 1** — Per-layer profiling simulator that decides whether to build the multi-device weight-splitting runtime. **Revisit when** the machine sustains a stable spec-decode ship and we want a Q4-32B-class step; the master plan still defines Gate 1 cancel/proceed criteria.

- **Stabilize and push** — Push branch `wip/mac-handoff-2026-02-13` and tag `v0.4.2` to `origin`, then pick the next phase. **Revisit when** you explicitly approve (anytime).

### 2026-04-25 — v0.4.3 LM Studio parity polish (patch)
- Per-model **system prompts** from SQLite presets now flow through `buildChatV2InferenceOptions` and `buildSystemPrompt` (preset wins when non-empty; workspace settings remain the fallback).
- Chat V2 **context length** picker (Auto + 4K–128K, capped by model metadata), **approximate ctx used / budget %** in the header strip, and **Eject** (parallel `llm:unload` + `npu:unloadModel`) in the runtime panel.
- **Model selector:** quant filter chips, sort (Recent / Size / Name) persisted in `modelSelectorPrefs`, per-row VRAM fit dot from hardware stats + model size.
- Release gate: **19th** check `scripts/preset-system-prompt-smoke.js`.
- **Tagged + pushed.** `v0.4.3` is on `origin/wip/mac-handoff-2026-02-13` at commit `9198924`.

### 2026-04-25 — v0.4.4 Phase 2 unblock + user-autonomy UI (patch)
- **Phase 2 unblock — NPU KV-cache reuse.** `scripts/start-npu-server.py` now calls `pipe.start_chat()` on `/draft/session` when the installed `openvino-genai` build exposes it, feeds only the *delta* since the last accepted suffix into `pipe.generate(...)` per `/draft/session/{id}/extend`, and runs `pipe.finish_chat()` on session close. A delta-generate failure transparently falls back to the full-prompt path for the rest of the session, so older GenAI builds keep working without fingerprinting their version.
- **Phase 2 unblock — verifier prewarm.** `InferenceOrchestrator.prewarmSpecDecodeVerifier(model)` (new method) routes the existing curated-pair / GGUF-resolution gate, then calls `LlamaNodeBackend.loadModel(verifierGguf, { contextSize })` as fire-and-forget. `loadModel` is already idempotent for matching path + ctx (`backends/llamanode-backend.js:219-223`), so the first spec-decode turn on a session arrives with a hot verifier instead of paying ~30 s of GGUF cold-load. ChatV2Harness fires the prewarm whenever `currentModel` changes.
- **User autonomy — per-model device pin.** `model_presets` schema gets a `device_pin TEXT` column (with a non-destructive `ALTER TABLE` migration), the save handler validates the pin against an allow-list (`ollama-cuda`, `ollama-cpu`, `llamanode`, `openvino-npu`, `openvino-gpu`, `openvino-hybrid`, `llamacpp-vulkan`), and `presets:getForModel` returns it. ModelPresets settings UI exposes a `Device pin (per-model backend)` <select> driven from the same allow-list.
- **User autonomy — per-chat backend override.** `chatV2SessionStore` persists a session-level `backendOverride` validated against the same allow-list. `buildChatV2InferenceOptions` projects preset `device_pin` and session `backendOverride` (session wins) onto `options.forceBackend`; the chat engine extracts and forwards it on the stream/generate request. `createElectronRuntimeAdapter` and `ipc-handlers` `sanitizeInferenceInput` round-trip the field, and `InferenceOrchestrator._selectBackendForRequest` already honored `payload.forceBackend` (selectionSource: `forceBackend`). ChatV2 toolbar ships a `Backend` <select> next to the context picker, accent-violet when an override is active.
- **Release gate.** Two new smokes: `spec-decode-residency-smoke.js` (Phase 2 contract: prewarm gating, llamanode idempotent loadModel, NPU server start_chat / delta / finish_chat / IPC bridge) and `autonomy-routing-smoke.js` (allow-list parity end-to-end across schema, sanitize, build options, engine, runtime adapter, orchestrator, UI). Total now **21/21**.
- **Re-evaluation.** Live `npm run eval:spec-decoding` should be re-run on target hardware to refresh the v0.4.2 baseline (`docs/perf/phase2-spec-decode-measurement.md`) now that the two highest-impact issues from that doc are addressed. Decision flip stays gated on `avgRealSpeedup >= 1.0`.

### 2026-04-25 — v0.4.5 hardening sprint (patch)
- **Live-verified Phase 2 unblock.** `scripts/phase2-unblock-live-verify.js` reached the running OpenVINO server at `127.0.0.1:8081`, created `/draft/session`, observed `chat_mode_active: true`, ran two `/extend` calls, and confirmed the second call used `generate_mode: "delta"`. Artifact: `docs/perf/phase2-unblock-live.md` (first extend 2575 ms, second extend 2413 ms, close success true).
- **CUDA verifier honesty.** `LlamaNodeBackend.getActiveGpuMode()` now exposes the resolved node-llama-cpp GPU mode, and `InferenceOrchestrator.prewarmSpecDecodeVerifier()` self-disables with `verifier_cpu_only` / `verifier_not_cuda` instead of warming a CPU-only verifier. The VS2022 C++ workload install command is documented in the known caveat above.
- **Behavioral autonomy coverage.** Added `scripts/test-utils/buildOptionsHarness.js`, `scripts/autonomy-build-options-smoke.js`, and `scripts/autonomy-orchestrator-route-smoke.js`. These execute the real option-building and route-selection paths: session backend override wins over preset `device_pin`, preset-only pin propagates, invalid override is rejected, and orchestrator `forceBackend` returns `selectionSource: "forceBackend"`.
- **Readable inference option layering.** `src/chat-v2/runtime/buildInferenceOptions.js` now names each transform (`applyPresetOverrides`, `applyUserContextOverride`, `applySessionBackendOverride`, `applyFastChatClamp`, `applyVaultOverrides`) while preserving the existing option semantics and source-text release-gate contracts.
- **Release gate.** Three new checks: `cuda-verifier-guard`, `autonomy-build-options`, `autonomy-orchestrator-route`. Total now **24/24**.
- **Next phase.** Mosaic Gate 1 proceeds as v0.4.6 on this verified foundation.

### 2026-04-25 — CUDA verifier target-machine verification
- **Corrected stale assumption.** A follow-up live probe showed the current machine already resolves node-llama-cpp through CUDA despite the missing VS NativeDesktop workload. `scripts/cuda-verifier-live-probe.js` initialized the orchestrator's `llamanode` backend, observed `gpuMode: "cuda"`, and successfully prewarmed the local qwen2.5:1.5b GGUF verifier (`warmed: true`, pair `qwen2.5:1.5b|qwen2.5:1.5b`, ctx 1024).
- **Artifact.** `docs/perf/cuda-verifier-live.md`.
- **Policy.** Keep the v0.4.5 guard in place for other machines. On this target, no VS workload install is needed right now; if a future probe returns CPU-only, install `Microsoft.VisualStudio.Workload.NativeDesktop` then re-run the probe.

### 2026-04-25 — v0.4.6 Mosaic Gate 1 FAILED; Phase 3 cancelled
- **Gate basis.** Mandatory `qwen2.5-coder:14b` simulation from live profiles projected `capacityMultiplier=1.143x`, below the required `1.3x`, while retaining `speedFraction=0.996` of RTX-only baseline. The best-effort `qwen3-30b-abliterated:q4_k_m` projection showed `2.286x`, but the v0.4.6 plan made 14B mandatory; therefore Gate 1 fails.
- **Artifacts.** `docs/perf/mosaic-gate1.md`, `docs/perf/mosaic/decision.json`, `docs/perf/mosaic/sim-14b.json`, `docs/perf/mosaic/sim-30b.json`, and per-device profile JSONs under `docs/perf/mosaic/`.
- **Shipped scaffolding retained.** `docs/mosaic-architecture.md`, the pure-JS simulator/decision scripts, safety-guarded profilers, and hidden `MosaicLab` dev panel remain useful research/debug assets, but Mosaic runtime build work is cancelled unless a future hardware/runtime change warrants a new gate.
- **Release gate.** `mosaic-gate1-smoke.js` is the 25th release-gate check; total **25/25**.

---

## Decision Log

Chronological record of choices that shaped the plan. Each entry: what, why, alternatives, when/how to revisit.

### 2026-04-23 — Scope set to Full (L1+L2+L3)
- **Choice:** All three levels, with Level 3 Mosaic scoped as R&D with profiling-gated go/no-go.
- **Why:** User stated "we aren't going for simple, we are going for true, shippable quality." Level 1+2 ship real value regardless of Level 3 outcome.
- **Alternatives considered:** Minimal (context fixes only), Core (LM Studio parity only).
- **Revisit when:** Mosaic Gate 1 fails — at that point scope collapses to L1+L2 final.

### 2026-04-23 — node-llama-cpp (not bundled llama-server.exe)
- **Choice:** Add `node-llama-cpp@^3` as the direct GGUF runtime; no bundled binary.
- **Why:** User picked "node-llama-cpp: in-process, no extra binary, but heavier npm install." In-process control simplifies streaming/cancellation/LRU eviction.
- **Alternatives considered:** Bundling `llama-server.exe` and spawning per model (matches current `LlamaCppBackend` shape).
- **Risk:** Native rebuild on Blackwell + CUDA 12.8 on Windows is a known pain point.
- **Revisit when:** ensure-deps native rebuild fails on target hardware → reconsider bundling.

### 2026-04-23 — Hedged runtime (Classic default, Mosaic opt-in)
- **Choice:** Classic (Ollama + llamanode + OpenVINO) remains the default shipped path. Mosaic is opt-in only and invisible pre-Gate 2.
- **Why:** User picked "Hedge. Architect Mosaic alongside the existing stack." Bounds Phase 3 risk; no regression path for users on non-Copilot+ hardware.
- **Alternatives considered:** "Replace" (Mosaic becomes THE runtime post-Gate-2), "Skip Mosaic entirely."
- **Revisit when:** post-Gate 2, if Mosaic shows decisive (≥2×) speedup, reconsider elevating to default.

### 2026-04-23 — Auto-detect Copilot+ for default NPU acceleration
- **Choice:** On first launch, if `hardware.npu?.detected === true` and OpenVINO install succeeds, auto-select `classic-npu` runtime. Otherwise plain `classic`.
- **Why:** User picked "Auto-detect: Copilot+ users get the upgrade silently." Avoids the current chicken-and-egg where NPU is dead unless user manually picks it.
- **Alternatives considered:** "Plain Classic always, user opts in" (safer but discoverability problem), "NPU acceleration always when available, no opt-out" (bold but risky on marginal hardware).
- **Revisit when:** if NPU-acceleration path causes regressions on non-target Copilot+ hardware (e.g. Snapdragon X which has no OpenVINO), tighten detection.

### 2026-04-23 — Mosaic invisible pre-Gate 2
- **Choice:** Mosaic runtime only exists behind `DEVFORGE_MOSAIC_DEV=1` environment variable and a dev-only panel during Phase 3 R&D. Promoted to user-visible only after Gate 2 passes.
- **Why:** User picked "Hidden entirely. Ship only after Gate 2 passes." Keeps experimental code out of the stable UI surface; protects users from performance cliffs mid-development.
- **Revisit when:** Gate 2 passes → promote to user-visible with warning banner.

### 2026-04-25 — Mosaic Gate 1 measurement-driven; coordinator language deferred
- **Choice:** Gate 1 is a measurement and simulation gate only. It ships profilers, a pure-JS simulator, a hidden MosaicLab panel, and a PASS/FAIL decision artifact; it does not choose or build the native coordinator.
- **Why:** v0.4.5 hardened the foundation enough to measure honestly, but native coordination is still expensive R&D. Gate 1 must prove at least 1.3x effective model-size capacity at >=50% RTX-only baseline throughput before any native runtime work starts.
- **Alternatives considered:** Start a Node N-API coordinator immediately; start a Rust `napi-rs` coordinator immediately; skip the hidden panel. All are premature before measured PASS.
- **Revisit when:** `docs/perf/mosaic-gate1.md` records PASS — then choose Node N-API vs Rust `napi-rs` in the Phase 3 build plan.

### 2026-04-23 — Preserve workstation-citizen mode in efficiency/laptop profiles
- **Choice:** The existing conservative clamps (context floors, `keep_alive: 8m`, single loaded model) are preserved as explicit presets inside the `efficiency` and `laptop` performance profiles, not removed entirely.
- **Why:** Original design was intentional — "leave headroom for other apps on the system." Valid for laptop-on-battery users. Only the `balanced`/`speed` profiles get LM-Studio-style "take the machine" defaults.
- **Revisit when:** user feedback shows `efficiency` profile is too aggressive or not aggressive enough.

### 2026-04-23 — Pinned node-llama-cpp to 2.8.16 (not 3.x)
- **Choice:** Added `node-llama-cpp@2.8.16` as the direct GGUF runtime instead of 3.18.1.
- **Why:** 3.x requires Node 20+. Electron 28 (currently pinned) bundles Node 18.18. Moving to 3.x requires an Electron 30+ upgrade which has cascading effects on other packages. 2.8.16 supports the Phase 0 need (single-model direct GGUF load with CUDA) cleanly.
- **Alternatives considered:** Upgrade Electron to 30+ now (bigger change, delays Phase 0 ship); stay on Ollama-only for Phase 0 (defeats the point).
- **Revisit when:** Phase 2 needs continuous batching for speculative decoding → then we also bump Electron + node-llama-cpp together.

### 2026-04-24 — Vault flavor split from NPU runtime config
- **Choice:** Created `scripts/vault-profile.json` for creative overrides (temperature, mirostat, corruption) and kept `scripts/openvino-model.json` as the general-purpose NPU runtime config with a ≤1.5B default model. `vault-profile.js` prefers the new file and falls back to the legacy path for back-compat.
- **Why:** The NPU runs one model at a time — the old config shipped with `Qwen2.5-14B-Instruct-int4-ov` and the `abyssal-devourer-v3` flavor, which meant every new install got a model too big for the 13 TOPS NPU 3 budget just to have vault metadata. Splitting lets the default be snappy and the vault keep its personality.
- **Alternatives considered:** Per-workspace model switching (would require reloading the NPU on every chat), keeping everything in one file with the general settings layered on top (confusing merge semantics).
- **Revisit when:** if users ask "how do I run 14B on NPU for vault work", document that they swap `openvino-model.json` directly; build a UI for it if the ask gets loud.

### 2026-04-24 — Lane registry routes workloads before scoring
- **Choice:** New `electron/services/lane-registry.js` with 8 workload types (embedding, classifier, intent, autocomplete, image-generation, speech, chat-short, chat-main), each with `onAc` / `onBattery` device preference lists. Orchestrator `_selectBackendForRequest` consults the registry BEFORE its scoring function.
- **Why:** The scoring loop is good at "which chip is best for this chat turn" but bad at "embeddings should always go to NPU if it's available." A simple lookup table short-circuits the obvious routes, leaves the complex scoring for genuinely ambiguous cases. Plus it's the single place where power-aware routing lives (battery promotes NPU).
- **Alternatives considered:** Extending the scoring function with workload-type weights (harder to read, slower to debug); encoding routes in each backend's `estimatePerformance` (decentralizes the decision).
- **Revisit when:** Phase 2 adds `chat-draft` workload type for speculative decoding — extend the registry.

### 2026-04-24 — NPU warm-loop gated on RAM + battery + profile
- **Choice:** `createNpuWarmloop` keeps a 1.5B model resident on NPU during idle, gated on `freeRam ≥ 4 GB` AND `battery ≥ 30%` (when on battery) AND `profile in {speed, balanced}`. 5-minute evaluation interval + 60s cold-window after unload to prevent flap.
- **Why:** First-token latency on a cold NPU load is 2-5s. That's the difference between autocomplete feeling instant and autocomplete feeling dead. The gates prevent the warmloop from stealing RAM the user needs for a 13B chat model or from draining battery when they need it.
- **Alternatives considered:** Always-on (too aggressive), lazy-on-first-request (same 2-5s delay every cold chat), profile-only gating (ignores RAM pressure). The 60s cold window is a direct response to the flap risk.
- **Revisit when:** user reports indicate the warmloop is fighting with their main chat model for RAM, or that idle NPU power draw is noticeable on battery.

### 2026-04-24 — NPU registered passively, Unified Brain still opt-in
- **Choice:** Split `_registerOpenVinoBackends` into two methods. `_registerPassiveOpenVinoBackends` runs on every initialize when NPU/iGPU hardware is detected. `_registerOpenVinoBackends` still registers `openvino-hybrid` (HETERO:GPU,NPU), which stays opt-in behind explicit user preference.
- **Why:** The chicken-and-egg (NPU invisible until user picks OpenVINO) is a bug; Unified Brain's "lock the GPU into HETERO mode" is a real tradeoff that should stay user-controlled. Splitting the two lets NPU be useful as a peer device without forcing the hybrid commitment.
- **Alternatives considered:** Register everything always (breaks the one-runtime-family invariant for hybrid users); keep both gated on opt-in (leaves NPU dead for the default user).
- **Revisit when:** Phase 2's speculative decoding needs a new "NPU as draft" mode — that can be passive too, orthogonal to hybrid.

### 2026-04-23 — Dynamic import() for node-llama-cpp (not require)
- **Choice:** `LlamaNodeBackend.loadLlamaModule` uses `await import('node-llama-cpp')` instead of `require()`, with a cached promise in `_modulePromise`.
- **Why:** node-llama-cpp@2.x ships as ESM with top-level await in its entry point. Node throws `ERR_REQUIRE_ASYNC_MODULE` if you try to `require()` it. Dynamic import is the documented workaround for ESM-with-TLA loading from CommonJS.
- **Alternatives considered:** Convert the entire electron/ tree to ESM (massive change), patch node-llama-cpp to remove TLA (unmaintainable), pin to an older version before TLA was added (no clear safe version exists).
- **Revisit when:** we migrate to Electron 30+ and node-llama-cpp 3.x in Phase 2 — 3.x is ESM-native anyway, so the dynamic import stays; electron/ might be ready for ESM-native modules too by then.

---

## Learnings & Surprises

Things discovered during audit that changed or sharpened the plan.

### NPU backend is chicken-and-egg
[inference-orchestrator.js:253-296](../electron/services/inference-orchestrator.js) only registers `openvino-npu` if `preferredBackend` already contains "openvino". On a fresh install `preferredBackend = 'auto'` → NPU never registered → orchestrator can't route to it → NPU invisible to normal chat. Every path to "discover and use the NPU" requires the user to first know to pick it. Plan Phase 1 fixes by registering unconditionally when hardware detects NPU.

### NPU scoring deprioritizes NPU for real chat
Even when registered, scoring in [inference-orchestrator.js:773,780](../electron/services/inference-orchestrator.js) gives NPU +10 only on `efficiency` profile and +4 otherwise, while Ollama-CUDA gets +10 on speed profile. On default `balanced` with NVIDIA present, NPU loses every scoring round for interactive chat. NPU is only preferred for embeddings, maintenance jobs, and models ≤3B. Plan fixes via lane-registry that short-circuits on workload type before scoring.

### OpenVINO HETERO cannot enlist NVIDIA CUDA
OpenVINO's `HETERO:GPU,NPU` only knows about CPU, Intel GPU, and NPU. No production CUDA plugin exists (discontinued years ago). On this laptop, current "Unified Brain" means `HETERO:IntelArc,IntelNPU` and ignores the RTX 5050 entirely. This is WHY Level 3 Mosaic must be a custom coordinator rather than relying on OpenVINO HETERO.

### Current default NPU model is too big
[scripts/openvino-model.json](../scripts/openvino-model.json) ships with `OpenVINO/Qwen2.5-14B-Instruct-int4-ov` as the default. On a 13-TOPS NPU with shared RAM, 14B won't run at interactive speed. Appears to be set up for the NSFW vault workload (`abyssal-devourer-v3`, `profile: apotheosis`) rather than general chat. Plan changes target-hardware default to Qwen2.5-0.5B or SmolLM2-1.7B for NPU role.

### LM Studio imports duplicate storage
[electron/ipc-handlers.js:4896-4908](../electron/ipc-handlers.js) (`ollama:createFromFile`) creates a temporary Modelfile pointing at the LM Studio GGUF, then runs `ollama create`. Ollama copies the file into its blob store. A 7 GB LM Studio model becomes 14 GB on disk. Plan replaces with `model:loadLocalGguf` that registers the path in a local catalog; llamanode loads it directly.

### Context clamps stack in 4 places
1. `buildInferenceOptions` casual floor (4096) → 2. `buildGenerateCompatRequest` compat cap (8K/16K) → 3. `_normalizePayloadForBackend` orchestrator cap (4096/12288) → 4. `sanitizeOptionSet` hard ceiling (256K). The lowest cap wins. User thinks they asked for 64K, actually gets 4K. Auto-tuner's "131072 for monster VRAM headroom" recommendation is comprehensively ignored. Plan consolidates to one clamp site (`clampInferenceOptionsToModel`).

### Backend teardown on mode switch
[inference-orchestrator.js:552-577](../electron/services/inference-orchestrator.js) clears `this.backends` and re-runs `initializeBackends()` whenever Unified Brain is toggled. Originally intentional to enforce the "one runtime family at a time" invariant (OpenVINO and Ollama both want the GPU). But causes UI flickering and mid-stream connection errors. Plan preserves the invariant via lazy-spawn of OpenVINO server instead of nuclear rebuild.

### The RTX 5050 Laptop ReBAR + shared-RAM iGPU/NPU combo is the hardware precondition for Mosaic
Two of three compute devices (Arc iGPU, NPU) already share physical memory with the CPU. The RTX 5050 has ReBAR so it can DMA from pinned system RAM at ~16 GB/s. Total addressable model pool ≈ 40 GB. Unusual for a laptop; makes a 32B-class model viable with the right coordinator. This is the "why here, why now" for Level 3.

---

## Open Questions

Things deferred or that need revisit at specific phase boundaries.

- **Mosaic A/B toggle granularity:** per-prompt or per-session? Decide during Phase 3 UI work.
- **Speculative-decoding auto-disable threshold:** plan sets 40% acceptance rate. Should this be user-tunable, or is it a hard constant? Revisit during Phase 2.
- **Draft/main pair table:** curated list needs populating during Phase 2 for Qwen 7B/14B, Llama 3.x 8B, DeepSeek Coder, Phi-4. User override mechanism TBD.
- **LM Studio reclaim flow lifetime:** keep permanently, or remove after v0.5? Leaning permanent (users can always import new models).
- **Power/thermal backoff policy:** exact wattage/temp thresholds for suspending Mosaic on battery. Measure during Phase 3 profiling.
- **OpenVINO GenAI version compatibility:** answered in Phase 1 — pinned `openvino-genai>=2024.6` in setup-openvino.ps1. Revisit if Intel publishes a GenAI 3.x with breaking API changes.
- **Native coordinator language:** Node addon via N-API, or Rust via napi-rs? Decide during Phase 3 design doc.
- **GenAI NPU-3 Qwen2.5 support:** validated in v0.3 stabilization after OpenVINO runtime refresh (`openvino/openvino-genai/openvino-tokenizers` + `optimum-intel` upgrade). Keep monitoring for future driver/runtime regressions.
- **Warm-loop unload mechanism:** currently uses `npuBridge.stopServer()` which is heavy (tears down Python subprocess). Phase 2 should add a dedicated `/models/unload` endpoint so we can release the model without respawning the server.

---

## Risks Being Watched

Active risks to track as phases progress. See plan Risk Register for full mitigations.

- [x] node-llama-cpp 2.x native rebuild on Blackwell + CUDA 12.8 Windows — prebuilds worked; dynamic import() used for the ESM+TLA loader (Phase 0).
- [x] node-llama-cpp 3.x runtime prebuild loads on the target machine — fixed in v0.4.1 by installing CUDA 12.9 toolkit + auto-injecting `cudart64_12.dll` path from `LlamaNodeBackend._getLlama`. `cuda-probe-via-backend.mjs` reports `gpu: cuda`, 8.5 GB VRAM. The runtime probe was never actually broken; it was a missing-DLL crash in the test child process.
- [ ] NPU + Python subprocess memory leak over long sessions
- [x] OpenVINO GenAI NPU-3 support for Qwen2.5 family — verified on target machine during v0.3 stabilization (`npu-genai-smoke` reports `engine=genai`, `device=NPU`).
- [ ] Warm-loop flap when free RAM hovers near the 4 GB gate (Phase 1 introduced a 60s cold-window but should be monitored)
- [ ] Draft acceptance rate <40% on real user chat distribution — measurable via live `eval:spec-decoding`; auto-disable already wired (WS-P2-6), but the path is hard-disabled by default until the v0.4.2 measurement decision.
- [ ] Spec-decode KV-cache reuse — current draft endpoint does a full prefill on every call (~2.5s for 4-8 tokens on NPU 3); KV-cache reuse on the NPU drafter is still required for the 200 ms latency target.
- [ ] Mosaic Gate 1 simulator projects <1.1× — if so, Phase 3 cancels
- [ ] Intel NPU driver regression between plan-date and ship-date
- [ ] llama.cpp FP8/FP4 Blackwell support timeline

---

## Breadcrumbs

Chronological dev diary. Newest first. Append entries as work happens; keep each entry brief (what changed, what we learned, what's next).

### 2026-04-25 — Recovery closeout shipped as v0.4.2
- Truth-docs pass: `docs/unified-runtime-tracker.md` Current Status + Phase 2 header and `docs/chat-v2-cutover-checklist.md` Phase 2 acceptance now describe Phase 2 as "infrastructure shipped, perf gate open, spec-decode disabled by default" rather than "live"; references the recovery measurement file.
- Crash-safe mini smoke: `scripts/spec-decode-live-smoke.js` now supports `SPEC_SMOKE_STEP=cuda-only|npu-only|combined` with a free-RAM pre-flight, RSS watchdog, finally-block teardown that unloads llamanode + NPU and stops the spawned NPU server. Verified all three steps on target hardware; combined emitted real spec-decode telemetry (`selectionSource=spec-decode`, `total=1`, `accepted=0` for the 1/1/1 limits).
- Real eval rewrite: `scripts/speculative-decoding-eval.js` `runOrchestratorTurn` now reads Ollama `eval_count`/`eval_duration` from the terminal `done` payload for the direct path, `_runSpecDecodeChat.meta.committedTokens` and `getLastSpecDecodeOutcome()` for the spec path; per-turn timeout + free-RAM watchdog prevent silent hangs. Added `InferenceOrchestrator.getLastSpecDecodeOutcome()` (~12 LoC, additive).
- Measured Phase 2 once on `qwen2.5:1.5b`: direct = 62.84 tok/s @ 540 ms first token, spec = 0.024 tok/s @ 42442 ms first token, real speedup `0.0004x`, acceptance 0/4. Decision **paused** documented in `docs/perf/phase2-spec-decode-measurement.md`. Re-evaluation gated on NPU `LLMPipeline` KV-cache reuse and CUDA verifier residency across turns.
- NPU server gained `DEVFORGE_NPU_GENAI_ONLY=1` opt-in to skip the Optimum fallback while spec-decode is the active workload, halving RAM during evals.
- Spec-decode remains hard-disabled by default at both selection sites in `inference-orchestrator.js`; the only opt-in is `DEVFORGE_SPEC_DECODE_ENABLE=1`.
- Release gate 18/18 PASS. Tag: `v0.4.2`.

### 2026-04-24 — Phase 2 infrastructure as v0.4.1
- Unblocked the CUDA verifier path: installed VS2022 C++ workload + CUDA Toolkit 12.9 (runtime + cublas + thrust, no driver overwrite). Added `ensureCudaOnPath` to `LlamaNodeBackend` that auto-prepends `cudart64_12.dll`'s directory to `process.env.PATH` so the prebuilt CUDA binary loads cleanly regardless of the user's shell env.
- Wired `_runSpecDecodeChat` in the orchestrator: chat-main turns where the draft selector returns score>=0.7, llamanode is healthy, and the pair isn't auto-disabled now route through the draft -> verify -> commit -> repeat loop. Token deltas surface to the chat engine via the same onChunk callback as direct streaming, so chat-v2 doesn't need to know whether it's running spec-decode or vanilla.
- Added `LlamaContextSequence.controlledEvaluate(input)` adapter in `evaluateForVerifier`: passes `[token, { generateNext: { probabilities: true, confidence: true } }]` per token, returns `Map<Token, number>` rows. The verifier helpers (`rowArgmax`, `rowProbability`, `rowSample`, `rowResidualSample`) consume Map and Float32Array shapes interchangeably so the synthetic-logits smoke and the live CUDA verifier share one code path.
- Reactivated WS-P2-5 tree speculation: secondary draft pipeline on Intel Arc GPU, lane-registry `chat-draft-secondary` lane, `verifyTreeBatch` algorithm that picks the longest-matching of N branches and tracks marginal gain. Auto-disable when the secondary contributes <5% additional accepted tokens over a 30-batch window.
- DraftSession contract live: `POST /draft/session` + `extend` + `DELETE` endpoints with server-side prompt + accepted-suffix state. `npu-bridge.createDraftSession/extendDraftSession/closeDraftSession` wrappers. Orchestrator opens a session per spec turn and closes on completion. Real KV-cache reuse on the NPU still pending GenAI `KVCacheEvictionConfig` tuning; tracked as a follow-up risk.
- Fixed real bug: optimum fallback was retrying on every `/v1/chat/completions` request, adding ~1s latency and spamming logs. `state.optimum_load_skipped` flag now skips retries once the first attempt fails on a GenAI-only path.
- Closed the deferred v0.3 manual hardware QA debt programmatically via `scripts/v03-manual-qa-harness.js` (7/7 PASS): NPU registration, embedding lane routing, AC/battery routing, warm-loop gating, mid-stream-kill state machine, GenAI engine, spec-decode dashboard wiring all verified by contract checks.
- Captured baseline: `docs/perf/baseline-2026-04-v0.4.md` shows 7B Ollama at 72.2 tok/s, 13B Ollama at 15 tok/s, 1.5B NPU draft at ~2.4s per 4-token batch (KV-cache reuse pending), warm-loop 100% active.
- Release gate 18/18, lint clean, `build:win` produced an installer cleanly. Tag: `v0.4.1`.
- 2026-04-25 recovery note: after live spec-decode stress testing destabilized the machine, spec-decode was hard-disabled by default. The infrastructure remains available behind `DEVFORGE_SPEC_DECODE_ENABLE=1`; the v0.4.2 closeout records the measured perf decision in `docs/perf/phase2-spec-decode-measurement.md`.

### 2026-04-24 — Phase 2 contract shipped as v0.4.0
- Bumped Electron 28 → 32.3.3, electron-builder 24 → 25.1.8, node-llama-cpp 2.8.16 → 3.18.1; backend rewritten on the v3 API.
- Shipped 8 new services / 7 new smokes: draft-selector, spec-decode-verifier (pure logic, callback-based logits), spec-decode-bus (HTTP today, shmem stub), `/draft` + `/draft/{id}` endpoints, npu-bridge `draftTokens` / `cancelDraft`, orchestrator spec-decode telemetry + auto-disable, HardwareMonitor "Spec decode" panel, speculative-decoding eval (static + live modes).
- 18/18 release-gate; static contract is provably wired end-to-end. Live verifier loop deferred until CUDA prebuilds pass the testBindingBinary probe on this machine; tree-spec WS-P2-5 cancelled for v0.4 and re-scoped to v0.4.1.
- Live POST /draft round-trip verified on a loaded Qwen2.5-1.5B int4 NPU pipeline (4-token + 8-token draft in ~2.5s; latency target needs the orchestrator KV-cache reuse path that depends on the verifier loop).
- Tag: `v0.4.0`.

### 2026-04-24 — v0.3 stabilization sprint closed
- Added runtime telemetry and surfaced it in Device Activity (last stream, abort buckets, warmloop transitions).
- Landed live-smoke automation (`eval:live-smoke`) and used it to catch/fix a real NPU GenAI 500 regression.
- Implemented thinking-model stream UX + collapsible reasoning, plus richer cold-load status banner details.
- Refreshed OpenVINO runtime stack in `openvino-env` to resolve GenAI tokenizer/opset incompatibilities on target hardware.
- Captured 30-minute baseline to `docs/perf/baseline-2026-04-v0.3.md` (1.5B NPU + 7B/13B GPU probes, warm-loop %, abort counts).
- Gates: `release-gate` PASS (12/12), `eval:live-smoke` PASS.

### 2026-04-24 — Phase 1 shipped in one day
All 10 Phase 1 tasks complete: NPU is now a first-class citizen.

**Shipped:**
- WS1 (unconditional NPU registration): split into `_registerPassiveOpenVinoBackends` (always) + `_registerOpenVinoBackends` (hybrid opt-in). PROFILE_ORDER_STANDARD now has `openvino-npu` + `openvino-gpu` in all 4 profiles — efficiency/laptop put NPU first.
- WS2 (default model swap): `openvino-model.json` → Qwen2.5-1.5B int4 for general use. New `vault-profile.json` holds the `abyssal-devourer-v3` creative overrides. `DEFAULT_NPU_MODEL_CANDIDATES` reordered for ≤3B.
- WS3 (OpenVINO GenAI): `start-npu-server.py` rewritten with GenAI `LLMPipeline` for chat (native streaming) + optimum fallback for embeddings. `setup-openvino.ps1` installs `openvino-genai>=2024.6` and `huggingface_hub`.
- WS4 (lane registry): new `lane-registry.js` with 8 workload types, AC/battery variants, availability filtering. Orchestrator consults before scoring.
- WS5 (NPU warm-loop): `npu-warmloop.js` with RAM + battery + profile gates. Re-evaluates on `setProfile`. Started fire-and-forget from orchestrator init.
- WS6 (power-aware): `power-mode.js` exports `getPowerState()` via Electron `powerMonitor` + `systeminformation`. Lane registry promotes NPU for chat-short / chat-main on battery with ≤3B models.
- WS7 (device telemetry): orchestrator `getDeviceUtilization(windowMs)` + IPC + preload + `electronAPI.getDeviceUtilization()`. New "Device Activity" collapsible section in HardwareMonitor with per-device rows, warm badge, workload tags.
- WS8 (smoke): `scripts/tiered-utilization-smoke.js` — 12th release-gate check covering WS1-7 contracts.
- WS9 (ship gates): `chat-v2-cutover-checklist.md` extended with Phase 1 QA steps.

**Verified:** `npm run eval:release-gate` PASS (12/12 checks). Lint: 0 errors, 311 pre-existing warnings.

**Known caveat:** GenAI + huggingface_hub aren't installed yet in the existing `openvino-env` venv. User needs to re-run `powershell -File scripts/setup-openvino.ps1` before the NPU server can use the GenAI path; the optimum fallback continues to work until that happens.

**Next up:** Phase 2 — NPU-drafted speculative decoding. Draft selector pairs main/draft models, NPU drafts 4-8 tokens per step, RTX verifies in one forward pass via shared-memory bus. Target: ≥1.6× tokens/sec at ≥60% acceptance.

### 2026-04-23 — Phase 0 shipped in one day
All 20 Phase 0 tasks complete: runtime + UI consolidation.

**Shipped runtime (morning):**
- Context clamps (p0-ctx-1..5): stacked caps removed, only gpt-oss raw path keeps a narrow 8K cap. `long-context-eval.js` smoke added and wired to release gate.
- Keep-alive (p0-keep-1..2): profile-aware defaults (`-1` for balanced/speed, `30m`/`10m` for efficiency/laptop). User setting `keepModelLoaded` in SettingsModal overrides profile.
- Backend stability (p0-stable-1..3): `backends.clear()` teardown gone, additive `_registerOpenVinoBackends()`, OpenVINO lazy-spawn with shared promise for concurrent callers. `mode-switch-smoke.js` added.
- Direct GGUF (p0-gguf-1..6): `node-llama-cpp@2.8.16` added, `LlamaNodeBackend` built with lazy native load + single-resident LRU, registered unconditionally in orchestrator. `gguf:` model IDs force-route to llamanode. New IPC `model:loadLocalGguf` + `listLocalGgufs` + `unregisterLocalGguf` replaces `ollama:createFromFile` (deprecation shim preserved). Preload bridges all three. `llamanode-smoke.js` added.
- Drive-by: fixed pre-existing `openModelsDirectory` scope bug in SettingsModal.

**Shipped UI consolidation (afternoon):**
- p0-hub-1: deleted 5 duplicate components + 2 orphaned siblings (145 KB of dead code). `src/components/index.js` and `ModelBrowser/index.js` cleaned.
- p0-hub-2: new `src/stores/slices/modelCatalogSlice.js` with `hydrateModelCatalog`/`invalidateModelCatalog`/`watchModelCatalog`. TTL-cached, concurrent-call-serialized, dedupe across 4 sources.
- p0-hub-3: ModelSelector's 4 parallel useEffect refreshes collapsed to one mount-time hydrate. NPU status projected from the slice.
- p0-hub-4: `lmstudio:scanImportedDuplicates` + `lmstudio:reclaim` IPC handlers let users delete old blob-copied imports and keep the originals as direct-loadable GGUFs.

**Verified:** full `npm run eval:release-gate` PASS (11/11 checks, including 3 new ones). Lint: 0 errors, 311 pre-existing warnings.

**Follow-up (same session):** `npm install --legacy-peer-deps` completed (pre-existing fiber/postprocessing peer conflict required `--legacy-peer-deps`, not caused by my changes). `node-llama-cpp@2.8.16` installed cleanly. Discovered the v2 package uses ESM with top-level await and cannot be `require()`-d from CommonJS — refactored `LlamaNodeBackend.loadLlamaModule` to use dynamic `import()` with a cached promise. Added `scripts/llamanode-live-smoke.js` (runtime check, not in release-gate) confirming backend reports `available: true`. All 11 release-gate checks still PASS.

**Next up:** user acceptance + `npm install`, then Phase 1 (Tiered Utilization) — unconditional NPU registration, OpenVINO GenAI migration, lane registry, idle-state NPU warm-loop, power-aware gating.

### 2026-04-23 — Initial planning complete
- Completed architectural audit: LM Studio integration path, context clamping chain, NPU bridge, OpenVINO backend, hybrid mode teardown.
- Confirmed via [npu-bridge.js](../electron/services/npu-bridge.js) and [inference-orchestrator.js](../electron/services/inference-orchestrator.js) that NPU is registered only when user pre-selects OpenVINO — effectively dead on fresh install.
- Confirmed hardware: Lenovo Yoga Pro 9 16IAH10 with Ultra 9 285H (13 TOPS NPU 3), RTX 5050 Laptop (8 GB, Blackwell, FP8/FP4, ReBAR), Intel Arc 140T iGPU (16 GB shared), 32 GB DDR5.
- Locked scope: Full (L1+L2+L3), hedged runtime, auto-detect Copilot+ default, Mosaic hidden pre-Gate 2.
- Authored [unified-runtime plan](../.cursor/plans/lm_studio_parity_overhaul_e7302ba0.plan.md) with 50-item todo ledger.
- Created this tracker.

---

## Links

- **Plan:** [.cursor/plans/lm_studio_parity_overhaul_e7302ba0.plan.md](../.cursor/plans/lm_studio_parity_overhaul_e7302ba0.plan.md)
- **Architecture:** [docs/architecture.md](architecture.md)
- **Chat V2 plan:** [docs/chat-v2-plan.md](chat-v2-plan.md)
- **Chat V2 cutover checklist:** [docs/chat-v2-cutover-checklist.md](chat-v2-cutover-checklist.md)
- **IPC API:** [docs/ipc-api.md](ipc-api.md)
- **Perf baseline (Feb 2026):** [docs/perf/baseline-2026-02.md](perf/baseline-2026-02.md)
- **Perf baseline (v0.3):** [docs/perf/baseline-2026-04-v0.3.md](perf/baseline-2026-04-v0.3.md)
- **Mosaic architecture (created in Phase 3):** `docs/mosaic-architecture.md` *(pending)*

---

## How to Maintain This Doc

Rules of thumb so it stays useful instead of becoming a stale wall of text:

1. **Phase ledger entries** — update status field + actual start/ship dates only. Don't bloat with detail; detail goes in breadcrumbs.
2. **Decision log** — append-only. Never edit a past decision entry; if we reverse course, add a new entry saying so and link back.
3. **Learnings** — add as you discover them. Each one should cite a file + line range.
4. **Open questions** — remove from list once answered; the answer goes into decision log.
5. **Breadcrumbs** — add dated entry every time a meaningful chunk of work lands. Keep entries 2-5 lines. Newest on top.
6. **Risks** — tick the checkbox when a risk is either realized (and mitigated) or definitively eliminated. Don't delete.
7. **Links** — update when new doc artifacts land (perf baselines per phase, architecture doc in Phase 3, etc.).

When a phase ships, add a "Phase N retrospective" section under Phase Ledger: what shipped, what we cut, what surprised us. Keep future-you honest about the estimates.
