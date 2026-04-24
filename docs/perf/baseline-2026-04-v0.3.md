# v0.3 Baseline (2026-04)

Captured on target machine during a real 30-minute session.

- Session start: `2026-04-24T02:41:23.629Z`
- Session end: `2026-04-24T03:11:49.414Z`
- Duration: `30 minutes`
- Capture script: `node scripts/v03-baseline-session.js`

## First-token / throughput snapshot

- **1.5B NPU (`openvino-local`)**
  - first token: `n/a` (non-stream endpoint probe)
  - total latency: `11459 ms`
  - throughput: `4.4 tok/s`
  - engine/device: `genai` on `NPU`
- **7B RTX (`codellama:7b`)**
  - first token: `3656 ms`
  - total latency: `6548 ms`
  - throughput: `61.3 tok/s`
  - engine/device: `ollama` on `GPU`
- **13B RTX-with-offload (`local-wizard-vicuna-13b-uncensored.q4_0:latest`)**
  - first token: `5770 ms`
  - total latency: `7104 ms`
  - throughput: `14.3 tok/s`
  - engine/device: `ollama` on `GPU`

## Warm-loop activity (30-minute window)

- Sample interval: `30000 ms`
- Samples: `60`
- Active samples: `60`
- Warm-loop active percent: `100%`

## Stream aborts (same window)

- Abort counts: none observed (`{}`)

## Notes

- NPU probe uses `/v1/chat/completions` non-stream mode for deterministic latency capture.
- GPU probes use streamed Ollama responses and provider eval metrics when available.
