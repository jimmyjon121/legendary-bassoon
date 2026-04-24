# DevForge

<div align="center">

![DevForge](https://img.shields.io/badge/DevForge-Local%20AI%20Workstation-8b5cf6?style=for-the-badge&logo=electron&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-28.x-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=flat-square)

### Own Your AI. Control Your Costs. Keep Your Data.

The cloud AI providers keep raising prices. APIs get deprecated. Terms change overnight.  
**DevForge is your insurance policy** — a fully local AI workstation that runs on your hardware.

[Why Local?](#why-local-ai) • [Features](#features) • [Quick Start](#quick-start) • [For Agents](#-for-agents--developers) • [Documentation](#documentation)

*Last Updated: February 18, 2026*

</div>

---

## What is this?

DevForge is a **sovereign AI workstation**. It's a desktop application that turns your computer into a private AI server and workspace. It orchestrates local LLMs (via Ollama, Llama.cpp, OpenVINO), manages your personal data (SQLite + Vector DB), and provides a suite of tools for coding, research, and writing—all without sending a single byte to the cloud.

It is designed to be the "Forever Brain" that you own, independent of any company's API or policy changes.

---

## 🤖 For Agents / Developers

**Quick Onboarding for AI Agents:**

### 🗺️ Codebase Map
- **Core Logic:** `electron/services/`
  - `inference-orchestrator.js`: The "Cortex". Routes prompts to the best backend (Ollama/CUDA, OpenVINO/NPU) based on load and capability.
  - `research/`: Autonomous web research agents (browser automation, content extraction).
  - `intent-compiler/`: Natural language to system action translation.
- **Frontend:** `src/`
  - `chat-v2/ui/`: Main chat interface and session surface.
  - `stores/`: Zustand state management for workspace, messages, and settings.
- **Evaluation:** `scripts/`
  - `casual-eval.js`: Quick sanity check for chat capabilities.
  - `coding-eval.js`: Benchmarks coding performance.
  - `research-eval.js`: Tests web search and synthesis.

### ⚡ Key Commands
```bash
npm run dev          # Start the full stack (Electron + Vite)
npm run eval:casual  # Run basic chat evaluation
npm run eval:coding  # Run coding capability tests
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
| Desktop | Electron 28 |
| Frontend | React 18 + Vite |
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
│   └── services/            # Backend services (Inference, Research, etc.)
├── src/                     # React frontend
│   ├── components/          # UI components
│   ├── stores/              # State management
│   ├── services/            # Frontend services
│   └── hooks/               # Custom hooks
├── scripts/                 # Evaluation and build scripts
└── docs/                    # Documentation
```

---

## Documentation

- [Wireless Brain Plan](docs/wireless-brain-plan.md) (New!)
- [Wireless Brain API Spec](docs/wireless-brain-api-spec.md)
- [Wireless Brain Auth Model](docs/wireless-brain-auth-model.md)
- [Wireless Brain Threat Model](docs/wireless-brain-threat-model.md)
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
