# DevForge

**Also known as Anvil** — successor product name for the same local AI workstation (this repo and scripts still use the `devforge` package name in places).

<div align="center">

![DevForge](https://img.shields.io/badge/DevForge-Local%20AI%20Workstation-8b5cf6?style=for-the-badge&logo=electron&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-32.x-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=flat-square)

### Own Your AI. Control Your Costs. Keep Your Data.

The cloud AI providers keep raising prices. APIs get deprecated. Terms change overnight.  
**DevForge is your insurance policy** — a fully local AI workstation that runs on your hardware.

[Why Local?](#why-local-ai) • [Features](#features) • [Quick Start](#quick-start) • [For Agents](#-for-agents--developers) • [Documentation](#documentation)

*Last Updated: May 10, 2026*

</div>

---

## What is this?

**Anvil Hub** (package: `devforge`) is a **local-first AI workspace**: chat, model hub, Vault/private workspace affordances, research flows, and a **Code** surface for inspection and light agent tasks. **DevForge IDE** is an optional deep-coding companion launched via handoff when you configure a binary or checkout path—see [`ALPHA_README.md`](ALPHA_README.md).

Historically branded **DevForge**, the app is still a **sovereign AI workstation**: it orchestrates local LLMs (Ollama, Llama.cpp, OpenVINO), keeps data local (SQLite + vector stores where enabled), and supports coding, research, and writing without sending traffic to the cloud by default.

It is designed to be the "Forever Brain" that you own, independent of any company's API or policy changes.

---

## 🤖 For Agents / Developers

**Quick Onboarding for AI Agents:**

### 🗺️ Codebase Map
- **Renderer Core:** `src/core/`
  - `chatEngine.js`: Stable import boundary for Chat V2 orchestration.
  - `modelResolver.js`: Model family/default resolver façade.
  - `modelCatalogService.js`: Shared model catalog source loading and dedupe.
  - `sparkAdapter.js`: Renderer-side Spark Model Hub IPC and MoE helpers.
- **Agent harness (experimental foundation):** `src/agent-harness/`
  - TypeScript: model profiles, master loop, tool registry, detection, harness runner.
  - Approved sequence and acceptance criteria: `docs/agent-harness-approved-plan.md`.
- **Electron IPC:** `electron/ipc/` (wired via `setupModularHandlers` from `electron/ipc/index.js`)
  - `ipc-handlers.js`: Legacy + aggregate registrations (large; high churn).
  - `agent-harness-handlers.js`: Harness-specific IPC (`agent:harness:*`).
  - `code-tools-handlers.js`: Code agent / tool bridge.
  - Other split modules include `ai-handlers.js`, `research-handlers.js`, `model-handlers.js`, `storage-handlers.js`, `system-handlers.js`, `web-search-handlers.js`, `image-handlers.js`, `spark-model-hub-handlers.js`.
- **Inference hygiene:** `electron/utils/sanitize-inference-messages.js` — normalizes LLM message payloads before inference.
- **Electron Services:** `electron/services/`
  - `inference-orchestrator.js`: The "Cortex". Routes prompts to the best backend (Ollama/CUDA, OpenVINO/NPU) based on load and capability.
  - `spark-adapter.js`: Spark profile/backend/MoE routing adapter for the main process.
  - `alpha-readiness.js` / `devforge-handoff.js`: Paid-alpha readiness checks and optional **Open Full DevForge IDE** handoff.
  - `research/`: Autonomous web research agents (browser automation, content extraction).
  - `intent-compiler/`: Natural language to system action translation.
- **Frontend:** `src/`
  - `chat-v2/ui/`: Main chat interface and session surface.
  - `components/Settings/`: Settings UI, including extracted `NPUModelConverter.jsx` and `SparkSettings.jsx`.
  - `components/ModelHub/`: Model Hub UI, including shared `ModelCard.jsx` and `ModelFitIndicator.jsx`.
  - `stores/`: Zustand state management for workspace, messages, and settings.
- **Evaluation:** `scripts/`
  - `casual-eval.js`: Quick sanity check for chat capabilities.
  - `coding-eval.js`: Benchmarks coding performance.
  - `research-eval.js`: Tests web search and synthesis.
  - `agent-harness-smoke.js`: Harness behavior smoke (wired as `npm run agent-harness-smoke`).
  - `inference-toolchain-smoke.js`: Production inference path smoke (`npm run inference-toolchain-smoke`).
  - `inference-live-model-matrix.js`: Optional live Ollama matrix probe (`OLLAMA_LIVE=1`).
  - `alpha-ship-smoke.mjs` / `devforge-handoff-smoke.mjs`: Paid-alpha readiness + IDE handoff contract checks (`npm run eval:alpha-ship`, `npm run eval:devforge-handoff`).

### ⚡ Key Commands
```bash
npm run dev          # Start the full stack (Electron + Vite)
npm run app:spark    # Start the NVIDIA Spark Linux profile
npm run eval:casual  # Run basic chat evaluation
npm run eval:coding  # Run coding capability tests
npm run agent-harness-smoke      # Agent harness foundation smoke
npm run inference-toolchain-smoke # IPC → resolver → backend inference smoke
npm run eval:alpha-ship          # Paid-alpha readiness + handoff smoke chain
npm run eval:devforge-handoff    # DevForge IDE handoff IPC/schema smoke
npm run eval:release-gate        # Consolidated release gate script
npm run build:win    # Build Windows installer
```

### 🏗️ Architecture Notes
- **Hybrid Inference:** We prioritize NPU for small tasks (embeddings, small models) and GPU for heavy lifting (70B+ models).
- **Wireless Brain:** The system is designed to be exposed via Tailscale for secure mobile access (see `docs/wireless-brain-plan.md`).

---

## Why Local AI?

| Cloud AI Problems | DevForge Solution |
|-------------------|-------------------|
| 💸 **Rising costs** — API prices increase unpredictably | Run models locally for **$0/month** after hardware |
| 🔒 **Data privacy** — Your prompts train their models | **100% local** — nothing leaves your machine |
| ⚡ **Rate limits** — Throttled during peak usage | **Unlimited** — your hardware, your limits |
| 📉 **Downtime** — Service outages halt your work | **Always available** — works offline |
| 📜 **Terms changes** — Features removed without notice | **You control everything** — no surprises |
| 🔌 **Vendor lock-in** — Stuck in one ecosystem | **Model agnostic** — swap models freely |

**DevForge ensures you're never held hostage by a cloud provider's pricing or policy changes.**

---

## Features

### 🧠 Wireless Brain (New!)
Turn your desktop into an always-on AI server. Access your personal "brain" from your phone securely via Tailscale, with seamless handoff between devices.
- **Desktop Node:** Heavy lifting, long-term memory, 70B+ models.
- **Laptop/Mobile Node:** Lightweight interaction, NPU-optimized.

### 🏠 Purpose-Built Workspaces
| Workspace | Optimized For |
|-----------|---------------|
| **Casual** | General chat, brainstorming, exploration |
| **Work** | Professional tasks, documentation, emails |
| **Code** | Development assistance, debugging, code review |
| **Private** | Encrypted workspace for sensitive data (journals, notes, personal projects) |

### 💬 Chat V2 Surface
The default chat experience keeps the conversation front and center while preserving access to runtime controls, follow-up suggestions, attachments, and session metadata when you need them.

### 🤖 Intelligent Model Management
- **Inference Orchestrator:** Automatically routes tasks to NPU, GPU, or CPU based on efficiency and speed profiles.
- **Hot-swap models:** Switch between models instantly.
- **Any GGUF model:** Use models from Hugging Face, Ollama, or anywhere.
- **Full parameter control:** Temperature, context length, and more.

### 🧪 Local Runtime R&D Status
- **LM Studio parity polish shipped:** Chat V2 now has context controls, model eject, approximate context-used percentage, per-model system prompts, model-picker quant filters, sort, and VRAM fit dots.
- **User autonomy shipped:** Per-model device pins and per-chat backend overrides let advanced users force a route when the automatic orchestrator makes the wrong call.
- **Speculative decoding loop verified:** Phase 2 acceptance fixed in v0.4.8 (`avgAcceptance=1.000` on the self-spec verifier loop with `DEVFORGE_SPEC_DRAFTER=llamanode`). The full perf gate (`>=1.6x` speedup) is still open because asymmetric drafters need a smaller GGUF that does not contend with the verifier on 8GB VRAM. Spec-decode remains opt-in behind `DEVFORGE_SPEC_DECODE_ENABLE=1`.
- **Mosaic runtime Gate 1 PASSED:** Corrected device-pool capacity math projects `6.225x` capacity at `100%` of RTX-only baseline speed. Phase 3 native coordinator design is unblocked but not started.

### 🎨 Local Image Generation
- **ComfyUI integration:** Professional image generation workflow.
- **SDXL & FLUX support:** Latest models, running locally.
- **Automatic setup:** DevForge can install and configure ComfyUI for you.

### 🔐 Privacy & Security
- **AES-256 encryption** for sensitive workspaces.
- **Zero telemetry** — No data collection whatsoever.
- **Offline capable** — Full functionality without internet.
- **Quick-hide** (`Ctrl+Shift+H`) — Instant privacy when needed.

---

## Quick Start

### Prerequisites

1. **Node.js 18+** — [Download](https://nodejs.org/)
2. **Ollama** — [Download](https://ollama.ai/) (free, open source)

### Installation

```bash
# Clone the repository
git clone https://github.com/jimmyjon121/legendary-bassoon.git devforge
cd devforge

# Install dependencies
npm install

# Start Ollama (separate terminal)
ollama serve

# Pull a model (choose based on your hardware)
ollama pull llama3.2        # 3GB - Good for most machines
ollama pull deepseek-coder  # 7GB - Great for coding
ollama pull mixtral         # 26GB - Powerful, needs good GPU

# Run DevForge
npm run dev
```

### NVIDIA Spark Linux

On NVIDIA Spark Linux, use the dedicated launch profile:

```bash
./run-devforge-spark.sh
# or
npm run app:spark
```

This profile uses the repo-local Node runtime when available, applies Spark-friendly Electron/Ollama defaults, and keeps experimental Mosaic/spec-decode paths opt-in. macOS and Windows remain on the standard `npm run app`, `npm run dev`, `npm run build:mac`, and `npm run build:win` commands.

---

## Hardware Recommendations

| RAM | VRAM | Recommended Models |
|-----|------|-------------------|
| 8GB | 4GB | llama3.2, phi3, gemma2:2b |
| 16GB | 8GB | mistral, codellama, llama3.1:8b |
| 32GB | 12GB+ | mixtral, deepseek-coder:33b, llama3.1:70b (quantized) |
| **64GB+** | **24GB+** | **The "Forever Brain" tier.** Run 70B+ models comfortably with CPU offloading. |

DevForge's **auto-optimization** detects your model and adjusts settings for best performance.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 32 |
| Frontend | React 18 + Vite 5 |
| Styling | Tailwind CSS |
| State | Zustand |
| Database | SQLite |
| LLM | Ollama / Llama.cpp / OpenVINO |
| Images | ComfyUI |

---

## Project Structure

```
devforge/
├── electron/                 # Desktop app backend
│   ├── main.js              # Electron main process
│   ├── preload.js           # Secure IPC bridge
│   ├── ipc/                 # IPC handler modules (split from monolith over time)
│   └── services/            # Backend services (Inference, Research, etc.)
├── src/                     # React frontend
│   ├── agent-harness/       # TS harness foundation (profiles, loop, tools)
│   ├── components/          # UI components
│   ├── stores/              # State management
│   ├── services/            # Frontend services
│   └── hooks/               # Custom hooks
├── scripts/                 # Evaluation and build scripts
├── docs/                    # Documentation
└── REFACTOR-BASELINE/       # Frozen refactor audit captures (optional reading)
```

---

## Documentation

- [CHANGELOG](CHANGELOG.md) — version history
- [Refactor slice log](REFACTOR-LOG.md) — `refactor/healthy-weight-*` branch progress
- [Repository footprint](docs/repository-footprint.md) — doc map, heavy artifacts, large files
- [Improvement ledger](docs/IMPROVEMENT-LEDGER.md)
- [Agent harness canonical plan](docs/agent-harness-approved-plan.md)
- [Anvil paid alpha](ALPHA_README.md) — scope, boundaries, setup checklist
- [Alpha ship plan](ALPHA_SHIP_PLAN.md) / [Alpha ship baseline](ALPHA_SHIP_BASELINE.md)

### Product & runtime

- [Wireless Brain Plan](docs/wireless-brain-plan.md) (New!)
- [Wireless Brain API Spec](docs/wireless-brain-api-spec.md)
- [Wireless Brain Auth Model](docs/wireless-brain-auth-model.md)
- [Wireless Brain Threat Model](docs/wireless-brain-threat-model.md)
- [NVIDIA Spark Linux Profile](docs/spark-linux-profile.md)
- [Unified Runtime Tracker](docs/unified-runtime-tracker.md)
- [Phase 2 Spec Decode Measurement](docs/perf/phase2-spec-decode-measurement.md)
- [Mosaic Gate 1 Decision](docs/perf/mosaic-gate1.md)
- [Performance Baseline](docs/perf/baseline-2026-02.md)
- [Architecture Guide](docs/architecture.md)
- [IPC API Reference](docs/ipc-api.md)
- [User Guide](docs/user-guide.md)

---

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.

---

## License

MIT License — Use it, modify it, make it yours.

---

<div align="center">

### Stop renting AI. Start owning it.

**DevForge** — Local AI that works for you, not the other way around.

</div>
