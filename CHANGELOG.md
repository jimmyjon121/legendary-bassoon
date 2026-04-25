# Changelog

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
