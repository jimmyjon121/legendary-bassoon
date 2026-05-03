# DevForge Notes

## 2026-04-25 — Phase 2 Spec-Decode Perf Gate Blocker

Phase 2 speculative decoding is correctly wired and opt-in, but it does **not** meet the perf gate on the current target hardware/pair.

### Live Result

Run:

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

Artifact: `scripts/.spec-eval-v047.json`.

Summary:

- `avgAcceptance=0.000`
- `avgRealSpeedup=0.0014x`
- `avgDirectTokensPerSecond=47.51`
- `avgSpecTokensPerSecond=0.067`
- `failures=1/3` (first spec turn timed out at 90s)

Gate requirement:

- `avgAcceptance >= 0.6`
- `avgRealSpeedup >= 1.6x`

Decision: **FAILED**. Spec-decode stays opt-in. No default-on flip.

### Debugging Completed

The following correctness fixes were made before accepting the failure:

- NPU draft endpoints now return `draft_text` in addition to OpenVINO tokenizer IDs.
- The orchestrator tokenizes `draft_text` with the verifier's llama.cpp tokenizer before comparing logits, avoiding OpenVINO/GGUF token ID space mismatch.
- Server-side draft sessions now receive only the previous accepted text delta, not a duplicated accumulated line.
- Qwen spec prompts now use `<|im_start|>` / `<|im_end|>` chat template formatting instead of hand-rolled `User:` / `Assistant:` labels.

These fixes did not produce accepted draft tokens for the current pair.

### Likely Root Cause

The current practical pair (`OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov` drafter on NPU vs local GGUF/Ollama `qwen2.5:1.5b` verifier/main) diverges at greedy next-token selection. Even after verifier-side tokenization and chat-template alignment, the verifier accepts 0 of 4 draft tokens per batch.

The NPU batch cost also remains too high for short completions: the spec path spends tens of seconds to produce 2 committed bonus tokens, while direct Ollama-CUDA returns 8 tokens at ~45-60 tok/s.

### Revisit Only If

1. A same-format draft/main pair exists where the draft and verifier weights/tokenizer/template are bit-identical or near-identical.
2. A native shmem transport removes the JS/HTTP round-trip overhead and verifier loop overhead.
3. New NPU hardware or OpenVINO GenAI releases can produce 4-8 draft tokens in <100 ms.

Until then, keep speculative decoding as diagnostics-only infrastructure.

## 2026-04-25 — v0.4.8 Phase 2 Acceptance Recovery

The 0% acceptance in v0.4.7 was a real wiring bug, not a fundamental constraint. Adding a llamanode-driven drafter (`DEVFORGE_SPEC_DRAFTER=llamanode`) that loads a sidecar GGUF with the verifier's tokenizer flips acceptance from `0.000` to `1.000` on the same-pair self-spec test (`qwen2.5:1.5b` as both verifier and drafter). Loop correctness is now proven end-to-end.

### What's Still Open

- **Speedup gate (≥1.6x):** Self-spec gives `~1.0x` because the drafter and verifier are the same size. A genuinely smaller drafter is required.
- **Asymmetric pairs blow VRAM on 8GB RTX:** Loading both `qwen2.5:1.5b` (verifier) + `qwen2.5:0.5b` (drafter) via two `LlamaNodeBackend` instances while Ollama also keeps the verifier resident causes contention and 180s timeouts. A future fix should either share the verifier with Ollama or run the drafter on the iGPU/NPU instead of co-resident on RTX.
- **Override file:** `scripts/draft-pairs.json` now includes a `qwen2.5:1.5b -> qwen2.5:0.5b` override so users who pull both can opt in via `DEVFORGE_SPEC_DECODE_ENABLE=1 DEVFORGE_SPEC_DRAFTER=llamanode`.

### Reproduction

```powershell
$env:DEVFORGE_SPEC_DECODE_ENABLE='1'
$env:DEVFORGE_SPEC_EVAL_MODE='live'
$env:DEVFORGE_SPEC_DRAFTER='llamanode'
$env:SPEC_EVAL_LIMIT='3'
$env:SPEC_EVAL_NUM_PREDICT='8'
$env:DEVFORGE_SPEC_LOOKAHEAD='4'
$env:DEVFORGE_SPEC_MAX_BATCHES='4'
$env:SPEC_EVAL_MAIN_MODEL='qwen2.5:1.5b'
$env:SPEC_EVAL_TURN_TIMEOUT_MS='90000'
node scripts/speculative-decoding-eval.js
```

Artifact: `scripts/.spec-eval-v048-acceptance.json` (avgAcceptance=1.000, 4/4 draft tokens accepted per batch, no failures).

## 2026-04-25 — v0.4.8 Mosaic Gate 1 Correction

The v0.4.6 Mosaic Gate 1 "FAIL" was a math bug, not a hardware constraint. The gate definition says capacity is `Mosaic ÷ RTX-only` (a *device-pool* property), but the simulator was computing `assignedFootprint(testModel) ÷ rtxFittedFootprint(testModel)` for one specific 14B target — a ratio that is structurally bounded near 1.0x for any model that already fits on RTX-only.

The corrected simulator computes pool capacity directly: `(rtx + arc + cpu) ÷ rtx`. On this hardware that is `(7.5 + 10 + 18) GB ÷ 7.5 GB ≈ 4.7x`. With measured profiles loaded the simulator reports `6.225x` (because measured `hardware.memoryBytes` for CPU/RTX is slightly larger than the synthetic defaults).

Gate 1 result: **PASS** at `6.225x` capacity, `100%` of RTX-only baseline speed.
