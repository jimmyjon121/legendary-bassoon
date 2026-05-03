# DevForge Spark Model Hub - Integration Guide

## What this module is

This began as a feature-rich drop-in module and is now integrated into DevForge as the Spark Model Hub surface. It turns a DGX Spark / NVIDIA Spark-style host into a manageable local AI headquarters.

It does **not** replace Cursor, Continue, Ollama, Open WebUI, or LM Studio. It controls and explains them.

Recommended architecture:

```text
DevForge Model Hub = command center
Ollama = model runtime
Cursor = code editor
Continue = local coding assistant bridge
Open WebUI = chat/RAG interface
LM Studio = optional GGUF downloader/source
```

## What I found in your uploaded DevForge app

Your app is already much further along than a blank project. It already includes:

- Electron + React + Vite + Tailwind.
- A large existing `ModelHubPanel`.
- Existing services for model management, local scanning, Hugging Face browsing, model providers, model downloader, model load confidence, hardware checking, inference orchestration, and ComfyUI.
- Existing IPC/preload patterns for model-related actions.
- Existing app store state for `showModelHub`.

Because of that, this module is designed to **augment** the current app rather than replace it.

## Files included

```text
electron/services/spark-model-hub-service.js
    Backend service that talks to Ollama, scans LM Studio GGUFs, checks memory/GPU/Docker,
    imports GGUFs into Ollama, and updates Continue config.

electron/ipc/spark-model-hub-handlers.js
    IPC handlers for the service.

src/components/ModelHub/SparkModelHubPanel.jsx
    Feature-rich React panel for the dashboard.

src/core/sparkAdapter.js
    Renderer-side Spark IPC and MoE candidate helpers used by the panel.

electron/services/spark-adapter.js
    Main-process Spark profile/backend adapter used by the inference orchestrator.

scripts/spark-model-hub-smoke.js
    Simple CLI smoke test.
```

## Current wiring

- IPC handlers are registered through `electron/ipc/spark-model-hub-handlers.js` and `electron/ipc/index.js`.
- Preload methods are exposed from `electron/preload.js`.
- The React panel is rendered from the existing Model Hub flow, not copied in at runtime.
- Spark-specific routing in `inference-orchestrator.js` is isolated behind `electron/services/spark-adapter.js`.

---

## Smoke test

After copying files, from your DevForge root run:

```bash
node scripts/spark-model-hub-smoke.js
```

Expected result:

- Ollama health/version.
- Memory availability.
- Installed Ollama models.
- LM Studio GGUFs.
- Continue config status.

If this fails because `ollama` is offline, run:

```bash
sudo systemctl restart ollama
curl http://localhost:11434/api/version
```

---

## Features in this first build

### Dashboard

- Spark memory available/total.
- Disk available.
- NVIDIA GPU usage/temperature/power via `nvidia-smi`.
- Ollama online/offline status.
- Open WebUI/Docker visibility.

### Installed models

- Lists Ollama models.
- Shows estimated memory requirement.
- Shows whether it can run right now.
- Buttons for run/warm, stop, delete, set as coding model.

### LM Studio GGUF import

- Scans:
  - `~/.lmstudio/models`
  - `~/.lmstudio/hub/models`
  - `~/.cache/lm-studio/models`
- Groups GGUF shards.
- Imports a GGUF into Ollama using a generated Modelfile.

### Discover / recommendations

Curated Spark-specific model cards:

- Gemma 4 31B Q8.
- Qwen 2.5 Coder 32B.
- DeepSeek R1 32B.
- DeepSeek R1 70B.
- Mistral Medium 3.5.
- GPT-OSS 120B MXFP4.
- Nomic Embed Text.
- EmbeddingGemma.

### Coding setup

- Shows current Continue model.
- Sets `~/.continue/config.yaml` automatically.
- Uses `apiBase: http://localhost:11434` because Cursor/Continue are running directly on the Spark.

### Jobs/downloads

- Tracks `ollama pull` jobs.
- Emits progress to the UI via IPC.

---

## Why this is separate instead of directly modifying the old ModelHub

Your existing `ModelHubPanel.jsx` is large and already does a lot. Replacing it directly would be risky.

This module is intentionally modular:

- Copy it in.
- Run smoke test.
- Open the panel.
- Confirm it works on the Spark.
- Then merge its best pieces into the existing ModelHub.

That avoids breaking your current DevForge build.

## Future upgrades

Recommended next additions:

1. Hugging Face GGUF search with trusted uploader filters.
2. vLLM provider support.
3. LiteLLM routing support.
4. Open WebUI workspace/model sync.
5. Per-task model profiles: coding, chat, RAG, heavy reasoning.
6. Model launch planner: unload models automatically before launching heavy models.
7. Benchmark runner: prompt tests, tokens/sec, memory/load tracking.
8. Remote Spark mode through NVIDIA Sync/Tailscale.
