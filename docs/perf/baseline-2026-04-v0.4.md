# v0.4.1 baseline (2026-04-24)

Captured by `node scripts/v04-baseline-session.js` against the live NPU server + Ollama running on the target machine. Steady-state mode (one full probe pass plus 5 warm-loop samples; total wall time ~1 minute). Long-window mode (`BASELINE_DURATION_MIN=30`) is available when a real-user 30-minute session evidence is needed; the steady-state numbers are sufficient for the v0.4.1 ship.

## Per-probe model performance

| Probe | Model | Engine | Device | First token | Total | Tok/s |
|-------|-------|--------|--------|-------------|-------|-------|
| 1.5B NPU | `openvino-local` (Qwen2.5-1.5B-Instruct int4) | GenAI | NPU | n/a (non-stream probe) | 37.9 s | 1.3 |
| 7B RTX | `codellama:7b` | Ollama | RTX 5050 (CUDA) | 3.4 s | 5.9 s | 72.2 |
| 13B RTX | `local-wizard-vicuna-13b-uncensored.q4_0` | Ollama | RTX 5050 (CUDA, partial offload) | 5.7 s | 7.0 s | 15.0 |

The 1.5B NPU probe uses `/v1/chat/completions` (non-streaming, max_tokens=120) and reports raw end-to-end latency, so the tok/s number is dominated by NPU prefill rather than streaming throughput. For draft-only workloads the relevant numbers are the spec-decode rows below.

## Spec-decode draft latency

| Path | Latency | Tokens | Device |
|------|---------|--------|--------|
| Cold draft (`/draft` stateless) | 2394 ms | 4 | NPU |
| Warm extend (`/draft/session/.../extend`) | 2364 ms | 4 | NPU |

Cold and warm latency are essentially identical because OpenVINO GenAI's `LLMPipeline.generate()` re-prefills on every call regardless of session-level state on the Python side. The session API's "warm" path reduces network/JSON overhead but doesn't yet reuse the NPU KV cache across calls; that requires `KVCacheEvictionConfig` tuning that lives in the v0.4.x follow-up tracker. Documented as the **"Spec-decode KV-cache reuse"** risk register entry.

## Warm-loop steady state

| Metric | Value |
|--------|-------|
| Sample count | 5 |
| Sample interval | 1000 ms |
| Warm-loop active | 5/5 (100%) |

Warm-loop only changes state on profile / battery / RAM-pressure events; a steady-state probe is sufficient evidence that the loop is healthy under nominal conditions.

## Abort counts

None observed during this session.

## Notes

- CUDA prebuild for `node-llama-cpp@3.18.1` now loads cleanly: `LlamaNodeBackend` auto-injects `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9\bin` onto `PATH` on first `getLlama()` call, so the prebuilt CUDA runtime DLL `cudart64_12.dll` is found regardless of the user's shell env. Validated by `node scripts/cuda-probe-via-backend.mjs`: `gpu: cuda` reported with 8.5 GB total VRAM on the RTX 5050.
- The Phase 2 verifier loop is now actually live — `_runSpecDecodeChat` in `inference-orchestrator.js` will route eligible chat-main turns through the draft -> verify pipeline. Live tokens/sec speedup measurement (the master plan's >=1.6x gate) requires running real chat through the loop and is captured by `eval:spec-decoding` in live mode; the in-process verifier can now actually run.

