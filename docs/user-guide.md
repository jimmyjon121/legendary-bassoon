# DevForge User Guide

Welcome to DevForge! This guide will help you get started with your local AI workstation.

## Getting Started

### First Launch

When you first launch DevForge, you'll see an onboarding wizard that guides you through setup:

1. **Welcome** - Overview of DevForge features
2. **Ollama Setup** - Connect to your Ollama backend
3. **Select Model** - Choose a model to use
4. **Private Workspace** (Optional) - Set up encrypted workspace
5. **Complete** - You're ready to go!

On startup, onboarding runs a quick local health probe. If Ollama is already reachable and has a model available, DevForge proceeds without waiting for the background auto-setup signal. The auto-setup signal is still used when it arrives, and a short fallback local check keeps first launch from blocking on optional services.

### Prerequisites

Before using DevForge, make sure you have:

- **Ollama** installed and running (`ollama serve`)
- At least one model pulled (`ollama pull dolphin-mixtral`)
- **ComfyUI** (optional, for image generation)

### NVIDIA Spark Linux

On NVIDIA Spark Linux, launch with the Spark profile:

```bash
./run-devforge-spark.sh
# or
npm run app:spark
```

The profile is CUDA/Ollama-first and keeps optional OpenVINO/NPU, `robotjs`, llama.cpp, Mosaic, and speculative-decoding paths non-blocking. Use the standard launch commands on macOS and Windows.

## Workspaces

DevForge has four workspaces, each optimized for different use cases:

### Casual 💬
- General chat and exploration
- Friendly, conversational AI
- Good for brainstorming and casual questions

### Work 💼
- Professional tasks and documentation
- Clinical work, emails, reports
- Focused on productivity and accuracy

### Code 💻
- Development and coding assistance
- Code completion, debugging, explanations
- Technical system prompts

### Private 🔒
- Encrypted, unrestricted workspace
- Password-protected
- AES-256 encryption for all messages
- No content filters

## Using Chat

### Starting a Conversation

1. Select a workspace from the sidebar
2. Choose a model (Ctrl+K or click model selector)
3. Type your message and press Enter (or Ctrl+Enter)
4. Wait for the AI response

### Keyboard Shortcuts

- `Ctrl+Enter` - Send message
- `Ctrl+K` - Open model selector
- `Ctrl+N` - New conversation
- `Ctrl+,` - Open settings
- `Ctrl+Shift+H` - Boss key (hide/show window)
- `Ctrl+Shift+P` - Panic mode (clear & hide)
- `Escape` - Close modal/dialog

### Managing Conversations

- **New Chat**: Click "New Chat" button in sidebar
- **Search**: Use search bar to find conversations
- **Delete**: Hover over conversation and click trash icon
- **Switch**: Click any conversation to load it

## Private Workspace

### Setting Up

1. Click on the Private workspace tab
2. Enter a password (minimum 4 characters)
3. Confirm your password
4. Click "Create & Enter"

**Important**: Remember your password! It cannot be recovered. If you forget it, encrypted messages cannot be decrypted.

### Using Private Workspace

- All messages are encrypted before saving
- Password is required to unlock the workspace
- Workspace locks automatically when you switch away
- Use panic mode (Ctrl+Shift+P) to instantly lock and clear

### Security Features

- **Boss Key** (Ctrl+Shift+H): Instantly hide the window
- **Panic Mode** (Ctrl+Shift+P): Clear sensitive data and hide
- **Encryption**: AES-256-GCM encryption for all messages
- **No Cloud**: Everything stays on your machine

## Image Generation

### Setup

1. Install and run ComfyUI
2. Load a checkpoint/model in ComfyUI
3. Open DevForge Settings > Image Gen
4. Verify connection status shows "Connected"

### Generating Images

1. Click the Image icon in sidebar (or Ctrl+I)
2. Enter your prompt
3. Optionally add negative prompt
4. Select model, size, and other settings
5. Click "Generate"
6. Wait for generation to complete
7. Images appear in the gallery

### Image Settings

- **Model**: Select checkpoint from ComfyUI
- **Size**: Choose from presets (512x512 to 1920x1080)
- **Steps**: More steps = better quality but slower
- **CFG Scale**: How closely to follow prompt (7-9 recommended)
- **Sampler**: Algorithm for generation
- **Seed**: -1 for random, or specific number for reproducibility

## Settings

Access settings with `Ctrl+,` or click Settings in sidebar.

### General
- Theme (Dark/Light/System)
- Font size
- Streaming responses
- Save conversation history

### LLM Backend
- Ollama endpoint (default: http://localhost:11434)
- Models directory
- Connection status and health check

### Image Gen
- ComfyUI endpoint (default: http://localhost:8188)
- Connection status

### Privacy
- Lock Private workspace
- Export data
- Clear conversations

### Shortcuts
- View all keyboard shortcuts

## Tips & Best Practices

### Model Selection
- **dolphin-mixtral**: Good general-purpose model, uncensored
- **codellama**: Best for coding tasks
- **deepseek-coder**: Advanced coding assistance
- **mythomax**: Creative writing

### Performance
- Larger models need more VRAM/RAM
- Streaming responses feel faster than waiting for full response
- Image generation can take several minutes depending on settings

### Privacy
- Use Private workspace for sensitive content
- Remember to lock workspace when done
- Use panic mode if someone approaches unexpectedly
- Keep backups of your database

### Troubleshooting
- Check Settings > LLM Backend > Connection Status if models don't load
- Check logs in `%APPDATA%/devforge/devforge.log` for errors
- Restart Ollama if connection issues occur
- Verify ComfyUI is running if image generation fails

## Data Storage

### Database Location
- **Windows**: `%APPDATA%/devforge/devforge.db`
- **macOS**: `~/Library/Application Support/devforge/devforge.db`
- **Linux**: `~/.config/devforge/devforge.db`
- Contains all conversations, messages, and settings

### Logs
- **Windows**: `%APPDATA%/devforge/devforge.log`
- **macOS**: `~/Library/Logs/devforge/devforge.log`
- **Linux**: `~/.config/devforge/devforge.log`
- Contains app events and errors

### Backing Up
- Copy the entire `devforge` folder from AppData
- Restore by copying back
- **Note**: Private workspace messages require the password to decrypt

## Getting Help

- Check the [README](README.md) for technical details
- Review [Architecture Docs](architecture.md) for developers
- Check logs for error messages
- Ensure Ollama/ComfyUI are running and accessible

## Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Send message |
| `Ctrl+K` | Open model selector |
| `Ctrl+N` | New conversation |
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+H` | Boss key (hide/show) |
| `Ctrl+Shift+P` | Panic mode |
| `Escape` | Close modal |

Enjoy your sovereign AI workstation!

