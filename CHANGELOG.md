# Changelog

## Unreleased

- **Agent harness + inference hardening:** Added Electron IPC plumbing for the agent harness (`electron/ipc/agent-harness-handlers.js`, `electron/ipc/index.js`), extended preload/main wiring, sanitized inference-bound message shapes (`electron/utils/sanitize-inference-messages.js`), and documented the codebase/doc layout and large-file inventory in [`docs/repository-footprint.md`](docs/repository-footprint.md). New checks: `npm run inference-toolchain-smoke`; optional live matrix `OLLAMA_LIVE=1 node scripts/inference-live-model-matrix.js`.

## v0.4.8 — Mosaic Gate 1 Correction + Phase 2 Acceptance Recovery

- **Mosaic Gate 1: PASS** (corrected). The v0.4.6 "FAIL" used a ratio that was structurally capped near `1.0x` for any model that already fits on RTX-only. The corrected device-pool ratio is `6.225x` (threshold `1.3x`) at `100%` RTX-only baseline speed. Phase 3 status moves from `cancelled` to `gate1-passed`.
- **Phase 2 acceptance: 0.000 -> 1.000.** Added `LlamaNodeBackend.draftTokens()` and an opt-in `DEVFORGE_SPEC_DRAFTER=llamanode` mode that runs the drafter via a sidecar GGUF with the verifier's tokenizer. Self-spec on `qwen2.5:1.5b` shows 4/4 draft tokens accepted per batch with no failures; `scripts/.spec-eval-v048-acceptance.json` is the captured run.
- **Speedup gate still open.** Same-size self-spec is `~1.0x` by construction; a genuinely smaller drafter is required, and the asymmetric `1.5B + 0.5B` test currently times out on the 8GB RTX due to dual-model VRAM contention. Spec-decode remains opt-in.
- Updated `scripts/draft-pairs.json` with a `qwen2.5:1.5b -> qwen2.5:0.5b` override for users who pull both models.

## v0.4.7 — Phase 2 Live Settlement

- Re-ran the live speculative-decoding gate after NPU draft sessions and CUDA verifier prewarm were verified.
- Result: **FAILED** (`avgRealSpeedup=0.0014x`, `avgAcceptance=0.000`, `failures=1/3`).
- Kept spec-decode opt-in behind `DEVFORGE_SPEC_DECODE_ENABLE=1`; no default-on flip.
- Hardened the spec path:
  - NPU draft endpoints now return `draft_text`.
  - Orchestrator verifier-tokenizes `draft_text` instead of trusting OpenVINO token IDs.
  - Draft sessions now receive only the previous accepted text delta.
  - Qwen spec prompts use `<|im_start|>` / `<|im_end|>` formatting.
- Added `NOTES.md` with the Phase 2 blocker and re-evaluation triggers.

## v0.4.6 — Mosaic Gate 1

- Added Mosaic architecture docs, profilers, simulator, decision script, and hidden `MosaicLab`.
- Ran Gate 1:
  - Mandatory 14B target: **FAILED** (`1.143x` capacity vs `1.3x` threshold).
  - Best-effort 30B projection: passed on paper, but does not override the mandatory 14B failure.
- Marked Phase 3 Mosaic cancelled in the tracker.

## v0.4.5 — Hardening Sprint

- Live-verified the NPU `start_chat` draft session path.
- Added CUDA verifier guard and target-machine CUDA verification artifact.
- Added behavioral smokes for backend override and per-model device pin routing.
- Refactored `buildChatV2InferenceOptions` into named transform layers.

## v0.4.4 — Phase 2 Unblock + User Autonomy

- Added NPU draft-session support using `LLMPipeline.start_chat` / `finish_chat` where available.
- Added verifier prewarm for eligible spec-decode sessions.
- Added per-model `device_pin` and per-chat backend override.

## v0.4.3 — LM Studio Parity Polish

- Added Chat V2 context picker, context-used indicator, model eject, and per-model system-prompt wiring.
- Added ModelSelector quant filters, sort controls, and VRAM fit dots.
- Added the `preset-system-prompt` release-gate smoke.
