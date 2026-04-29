# Mosaic Runtime Architecture (Gate 1)

Mosaic is the Phase 3 R&D path for deciding whether DevForge should build a custom multi-device coordinator that can place model layers across the RTX 5050 Laptop GPU, Intel Arc 140T iGPU, Intel NPU 3, CPU, and pinned system RAM. Gate 1 is deliberately a simulator gate: no runtime is promoted until measured profiles project enough capacity and enough speed.

## LM Studio Quality Bar

Mosaic is not allowed to make the daily app feel experimental. Normal chat,
model selection, direct GGUF loading, context controls, model eject/unload,
per-model system prompts, backend overrides, streaming stability, and fallback
behavior must remain at LM Studio quality while Mosaic stays hidden behind
`DEVFORGE_MOSAIC_DEV=1` and `DEVFORGE_MOSAIC_ENABLE=1`.

Any Mosaic failure must either stay inside dev-only diagnostics or fall back to
the existing runtime without changing normal backend routing. Speculative
decoding remains a separate opt-in path behind `DEVFORGE_SPEC_DECODE_ENABLE=1`.

## Gate 1 Decision Rule

Gate 1 **passes** only when the simulator projects both:

- **Capacity:** effective model footprint >= `1.3x` the largest model footprint that fits on RTX-only partial offload.
- **Speed:** predicted decode throughput >= `50%` of the RTX-only baseline throughput for the same target model.

If either threshold fails, Phase 3 is cancelled per the tracker. The implementation may still keep profiler and simulator artifacts for future research, but no native coordinator work begins.

## Device Roles

| Device | Intended role | Notes |
| --- | --- | --- |
| RTX 5050 Laptop | Primary verifier / hot layers | Fastest decode device; 8 GB VRAM; ReBAR can read pinned system RAM. |
| Intel Arc 140T iGPU | Secondary layer pool | Shared system memory, OpenVINO/Vulkan path. |
| Intel NPU 3 | Draft/small-layer helper only | 13 TOPS, does not host 14B/30B verifier layers. |
| CPU + DDR5 | Cold / overflow layers | Slow but high-capacity fallback. |
| ReBAR transfer path | System RAM to RTX movement | Transfer profile bounds how expensive off-device layers are. |

## Profile Schema

Each profile under `docs/perf/mosaic/` is JSON:

```json
{
  "schemaVersion": 1,
  "device": "rtx",
  "model": "qwen2.5-coder:14b",
  "createdAt": "2026-04-25T00:00:00.000Z",
  "hardware": {},
  "prefillMsPerLayer": [1.2],
  "decodeMsPerLayer": [0.8],
  "memBytes": [220000000],
  "throughputTokensPerSecond": 28.4,
  "runMeta": {
    "source": "live",
    "samples": [],
    "error": null
  }
}
```

`profile-rebar.json` uses the same envelope with `device: "rebar"` and stores transfer bandwidth in `runMeta.bandwidthGBps`.

## Simulator Model

The simulator treats a model as evenly sized decoder layers. It combines measured per-layer device costs with device memory limits, greedily assigns layers to the cheapest feasible device, then refines via a small dynamic-programming pass over device memory buckets. The output contains:

- `assignment`: count of layers per device.
- `predictedTps`: decode throughput estimate.
- `predictedFirstTokenMs`: prefill estimate.
- `capacityMultiplier`: projected footprint vs RTX-only baseline capacity.
- `baseline`: RTX-only baseline details.
- `decision`: `pending`, `pass`, or `fail`.

## Hidden UI

`src/components/Dev/MosaicLab.jsx` is a read-only diagnostic panel. It is rendered only with `DEVFORGE_MOSAIC_DEV=1` or `VITE_MOSAIC_DEV=1`, and it reads profile/decision artifacts through dev-only IPC. It is not a user-facing runtime surface.

## Post-Gate Work

Gate 1 passed in v0.4.8, so Phase 3 proceeds as a hidden MVP. The coordinator
language is Rust `napi-rs`, with a JS facade that returns clean blocked states
when the native addon or combined CUDA+Vulkan runner is not available.

Gate 2 uses `deepseek-coder:33b` as the installed 32B-class Q4 target. It
passes only if live Mosaic throughput is at least `1.5x` the RTX+CPU partial
offload baseline on the same model, prompts, context, and runner. If Gate 2
blocks or fails, Mosaic remains dev-only.

Native build wiring is available through `npm run build:native:mosaic`, which
copies the Rust `napi-rs` addon to `native/mosaic-coordinator/index.node`.
Runner readiness can be checked with `npm run eval:mosaic-probe -- <llama-cli>`.
The probe blocks runners that do not expose the Gate 2 CLI contract (`-p`,
context size, GPU layers, split mode, tensor split, temperature, and device
assignment for combined execution).

Current live Gate 2 result on this machine is **FAIL**: `deepseek-coder:33b`
baseline measured `4.7 TPS`, tuned Mosaic measured `4.3 TPS`, for `0.915x`
speedup against the required `1.5x`. Mosaic stays hidden/dev-only.
