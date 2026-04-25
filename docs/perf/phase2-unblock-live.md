# Phase 2 Unblock Live Verification (v0.4.5)

This artifact verifies the v0.4.4 NPU draft-session unblock against the live OpenVINO server when available. If the server cannot be started, this file records the skipped state rather than pretending the path was tested.

## Summary

- **Date:** 2026-04-25T05:22:46.927Z
- **Endpoint:** http://127.0.0.1:8081
- **Outcome:** verified request path
- **Server started by script:** false
- **Status:** {"status":"ok","server":"running","model_configured":true,"model_loaded":true,"model_path":"OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov","device":"NPU","genai_available":true,"genai_active":true,"genai_model":"OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"}
- **Session id:** sess-11d0f3ba0c5d477d9bde3c04f504e2b1
- **chat_mode_active:** true
- **chat_mode_skip_reason:** n/a
- **First extend mode:** full
- **Second extend mode:** delta
- **First extend latency:** 2575 ms
- **Second extend latency:** 2413 ms
- **Close success:** true
- **Skip / failure reason:** n/a

## Raw JSON

```json
{
  "date": "2026-04-25T05:22:46.927Z",
  "endpoint": "http://127.0.0.1:8081",
  "started": false,
  "skipped": false,
  "status": {
    "status": "ok",
    "server": "running",
    "model_configured": true,
    "model_loaded": true,
    "model_path": "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov",
    "device": "NPU",
    "genai_available": true,
    "genai_active": true,
    "genai_model": "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"
  },
  "session": {
    "success": true,
    "session_id": "sess-11d0f3ba0c5d477d9bde3c04f504e2b1",
    "prompt_chars": 23,
    "engine": "genai",
    "device": "NPU",
    "chat_mode_active": true,
    "chat_mode_skip_reason": null
  },
  "extend1": {
    "success": true,
    "cancelled": false,
    "session_id": "sess-11d0f3ba0c5d477d9bde3c04f504e2b1",
    "request_id": "draft-777267f20cfc4718b0f2d3654cfd7f82",
    "draft_tokens": [
      9707,
      0,
      2585,
      646
    ],
    "draft_logprobs": null,
    "latency_ms": 2575,
    "engine": "genai",
    "device": "NPU",
    "extend_count": 1,
    "generate_mode": "full",
    "chat_mode_active": true
  },
  "extend2": {
    "success": true,
    "cancelled": false,
    "session_id": "sess-11d0f3ba0c5d477d9bde3c04f504e2b1",
    "request_id": "draft-fe0823d3ade842e79042d6a63f1cc6de",
    "draft_tokens": [
      2132,
      4977,
      1075,
      1052
    ],
    "draft_logprobs": null,
    "latency_ms": 2413,
    "engine": "genai",
    "device": "NPU",
    "extend_count": 2,
    "generate_mode": "delta",
    "chat_mode_active": true
  },
  "close": {
    "success": true,
    "session_id": "sess-11d0f3ba0c5d477d9bde3c04f504e2b1",
    "closed_at": 1777094571.9434378,
    "extend_count": 2,
    "chat_mode_active": true
  },
  "reason": null
}
```
