# DevForge

**Sovereign AI Development Environment**

A local-first, private, unrestricted AI workstation built for developers who demand complete control. No cloud dependencies. No restrictions. Your hardware, your rules.

![DevForge Screenshot](docs/screenshot.png)

---

## Features

### 🏠 Four Workspaces
- **Casual** - General chat and exploration
- **Work** - Professional tasks (clinical work, documentation)
- **Code** - Development and coding assistance
- **Private** - Encrypted, unrestricted workspace (NSFW-capable)

### 🤖 Local LLM Support
- Ollama integration out of the box
- Hot-swap between models
- Support for any GGUF model
- Full control over generation parameters

### 🎨 Image Generation
- ComfyUI / Stable Diffusion WebUI integration
- SDXL and custom model support
- No safety checkers
- Batch generation

### 🔒 Privacy First
- 100% offline capable
- SQLite database (local)
- AES-256 encryption for private workspace
- Boss key (Ctrl+Shift+H) to instantly hide
- Panic mode (Ctrl+Shift+P) to clear and hide

---

## Prerequisites

### Required
1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Ollama** - [Download](https://ollama.ai/)
   - Install and run: `ollama serve`
   - Pull a model: `ollama pull dolphin-mixtral` (or your preferred model)

### Optional (for image generation)
3. **ComfyUI** - [GitHub](https://github.com/comfyanonymous/ComfyUI)
   - Or **Stable Diffusion WebUI** with `--api` flag

---

## Quick Start

### 1. Clone/Download the project

```bash
cd devforge
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start Ollama (in a separate terminal)

```bash
ollama serve
```

### 4. Run DevForge

```bash
npm run dev
```

The app will launch automatically.

---

## Development

### Project Structure

```
devforge/
├── electron/              # Electron main process
│   ├── main.js           # Main entry point
│   ├── preload.js        # Secure IPC bridge
│   └── ipc-handlers.js   # IPC request handlers
├── src/                   # React frontend
│   ├── components/       # UI components
│   │   ├── Chat/        # Chat interface
│   │   ├── Layout/      # App shell
│   │   ├── Sidebar/     # Navigation
│   │   ├── ModelSelector/
│   │   ├── ImageGen/
│   │   ├── Settings/
│   │   └── Workspaces/
│   ├── stores/           # Zustand state management
│   ├── services/         # API services
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Utility functions
│   └── styles/           # CSS/Tailwind
├── public/               # Static assets
└── package.json
```

### Available Scripts

```bash
# Development (with hot reload)
npm run dev

# Build for production
npm run build

# Build for specific platform
npm run build:win
npm run build:mac
npm run build:linux
```

---

## Configuration

### LLM Backend (Ollama)

Default endpoint: `http://localhost:11434`

To use a different endpoint, go to **Settings > LLM Backend**.

#### Supported Models

Any Ollama-compatible model works. Recommended:
- `dolphin-mixtral` - Uncensored, general purpose
- `dolphin-llama3` - Fast, uncensored
- `codellama` - Coding specialist
- `deepseek-coder` - Advanced coding
- `mythomax` - Creative writing

Pull models with:
```bash
ollama pull <model-name>
```

### Image Generation (ComfyUI)

Default endpoint: `http://localhost:8188`

1. Install ComfyUI
2. Start with API enabled (default)
3. Configure endpoint in **Settings > Image Gen**

#### Recommended Checkpoints
- SDXL Base 1.0
- FLUX (if you have the VRAM)
- Any uncensored fine-tune of your choice

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+H` | Boss Key - Hide/Show window |
| `Ctrl+Shift+P` | Panic Mode - Clear & hide |
| `Ctrl+Enter` | Send message |
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Open model selector |
| `Ctrl+,` | Open settings |
| `Escape` | Close modal |

---

## Workspace Details

### Casual 💬
General purpose chat. Good for exploration, brainstorming, and casual conversation.

### Work 💼
Professional workspace. Optimized for:
- Clinical documentation
- Professional emails
- Reports and summaries
- Task planning

### Code 💻
Development workspace. Features:
- Syntax highlighting
- Code completion context
- Technical system prompts

### Private 🔒
Encrypted, unrestricted workspace. Features:
- Password protected
- AES-256 encryption
- No content filters
- Boss key support
- Separate storage

---

## Extending DevForge

### Adding New Workspaces

Edit `src/stores/appStore.js`:

```javascript
export const WORKSPACES = {
  // ... existing workspaces
  custom: {
    id: 'custom',
    name: 'Custom',
    icon: 'Star',
    color: 'workspace-custom', // Add to tailwind.config.js
    description: 'Your custom workspace',
    systemPrompt: 'Custom system prompt here'
  }
};
```

### Custom Model Backends

The app uses Ollama's API format. To add support for other backends (llama.cpp server, vLLM, etc.), modify:
- `electron/ipc-handlers.js` - Backend communication
- `src/stores/appStore.js` - State management

### Adding Image Generation Backends

Currently supports ComfyUI. To add others (A1111, Fooocus):
- Add endpoint configuration in Settings
- Implement workflow translation in `electron/ipc-handlers.js`

---

## Security Notes

### What DevForge Does
- Stores all data locally in SQLite database
- Encrypts the Private workspace with AES-256-GCM encryption
- Uses password-derived encryption keys (not hard-coded)
- Communicates only with localhost services (Ollama, ComfyUI)
- Zero telemetry, zero external connections
- Context isolation and sandbox enabled for security

### What DevForge Doesn't Do
- Send any data to external servers
- Log or track your conversations
- Impose content restrictions
- Phone home or check for updates automatically

### Encryption Details

**Private Workspace Encryption:**
- Password is hashed using scrypt (never stored plaintext)
- Messages are encrypted with AES-256-GCM before storage
- Each encryption uses a unique salt and IV
- Password is only kept in memory while workspace is unlocked
- Panic mode clears password from memory immediately

**Settings Storage:**
- Uses `electron-store` with machine-specific encryption key
- Sensitive settings (like endpoints) are stored encrypted
- Window bounds and preferences are stored locally

### Your Responsibilities
- Secure your machine (use full-disk encryption if possible)
- Use strong passwords for Private workspace (minimum 4 characters, but longer is better)
- Keep backups of your data (database is in `%APPDATA%/devforge/devforge.db` on Windows)
- Don't use for illegal purposes
- Remember your Private workspace password (it cannot be recovered)

---

## Troubleshooting

### "No models found"
1. Make sure Ollama is running: `ollama serve`
2. Pull a model: `ollama pull dolphin-mixtral`
3. Click refresh in the model selector
4. Check Settings > LLM Backend > Connection Status

### "Connection refused" or "Ollama not found"
- Verify Ollama is running: Open terminal and run `ollama serve`
- Check if Ollama is on the correct port (default: 11434)
- Check Settings > LLM Backend for correct endpoint
- Try clicking "Test connection" button in settings
- On Windows, make sure firewall isn't blocking localhost connections

### Image generation not working
- Make sure ComfyUI is running with API enabled (default)
- Check Settings > Image Gen for correct endpoint (default: http://localhost:8188)
- Verify your checkpoint is loaded in ComfyUI
- Check Settings > Image Gen > Connection Status
- Make sure you've selected a model in the image generation modal

### Private workspace password issues
- If you forgot your password, you cannot recover encrypted messages
- You can reset by deleting the database (this deletes all data)
- Database location: `%APPDATA%/devforge/devforge.db` on Windows

### App won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install

# If using Windows, try:
npm run dev:vite
# Then in another terminal:
npm run dev:electron
```

### Logs and debugging
- Logs are written to: `%APPDATA%/devforge/devforge.log`
- Check logs for detailed error messages
- Enable DevTools in development mode (Ctrl+Shift+I)

---

## Building for Distribution

### Windows
```bash
npm run build:win
```
Output: `release/DevForge Setup.exe`

### macOS
```bash
npm run build:mac
```
Output: `release/DevForge.dmg`

### Linux
```bash
npm run build:linux
```
Output: `release/DevForge.AppImage`

---

## Roadmap

- [ ] llama.cpp server support (direct, no Ollama)
- [ ] Multiple image gen backends
- [ ] Voice input/output
- [ ] RAG / document ingestion
- [ ] Character system for Private workspace
- [ ] Plugin system
- [ ] Mobile companion app

---

## Version

**v0.9.0** - Complete Windows product release

## License

**UNLICENSED** - This is your personal tool. Do what you want with it.

## Documentation

- [Architecture Guide](docs/architecture.md) - Technical architecture overview
- [IPC API Reference](docs/ipc-api.md) - Complete IPC channel documentation
- [QA Checklist](docs/qa-checklist.md) - Testing checklist for releases

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

**Remember: Your machine, your rules. No restrictions. No compromises.**
