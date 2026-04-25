# CUDA Verifier Live Probe

This artifact verifies whether the in-process llama.cpp verifier path resolves CUDA on the target machine and whether `prewarmSpecDecodeVerifier()` can load the local GGUF verifier.

## Summary

- **Date:** 2026-04-25T17:06:06.456Z
- **Model:** qwen2.5:1.5b
- **Context size:** 1024
- **Backend health:** {"available":true,"status":"idle","model":null,"device":"NVIDIA GPU","gpu":"cuda","gpuMode":"cuda"}
- **Active GPU mode:** cuda
- **Prewarm result:** {"warmed":true,"already":false,"model":"gguf:C:\\Users\\molin\\.ollama\\models\\blobs\\sha256-183715c435899236895da3869489cc30ac241476b4971a20285b1a462818a5b4","pairKey":"qwen2.5:1.5b|qwen2.5:1.5b","contextSize":1024}
- **Outcome:** verified CUDA verifier prewarm

## Raw JSON

```json
{
  "date": "2026-04-25T17:06:06.456Z",
  "model": "qwen2.5:1.5b",
  "contextSize": 1024,
  "health": {
    "available": true,
    "status": "idle",
    "model": null,
    "device": "NVIDIA GPU",
    "gpu": "cuda",
    "gpuMode": "cuda"
  },
  "gpuMode": "cuda",
  "prewarm": {
    "warmed": true,
    "already": false,
    "model": "gguf:C:\\Users\\molin\\.ollama\\models\\blobs\\sha256-183715c435899236895da3869489cc30ac241476b4971a20285b1a462818a5b4",
    "pairKey": "qwen2.5:1.5b|qwen2.5:1.5b",
    "contextSize": 1024
  },
  "ok": true,
  "reason": null
}
```
