# Phase 2 Speculative-Decode Measurement (v0.4.2)

Recovery closeout for the LM-Studio-parity / Unified-Inference-Fabric Phase 2
work. This file replaces the documentation claim that Phase 2 was "live"
with the actual numbers measured on target hardware.

## Setup

- **Date:** 2026-04-25
- **Machine:** Lenovo Yoga Pro 9 16IAH10 (Ultra 9 285H, RTX 5050 Laptop, Intel Arc 140T iGPU, Intel NPU 3, 32 GB DDR5)
- **OS:** Windows 11 Home 26200
- **Branch / commit:** `wip/mac-handoff-2026-02-13` @ `c06d877152518b9c17179bd1228522812e316b2f`
- **Main model (direct path):** `qwen2.5:1.5b` via Ollama on CUDA
- **Verifier model (spec path):** GGUF blob `sha256-183715c4...8a5b4` via `node-llama-cpp` on CUDA 12.9
- **Drafter model (spec path):** `OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov` via OpenVINO GenAI on NPU
- **Lookahead:** 1
- **Max spec batches per turn:** 1
- **`num_predict`:** 4
- **Prompt limit:** 1
- **Spec-decode safety gate:** `DEVFORGE_SPEC_DECODE_ENABLE=1` (off by default)
- **NPU memory pressure guard:** `DEVFORGE_NPU_GENAI_ONLY=1` (skips Optimum fallback to keep RAM headroom)

The 3-prompt and 10-prompt ramps from the recovery plan were intentionally
skipped: the 1-prompt result already met the `paused` decision criterion
(`avgRealSpeedup <= 1.0`) by a wide margin and the larger ramps would only
extend wall time without changing the conclusion.

## Raw measurement (orchestrator telemetry, not proxies)

Output file (committed for traceability): [`scripts/.spec-eval-ramp1.json`](../../scripts/.spec-eval-ramp1.json)
Raw mixed stdout/stderr log: [`scripts/.spec-eval-ramp1.log`](../../scripts/.spec-eval-ramp1.log)

`perPrompt[0]` (the entire measured set):

```json
{
  "kind": "coding",
  "lookahead": 4,
  "directTokensPerSecond": 62.83972727558362,
  "specTokensPerSecond": 0.023561566372932472,
  "directFirstTokenMs": 540,
  "specFirstTokenMs": 42442,
  "directTokens": 4,
  "specTokens": 1,
  "directTokenSource": "ollama-eval-count",
  "specTokenSource": "spec-meta-committed",
  "realSpeedup": 0.0003749469864756609,
  "acceptance": 0,
  "accepted": 0,
  "drafted": 4,
  "specPathTaken": true,
  "directSelectionSource": "preferredBackend",
  "specSelectionSource": "spec-decode"
}
```

## Aggregates

| Metric                     | Value      |
|----------------------------|------------|
| Prompts measured           | 1 / 1      |
| Failures                   | 0          |
| `avgAcceptance`            | 0.000      |
| `avgDirectTokensPerSecond` | 62.84      |
| `avgSpecTokensPerSecond`   | 0.024      |
| `avgRealSpeedup`           | 0.0004x    |

The direct number (62.84 tok/s, 540 ms first token) is sourced from
Ollama's terminal `eval_count` / `eval_duration` payload. The spec
number is sourced from `_runSpecDecodeChat`'s `meta.tokensPerSecond` and
the per-batch acceptance is sourced from
`InferenceOrchestrator.getLastSpecDecodeOutcome()` — both are real
orchestrator-side counters, not output-length proxies.

## Decision: `paused`

Per the recovery plan's `WS5` decision matrix:

- `avgRealSpeedup` (`0.0004x`) is well below the `1.0x` floor, so the
  default selection-site flip stays disabled.
- `accepted` was 0 of 4 drafted tokens on this single batch. Auto-disable
  did not trip yet (the rolling window threshold needs at least 5 samples)
  but a population of acceptance-rate-zero turns would trip it within a
  handful of additional turns.
- `specFirstTokenMs = 42442` shows the cold-load amortization problem
  documented in the runtime tracker: each draft request re-prefills the
  GenAI pipeline because `LLMPipeline.generate` does not yet share KV
  state across calls, and `node-llama-cpp` cold-loads the verifier GGUF
  at the moment the orchestrator picks the spec path.

**Action:** keep the existing implementation in place but leave the
`DEVFORGE_SPEC_DECODE_ENABLE=1` opt-in. Document the path as paused
infrastructure, not a shipping feature, until the re-evaluation triggers
fire.

## Re-evaluation triggers

Spec-decode should be measured again when at least one of the
following lands; the next pass should redo the 1 / 3 / 10 prompt ramp
captured by `scripts/speculative-decoding-eval.js`:

1. **NPU KV-cache reuse on `LLMPipeline.generate`.** Current draft
   latency dominates the loop; reusing the prefill cache is the single
   highest-impact change.
2. **CUDA verifier residency across turns.** Right now the orchestrator
   loads the GGUF on first spec turn and unloads it; the cold load alone
   blows the 1.6x perf gate.
3. **A draft pair where the draft tokenizer is provably the same as the
   main tokenizer at the byte level**, so acceptance is bounded by the
   draft model's calibration rather than tokenizer skew.

## How to reproduce

```powershell
$env:SPEC_EVAL_LIMIT='1'
$env:SPEC_EVAL_NUM_PREDICT='4'
$env:DEVFORGE_SPEC_LOOKAHEAD='1'
$env:DEVFORGE_SPEC_MAX_BATCHES='1'
$env:DEVFORGE_SPEC_DECODE_ENABLE='1'
$env:DEVFORGE_SPEC_EVAL_MODE='live'
$env:SPEC_EVAL_MAIN_MODEL='qwen2.5:1.5b'
$env:DEVFORGE_NPU_GENAI_ONLY='1'
$env:SPEC_EVAL_TURN_TIMEOUT_MS='90000'
$env:SPEC_EVAL_MIN_FREE_RAM_GB='3.5'
node scripts/speculative-decoding-eval.js 1>scripts/.spec-eval-ramp1.log 2>&1
```

The committed JSON artifact is the extracted final telemetry payload from
that raw log, kept parseable for tooling and indexers.

The eval enforces a per-turn timeout and a free-RAM watchdog; if either
trips, the script exits non-zero with a clear message rather than
hanging.

## 2026-04-25 — v0.4.3 ship + Phase 2 unblock landed

- v0.4.3 (LM Studio parity polish) shipped without changing any spec-decode
  inputs, so the v0.4.2 baseline above stayed authoritative.
- v0.4.4 lands the two re-evaluation triggers from this doc:
  1. **NPU KV-cache reuse** — `scripts/start-npu-server.py` now calls
     `pipe.start_chat()` on `/draft/session` and feeds only the accepted
     delta into `pipe.generate(...)` on each `/draft/session/{id}/extend`.
     `pipe.finish_chat()` runs on session close. The path falls back to
     the full-prompt generate when the installed `openvino-genai` build
     does not expose `start_chat`, so older environments keep working.
  2. **Verifier prewarm across turns** —
     `InferenceOrchestrator.prewarmSpecDecodeVerifier(mainModel)` loads the
     llamanode verifier GGUF as a fire-and-forget on chat session start
     when the model has a curated draft pair. `loadModel` is already
     idempotent (`backends/llamanode-backend.js:219-223`), so first-turn
     cold-load is amortized into session warmup instead of stream latency.
- The next live measurement run should be done after v0.4.4 ships,
  reusing the same `SPEC_EVAL_LIMIT=1` reproduction recipe above. The
  `paused` decision stays in place until that run shows
  `avgRealSpeedup >= 1.0` on at least one prompt — at which point the
  ramp 1 / 3 / 10 in the recovery plan resumes and the orchestrator's
  selection-site flip flips back to default-on.

## 2026-04-25 — v0.4.5 hardening live verification

Live verification reached /draft/session and two /extend calls. chat_mode_active=true, second generate_mode=delta. See [phase2-unblock-live.md](phase2-unblock-live.md).

## 2026-04-25 — v0.4.7 Phase 2 perf gate FAILED (settlement)

Live re-run of `npm run eval:spec-decoding` against the v0.4.4 NPU `start_chat` delta path and v0.4.6-verified CUDA verifier prewarm.

- **Reproduction recipe** (PowerShell):

```powershell
$env:DEVFORGE_SPEC_DECODE_ENABLE='1'
$env:DEVFORGE_SPEC_EVAL_MODE='live'
$env:SPEC_EVAL_LIMIT='3'
$env:SPEC_EVAL_NUM_PREDICT='8'
$env:DEVFORGE_SPEC_LOOKAHEAD='4'
$env:DEVFORGE_SPEC_MAX_BATCHES='2'
$env:SPEC_EVAL_MAIN_MODEL='qwen2.5:1.5b'
$env:DEVFORGE_NPU_GENAI_ONLY='1'
$env:SPEC_EVAL_TURN_TIMEOUT_MS='90000'
$env:SPEC_EVAL_MIN_FREE_RAM_GB='3.5'
node scripts/speculative-decoding-eval.js
```

- **Measurement artifact:** [`scripts/.spec-eval-v047.json`](../../scripts/.spec-eval-v047.json) (committed for traceability).
- **Aggregates:**
  - `promptsTotal=3`, `promptsMeasured=2`, `failures=1`.
  - `avgAcceptance=0.000` (gate `>= 0.60`).
  - `avgDirectTokensPerSecond=47.51`.
  - `avgSpecTokensPerSecond=0.067`.
  - `avgRealSpeedup=0.0014x` (gate `>= 1.6x`).
- **Per-prompt notes:**
  - Prompt 1: `orchestrator.stream(spec) timeout after 90000ms` while loading the verifier on the first spec turn.
  - Prompts 2 and 3: spec path returned only the verifier's bonus tokens; 0 of 4 drafted tokens accepted in either batch. Spec first-token cost was 28.7 s and 31.3 s respectively, dominated by NPU draft latency plus per-call verifier evaluation overhead.
- **Honest read:**
  - The v0.4.4 unblock and v0.4.5/.6 CUDA verifier prewarm did move the needle vs the v0.4.2 baseline (cold-load 42 s to warm 28 s on the first surviving turn), but the dominant cost has shifted from cold-load to per-token round-trips: the JS-side verifier loop plus NPU `pipe.generate` per batch costs more wall time than Ollama-CUDA spends generating the same 8 tokens directly.
  - Acceptance stayed at 0% with the curated `qwen2.5:1.5b -> qwen2.5:1.5b` pair. Empirically the Ollama GGUF main model and the OpenVINO INT4 NPU drafter diverge often enough at greedy temperature that no draft tokens match the verifier's argmax over short batches. Improving acceptance would require either (a) a same-format draft/main pair where weights are bit-exact, or (b) a stochastic verifier with shared sampling state.
- **Decision:**
  - Phase 2 perf gate (`avgRealSpeedup >= 1.6x` at `avgAcceptance >= 0.6`) is **NOT MET**.
  - Spec-decode stays opt-in via `DEVFORGE_SPEC_DECODE_ENABLE=1`. No default-on flip.
  - Phase 2 is recorded as `infrastructure shipped, perf gate failed`. The contract gates remain green; the experimental path remains available for users who want to investigate alternative pairs or future hardware.
- **Re-evaluation triggers:**
  1. A draft/main pair that shares weights bit-exact (e.g., a Qwen2.5 1.5B Q4 GGUF drafter loaded via llamanode against the same GGUF used as the verifier).
  2. A native shmem spec-bus transport that removes JS-side per-call latency.
  3. Faster hardware where NPU `pipe.generate` for a 4-8 token batch costs <100 ms instead of ~2.5 s.

## 2026-04-25 — v0.4.8 acceptance recovered with llamanode drafter

The v0.4.7 0% acceptance was caused by the OpenVINO NPU drafter and the llama.cpp verifier disagreeing on token ids / greedy next-token choices. v0.4.8 adds an opt-in `DEVFORGE_SPEC_DRAFTER=llamanode` mode that loads the draft GGUF through `LlamaNodeBackend` and drafts in the verifier's tokenizer space.

- **Self-spec artifact:** [`scripts/.spec-eval-v048-acceptance.json`](../../scripts/.spec-eval-v048-acceptance.json).
- **Result:** `avgAcceptance=1.000`, `failures=0`, `promptsMeasured=3`.
- **Speed:** `avgRealSpeedup=0.019x` for same-size self-spec (`qwen2.5:1.5b` as both verifier and drafter), so the speedup gate still does **not** pass.
- **Asymmetric attempt:** `qwen2.5:1.5b` verifier + `qwen2.5:0.5b` drafter times out on the current 8GB RTX when both llama.cpp contexts compete with Ollama residency. The token loop is now correct; the next bottleneck is resident memory/topology.
- **Decision:** Phase 2 moves from "acceptance broken" to "acceptance proven, speedup unresolved." Spec-decode remains opt-in; a future pass should focus on a smaller drafter that does not co-reside on RTX with the verifier, or on a shared-process verifier/drafter context that avoids duplicating the main model.
