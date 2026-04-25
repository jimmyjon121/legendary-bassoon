# Mosaic Runtime Architecture (Gate 1)

Mosaic is the Phase 3 R&D path for deciding whether DevForge should build a custom multi-device coordinator that can place model layers across the RTX 5050 Laptop GPU, Intel Arc 140T iGPU, Intel NPU 3, CPU, and pinned system RAM. Gate 1 is deliberately a simulator gate: no runtime is promoted until measured profiles project enough capacity and enough speed.

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

If Gate 1 passes, a separate Phase 3 build plan decides the native coordinator language (Node N-API vs Rust `napi-rs`) and the actual layer execution design. If Gate 1 fails, the tracker marks Mosaic cancelled and DevForge stays on the v0.4 classic runtime track.
