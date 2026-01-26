# DevForge

<div align="center">

![DevForge](https://img.shields.io/badge/DevForge-AI%20Workstation-8b5cf6?style=for-the-badge&logo=electron&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31.x-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-UNLICENSED-red?style=flat-square)

**Sovereign AI Development Environment**

A local-first, private, unrestricted AI workstation built for developers who demand complete control.  
No cloud dependencies. No restrictions. Your hardware, your rules.

[Features](#features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Roadmap](#roadmap)

</div>

---

## Features

### 🏠 Four Workspaces
| Workspace | Purpose |
|-----------|---------|
| **Casual** | General chat, exploration, brainstorming |
| **Work** | Professional tasks, documentation, reports |
| **Code** | Development assistance with full IDE integration |
| **Private** | Encrypted, unrestricted workspace (NSFW-capable) |

### 🎯 Five View Modes
Switch between different ways to interact with your AI:
- **Stream** - Traditional chat flow with smart auto-scroll
- **Canvas** - Visual mind mapping for complex ideas
- **Document** - Build knowledge docs collaboratively
- **Timeline** - Chronological conversation view
- **Focus** - Distraction-free minimal interface

### 🤖 Local LLM Support
- **Ollama integration** out of the box
- **Intelligent Model Auto-Optimization** - Automatically detects model family, size, and quantization to apply optimal settings
- Hot-swap between models instantly
- Support for any GGUF model
- Full control over generation parameters

### 🎨 Image Generation
- ComfyUI / Stable Diffusion WebUI integration
- SDXL, FLUX, and custom model support
- Automatic backend detection and setup
- Batch generation with progress tracking

### 🔒 Privacy First
- **100% offline capable** - No internet required
- **SQLite database** - All data stored locally
- **AES-256 encryption** for private workspace
- **Boss key** (`Ctrl+Shift+H`) - Instantly hide window
- **Panic mode** (`Ctrl+Shift+P`) - Clear memory and hide

### ⚡ Performance Optimized
- Virtualized message lists for long conversations
- Lazy-loaded components for fast startup
- Selective Zustand subscriptions for minimal re-renders
- Smart context management

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 31 |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| State | Zustand (slices pattern) |
| Database | SQLite (better-sqlite3) |
| LLM Backend | Ollama |
| Image Gen | ComfyUI |

---

## Quick Start

### Prerequisites

1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Ollama** - [Download](https://ollama.ai/)

### Installation

```bash
# Clone the repository
git clone https://github.com/jimmyjon121/legendary-bassoon.git
cd legendary-bassoon

# Install dependencies
npm install

# Start Ollama (in a separate terminal)
ollama serve

# Pull a model
ollama pull llama3.2

# Run DevForge
npm run dev
```

The app will launch automatically.

---

## Project Structure

```
devforge/
├── electron/                 # Electron main process
│   ├── main.js              # Main entry point with Menu API
│   ├── preload.js           # Secure IPC bridge
│   ├── ipc-handlers.js      # IPC request handlers
│   ├── ipc/                  # Modular IPC handlers
│   └── services/             # Backend services
│       ├── ollama-helper.js      # Ollama integration
│       ├── comfyui-manager.js    # ComfyUI process management
│       ├── image-backend-auto.js # Auto image backend detection
│       └── ...
├── src/                      # React frontend
│   ├── components/          # UI components
│   │   ├── Chat/           # Chat views and input
│   │   ├── Sidebar/        # Navigation and folders
│   │   ├── ImageGen/       # Image generation modal
│   │   └── ...
│   ├── stores/              # Zustand state management
│   │   ├── appStore.js     # Main app state
│   │   └── slices/         # State slices
│   ├── services/            # Frontend services
│   │   └── modelOptimizer.js # Intelligent model settings
│   ├── hooks/               # Custom React hooks
│   └── styles/              # CSS/Tailwind
└── package.json
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+H` | Boss Key - Hide/Show window |
| `Ctrl+Shift+P` | Panic Mode - Clear & hide |
| `Ctrl+R` | Reload app |
| `Ctrl+Shift+R` | Force reload (clear cache) |
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Open model selector |
| `Ctrl+,` | Open settings |
| `Alt+1-5` | Switch view modes |
| `F12` | Toggle DevTools (dev mode) |

---

## Configuration

### LLM Backend (Ollama)

Default endpoint: `http://localhost:11434`

#### Recommended Models
```bash
ollama pull llama3.2          # Fast, general purpose
ollama pull deepseek-coder    # Code specialist
ollama pull dolphin-mixtral   # Uncensored, creative
ollama pull codellama         # Code generation
```

### Image Generation (ComfyUI)

Default endpoint: `http://localhost:8188`

DevForge can auto-detect and manage ComfyUI installation. Configure in **Settings > Image Generation**.

---

## Development

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Platform-specific builds
npm run build:win
npm run build:mac
npm run build:linux
```

---

## Security

### What DevForge Does
- ✅ Stores all data locally in SQLite
- ✅ Encrypts Private workspace with AES-256-GCM
- ✅ Uses password-derived encryption keys
- ✅ Communicates only with localhost services
- ✅ Zero telemetry, zero external connections

### What DevForge Doesn't Do
- ❌ Send data to external servers
- ❌ Log or track conversations
- ❌ Impose content restrictions
- ❌ Phone home or auto-update

---

## Documentation

- [Architecture Guide](docs/architecture.md) - Technical architecture overview
- [IPC API Reference](docs/ipc-api.md) - Complete IPC channel documentation
- [QA Checklist](docs/qa-checklist.md) - Testing checklist for releases
- [User Guide](docs/user-guide.md) - End-user documentation

---

## Roadmap

- [x] Ollama integration
- [x] Multiple workspaces
- [x] ComfyUI image generation
- [x] Intelligent model auto-optimization
- [x] Multiple view modes
- [x] Conversation folders and filters
- [ ] llama.cpp direct support
- [ ] Voice input/output (Whisper)
- [ ] RAG / document ingestion
- [ ] Plugin system
- [ ] Mobile companion app

---

## Version

**v0.9.1** - Enhanced with intelligent model optimization

---

## Credits

Built with:
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand](https://github.com/pmndrs/zustand)
- [Ollama](https://ollama.ai/)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)

---

<div align="center">

**Your machine, your rules. No restrictions. No compromises.**

</div>
