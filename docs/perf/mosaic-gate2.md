# Mosaic Gate 2 Decision

**Decision:** FAIL

- **Model:** deepseek-coder:33b
- **Threshold:** 1.5x baseline throughput
- **Speedup:** 0.915x
- **Baseline TPS:** 4.700
- **Mosaic TPS:** 4.300
- **Reason:** speedup 0.915 < 1.5

## Raw Decision JSON

```json
{
  "schemaVersion": 1,
  "gate": "mosaic-gate2",
  "status": "fail",
  "decision": "fail",
  "model": "deepseek-coder:33b",
  "threshold": {
    "speedup": 1.5
  },
  "baseline": {
    "promptsTotal": 3,
    "promptsMeasured": 3,
    "failures": 0,
    "avgTokensPerSecond": 4.7,
    "runs": [
      {
        "ok": true,
        "elapsedMs": 38565,
        "tokensPerSecond": 4.5
      },
      {
        "ok": true,
        "elapsedMs": 36922,
        "tokensPerSecond": 4.8
      },
      {
        "ok": true,
        "elapsedMs": 38793,
        "tokensPerSecond": 4.8
      }
    ]
  },
  "mosaic": {
    "promptsTotal": 3,
    "promptsMeasured": 3,
    "failures": 0,
    "avgTokensPerSecond": 4.3,
    "runs": [
      {
        "ok": true,
        "elapsedMs": 42105,
        "tokensPerSecond": 4.3
      },
      {
        "ok": true,
        "elapsedMs": 42643,
        "tokensPerSecond": 4.2
      },
      {
        "ok": true,
        "elapsedMs": 42553,
        "tokensPerSecond": 4.4
      }
    ]
  },
  "speedup": 0.9148936170212765,
  "reason": "speedup 0.915 < 1.5",
  "plan": {
    "schemaVersion": 1,
    "target": "gate2",
    "modelId": "deepseek-coder:33b",
    "modelPath": "C:\\Users\\molin\\.ollama\\models\\blobs\\sha256-065b9a7416ba28634cd4efc2cd3024d4755731c1275dc0286b81b01793185fbb",
    "contextSize": 4096,
    "threshold": {
      "speedup": 1.5
    },
    "assignment": {
      "rtxWeight": 0.1432991782803118,
      "arcWeight": 0.28803996281985383,
      "cpuWeight": 0.5686608588998344,
      "devices": [
        "Vulkan0",
        "Vulkan1",
        "CPU"
      ],
      "runnerDevices": [
        {
          "backend": "Vulkan",
          "id": "Vulkan0",
          "index": 0,
          "name": "NVIDIA GeForce RTX 5050 Laptop GPU"
        },
        {
          "backend": "Vulkan",
          "id": "Vulkan1",
          "index": 1,
          "name": "Intel"
        }
      ]
    },
    "baseline": {
      "mode": "baseline",
      "devices": [
        "Vulkan0"
      ],
      "gpuLayers": 20,
      "splitMode": "layer",
      "tensorSplit": "1",
      "fit": "on"
    },
    "mosaic": {
      "mode": "mosaic",
      "devices": [
        "Vulkan0",
        "Vulkan1"
      ],
      "gpuLayers": 24,
      "splitMode": "layer",
      "tensorSplit": "0.750,0.250",
      "fit": "on"
    }
  },
  "generatedAt": "2026-04-26T02:32:04.203Z"
}
```
