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
