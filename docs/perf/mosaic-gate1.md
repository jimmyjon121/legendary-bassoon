# Mosaic Gate 1 Decision

**Decision:** FAIL

- **Model:** qwen2.5-coder:14b
- **Capacity multiplier:** 1.143x (threshold 1.3x)
- **Speed fraction:** 99.6% of RTX-only baseline (threshold 50%)
- **Predicted throughput:** 7.473 tok/s
- **Predicted first-token latency:** 6359 ms
- **Assignment:** rtx=42, cpu=6, arc=0
- **Gate basis:** mandatory-14b
- **Reasons:** mandatory qwen2.5-coder:14b simulation did not satisfy Gate 1 thresholds; capacityMultiplier 1.143 < 1.3
- **Best-effort 30B:** PASS (2.286x capacity, 98.3% speed)

## Raw Decision JSON

```json
{
  "schemaVersion": 1,
  "decision": "fail",
  "model": "qwen2.5-coder:14b",
  "capacityMultiplier": 1.1428571428571428,
  "speedFraction": 0.9963093581347207,
  "predictedTps": 7.473298721061694,
  "predictedFirstTokenMs": 6359.250000000005,
  "assignment": {
    "rtx": 42,
    "cpu": 6,
    "arc": 0
  },
  "thresholds": {
    "capacityMultiplier": 1.3,
    "minBaselineFraction": 0.5
  },
  "reasons": [
    "mandatory qwen2.5-coder:14b simulation did not satisfy Gate 1 thresholds",
    "capacityMultiplier 1.143 < 1.3"
  ],
  "simulation": {
    "schemaVersion": 1,
    "model": "qwen2.5-coder:14b",
    "modelSpec": {
      "id": "qwen2.5-coder:14b",
      "totalLayers": 48,
      "footprintBytes": 9663676416,
      "bytesPerLayer": 201326592,
      "kvBytesPerToken": 524288,
      "nCtx": 4096
    },
    "assignment": {
      "rtx": 42,
      "cpu": 6,
      "arc": 0
    },
    "predictedTps": 7.473298721061694,
    "predictedFirstTokenMs": 6359.250000000005,
    "capacityMultiplier": 1.1428571428571428,
    "speedFraction": 0.9963093581347207,
    "baseline": {
      "rtxOnlyLayers": 42,
      "rtxOnlyFootprintBytes": 8455716864,
      "rtxOnlyTokensPerSecond": 7.500982159851556,
      "thresholds": {
        "capacityMultiplier": 1.3,
        "minBaselineFraction": 0.5
      }
    },
    "profilesUsed": {
      "rtx": {
        "source": "live",
        "throughputTokensPerSecond": 7.500982159851556,
        "memoryBytes": 8546942976,
        "error": null
      },
      "arc": {
        "source": "fallback",
        "throughputTokensPerSecond": 6,
        "memoryBytes": 10737418240,
        "error": null
      },
      "cpu": {
        "source": "live",
        "throughputTokensPerSecond": 7.285092060797735,
        "memoryBytes": 33917235200,
        "error": null
      },
      "npu": {
        "source": "live",
        "throughputTokensPerSecond": 0.01,
        "memoryBytes": 1610612736,
        "error": null
      },
      "rebar": {
        "source": "live",
        "throughputTokensPerSecond": 0.01,
        "memoryBytes": 8546942976,
        "error": null
      }
    },
    "decision": "fail",
    "reasons": [
      "capacityMultiplier 1.143 < 1.3"
    ],
    "generatedAt": "2026-04-25T17:39:09.200Z"
  },
  "decidedAt": "2026-04-25T17:40:05.910Z",
  "gateBasis": "mandatory-14b",
  "mandatory14b": {
    "schemaVersion": 1,
    "decision": "fail",
    "model": "qwen2.5-coder:14b",
    "capacityMultiplier": 1.1428571428571428,
    "speedFraction": 0.9963093581347207,
    "predictedTps": 7.473298721061694,
    "predictedFirstTokenMs": 6359.250000000005,
    "assignment": {
      "rtx": 42,
      "cpu": 6,
      "arc": 0
    },
    "thresholds": {
      "capacityMultiplier": 1.3,
      "minBaselineFraction": 0.5
    },
    "reasons": [
      "capacityMultiplier 1.143 < 1.3"
    ],
    "simulation": {
      "schemaVersion": 1,
      "model": "qwen2.5-coder:14b",
      "modelSpec": {
        "id": "qwen2.5-coder:14b",
        "totalLayers": 48,
        "footprintBytes": 9663676416,
        "bytesPerLayer": 201326592,
        "kvBytesPerToken": 524288,
        "nCtx": 4096
      },
      "assignment": {
        "rtx": 42,
        "cpu": 6,
        "arc": 0
      },
      "predictedTps": 7.473298721061694,
      "predictedFirstTokenMs": 6359.250000000005,
      "capacityMultiplier": 1.1428571428571428,
      "speedFraction": 0.9963093581347207,
      "baseline": {
        "rtxOnlyLayers": 42,
        "rtxOnlyFootprintBytes": 8455716864,
        "rtxOnlyTokensPerSecond": 7.500982159851556,
        "thresholds": {
          "capacityMultiplier": 1.3,
          "minBaselineFraction": 0.5
        }
      },
      "profilesUsed": {
        "rtx": {
          "source": "live",
          "throughputTokensPerSecond": 7.500982159851556,
          "memoryBytes": 8546942976,
          "error": null
        },
        "arc": {
          "source": "fallback",
          "throughputTokensPerSecond": 6,
          "memoryBytes": 10737418240,
          "error": null
        },
        "cpu": {
          "source": "live",
          "throughputTokensPerSecond": 7.285092060797735,
          "memoryBytes": 33917235200,
          "error": null
        },
        "npu": {
          "source": "live",
          "throughputTokensPerSecond": 0.01,
          "memoryBytes": 1610612736,
          "error": null
        },
        "rebar": {
          "source": "live",
          "throughputTokensPerSecond": 0.01,
          "memoryBytes": 8546942976,
          "error": null
        }
      },
      "decision": "fail",
      "reasons": [
        "capacityMultiplier 1.143 < 1.3"
      ],
      "generatedAt": "2026-04-25T17:39:09.200Z"
    },
    "decidedAt": "2026-04-25T17:40:05.910Z"
  },
  "bestEffort30b": {
    "schemaVersion": 1,
    "decision": "pass",
    "model": "qwen3-30b-abliterated:q4_k_m",
    "capacityMultiplier": 2.2857142857142856,
    "speedFraction": 0.9829124061185159,
    "predictedTps": 23.947926431371314,
    "predictedFirstTokenMs": 8225.875,
    "assignment": {
      "rtx": 28,
      "cpu": 36,
      "arc": 0
    },
    "thresholds": {
      "capacityMultiplier": 1.3,
      "minBaselineFraction": 0.5
    },
    "reasons": [],
    "simulation": {
      "schemaVersion": 1,
      "model": "qwen3-30b-abliterated:q4_k_m",
      "modelSpec": {
        "id": "qwen3-30b-abliterated:q4_k_m",
        "totalLayers": 64,
        "footprintBytes": 19327352832,
        "bytesPerLayer": 301989888,
        "kvBytesPerToken": 786432,
        "nCtx": 4096
      },
      "assignment": {
        "rtx": 28,
        "cpu": 36,
        "arc": 0
      },
      "predictedTps": 23.947926431371314,
      "predictedFirstTokenMs": 8225.875,
      "capacityMultiplier": 2.2857142857142856,
      "speedFraction": 0.9829124061185159,
      "baseline": {
        "rtxOnlyLayers": 28,
        "rtxOnlyFootprintBytes": 8455716864,
        "rtxOnlyTokensPerSecond": 24.364252889981085,
        "thresholds": {
          "capacityMultiplier": 1.3,
          "minBaselineFraction": 0.5
        }
      },
      "profilesUsed": {
        "rtx": {
          "source": "live",
          "throughputTokensPerSecond": 24.364252889981085,
          "memoryBytes": 8546942976,
          "error": null
        },
        "arc": {
          "source": "fallback",
          "throughputTokensPerSecond": 6,
          "memoryBytes": 10737418240,
          "error": null
        },
        "cpu": {
          "source": "live",
          "throughputTokensPerSecond": 23.63382461161502,
          "memoryBytes": 33917235200,
          "error": null
        },
        "npu": {
          "source": "live",
          "throughputTokensPerSecond": 0.01,
          "memoryBytes": 1610612736,
          "error": null
        },
        "rebar": {
          "source": "live",
          "throughputTokensPerSecond": 0.01,
          "memoryBytes": 8546942976,
          "error": null
        }
      },
      "decision": "pass",
      "reasons": [],
      "generatedAt": "2026-04-25T17:37:02.619Z"
    },
    "decidedAt": "2026-04-25T17:40:05.911Z"
  }
}
```
