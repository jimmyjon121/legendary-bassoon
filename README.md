# DevForge

<div align="center">

![DevForge](https://img.shields.io/badge/DevForge-Local%20AI%20Workstation-8b5cf6?style=for-the-badge&logo=electron&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31.x-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

### Own Your AI. Control Your Costs. Keep Your Data.

The cloud AI providers keep raising prices. APIs get deprecated. Terms change overnight.  
**DevForge is your insurance policy** — a fully local AI workstation that runs on your hardware.

[Why Local?](#why-local-ai) • [Features](#features) • [Quick Start](#quick-start) • [Documentation](#documentation)

</div>

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

### 🏠 Purpose-Built Workspaces
| Workspace | Optimized For |
|-----------|---------------|
| **Casual** | General chat, brainstorming, exploration |
| **Work** | Professional tasks, documentation, emails |
| **Code** | Development assistance, debugging, code review |
| **Private** | Encrypted workspace for sensitive data (journals, notes, personal projects) |

### 🎯 Five View Modes
Interact with AI the way that works best for you:
- **Stream** — Traditional chat flow
- **Canvas** — Visual mind mapping
- **Document** — Collaborative doc building
- **Timeline** — Chronological view
- **Focus** — Distraction-free mode

### 🤖 Intelligent Model Management
- **Auto-optimization** — Detects model type and applies optimal settings automatically
- **Hot-swap models** — Switch between models instantly
- **Any GGUF model** — Use models from Hugging Face, Ollama, or anywhere
- **Full parameter control** — Temperature, context length, and more

### 🎨 Local Image Generation
- **ComfyUI integration** — Professional image generation workflow
- **SDXL & FLUX support** — Latest models, running locally
- **Automatic setup** — DevForge can install and configure ComfyUI for you

### 🔐 Privacy & Security
- **AES-256 encryption** for sensitive workspaces
- **Zero telemetry** — No data collection whatsoever
- **Offline capable** — Full functionality without internet
- **Quick-hide** (`Ctrl+Shift+H`) — Instant privacy when needed

### ⚡ Performance
- **Virtualized lists** — Handles thousands of messages smoothly
- **Lazy loading** — Fast startup, load features on demand
- **Optimized state** — Minimal re-renders for smooth UI

---

## Quick Start

### Prerequisites

1. **Node.js 18+** — [Download](https://nodejs.org/)
2. **Ollama** — [Download](https://ollama.ai/) (free, open source)

### Installation

```bash
# Clone the repository
git clone https://github.com/jimmyjon121/legendary-bassoon.git
cd legendary-bassoon

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

DevForge's **auto-optimization** detects your model and adjusts settings for best performance.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 31 |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Database | SQLite |
| LLM | Ollama |
| Images | ComfyUI |

---

## Project Structure

```
devforge/
├── electron/                 # Desktop app backend
│   ├── main.js              # Electron main process
│   ├── preload.js           # Secure IPC bridge
│   └── services/            # Backend services
├── src/                     # React frontend
│   ├── components/          # UI components
│   ├── stores/              # State management
│   ├── services/            # Frontend services
│   └── hooks/               # Custom hooks
└── docs/                    # Documentation
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+H` | Quick hide window |
| `Ctrl+R` | Reload |
| `Ctrl+Shift+R` | Force reload |
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Model selector |
| `Ctrl+,` | Settings |
| `Alt+1-5` | Switch views |

---

## Development

```bash
npm run dev          # Development mode
npm run build        # Production build
npm run build:win    # Windows installer
npm run build:mac    # macOS installer
npm run build:linux  # Linux AppImage
```

---

## The Cost Comparison

| Usage | Cloud AI (GPT-4) | DevForge |
|-------|------------------|----------|
| 1M tokens/month | ~$30-60 | $0 |
| 10M tokens/month | ~$300-600 | $0 |
| Heavy daily use | $100+/month | $0 |
| **One year** | **$1,200+** | **$0** |

*After initial hardware investment, your ongoing cost is just electricity.*

---

## Documentation

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
