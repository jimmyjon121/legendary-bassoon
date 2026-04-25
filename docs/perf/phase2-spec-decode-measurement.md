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
node scripts/speculative-decoding-eval.js 1>scripts/.spec-eval-ramp1.json 2>&1
```

The eval enforces a per-turn timeout and a free-RAM watchdog; if either
trips, the script exits non-zero with a clear message rather than
hanging.
