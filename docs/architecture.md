# DevForge Architecture

## Overview

DevForge is a local-first AI workstation built with Electron, React, and SQLite. All data stays on your machine, and the app communicates only with local services (Ollama for LLMs, ComfyUI for image generation).

## Architecture Layers

### 1. Electron Main Process (`electron/main.js`)

- **Window Management**: Creates and manages the main BrowserWindow
- **Global Shortcuts**: Registers boss key (Ctrl+Shift+H) and panic mode (Ctrl+Shift+P)
- **Settings Store**: Uses `electron-store` for persistent app settings
- **Security**: Disables remote module, uses context isolation and sandbox

### 2. Preload Script (`electron/preload.js`)

- **IPC Bridge**: Exposes safe `window.electronAPI` to renderer process
- **Context Isolation**: Prevents direct Node.js access from renderer
- **API Surface**: Defines all IPC channels used by the frontend

### 3. IPC Handlers (`electron/ipc-handlers.js`)

- **Database**: SQLite operations via `better-sqlite3`
- **LLM Communication**: HTTP requests to Ollama API
- **Image Generation**: ComfyUI workflow submission and polling
- **Encryption**: AES-256-GCM encryption for NSFW workspace
- **File System**: Safe file/folder selection dialogs
- **Health Checks**: Backend connectivity testing

### 4. React Frontend (`src/`)

- **State Management**: Zustand store (`src/stores/appStore.js`)
- **Components**: React components for UI
- **Styling**: Tailwind CSS with custom workspace themes
- **Routing**: Single-page app with workspace switching

## Data Flow

### LLM Chat Flow

1. User types message → `ChatArea` component
2. `appStore.sendMessage()` called
3. Message encrypted if NSFW workspace
4. Message saved to SQLite `messages` table
5. IPC call to `llm:stream` handler
6. HTTP request to Ollama `/api/generate`
7. Stream chunks sent back via IPC channel
8. UI updates with streaming content
9. Final message saved to database

### Encryption Flow (NSFW Workspace)

1. User sets password → `nsfw:setPassword` IPC
2. Password hashed with scrypt + random salt
3. Hash stored in `nsfw_auth` table
4. When sending message:
   - Content encrypted with password-derived key
   - Encrypted data stored in `messages.content`
   - Conversation marked `encrypted = 1`
5. When loading messages:
   - Decrypt using password from memory
   - Display plaintext in UI

## Database Schema

### `conversations`
- `id` (TEXT PRIMARY KEY)
- `workspace` (TEXT)
- `title` (TEXT)
- `model` (TEXT)
- `encrypted` (INTEGER, 0 or 1)
- `created_at`, `updated_at` (DATETIME)

### `messages`
- `id` (TEXT PRIMARY KEY)
- `conversation_id` (TEXT, FK to conversations)
- `role` (TEXT, 'user' or 'assistant')
- `content` (TEXT, encrypted if conversation.encrypted = 1)
- `model` (TEXT)
- `created_at` (DATETIME)

### `generated_images`
- `id` (TEXT PRIMARY KEY)
- `conversation_id` (TEXT, FK to conversations)
- `prompt`, `negative_prompt` (TEXT)
- `model`, `settings` (TEXT, JSON)
- `file_path` (TEXT)
- `workspace` (TEXT)
- `created_at` (DATETIME)

### `nsfw_auth`
- `id` (TEXT PRIMARY KEY, always 'nsfw')
- `password_hash` (TEXT)
- `salt` (TEXT)
- `created_at`, `updated_at` (DATETIME)

## Security Considerations

1. **Context Isolation**: Renderer cannot access Node.js directly
2. **Sandbox**: Renderer runs in sandboxed environment
3. **Encryption**: NSFW workspace uses AES-256-GCM
4. **Password Storage**: Only hashes stored, never plaintext
5. **Local-Only**: No external network calls (except user-configured backends)

## IPC API Contract

See `docs/ipc-api.md` for complete IPC channel documentation.

## Extension Points

- **New Workspaces**: Add to `WORKSPACES` in `src/stores/appStore.js`
- **New Backends**: Add handlers in `electron/ipc-handlers.js`
- **Custom Models**: Works with any Ollama-compatible backend
- **Image Backends**: Extend `image:generate` handler for other APIs

