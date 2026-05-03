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

- **Database**: SQLite operations via `sql.js` (file-backed persistence)
- **Typed Data Layer**: `electron/services/ipc/data-service.js` exposes conversation/message/attachment/branch IPC endpoints
- **Scoped Filesystem Layer**: `electron/services/ipc/fs-access-service.js` enforces grant-root access boundaries
- **LLM Communication**: HTTP requests to Ollama API
- **Image Generation**: ComfyUI workflow submission and polling
- **Encryption**: AES-256-GCM encryption for NSFW workspace
- **File System**: safe file/folder selection dialogs plus scoped read/write/list/mkdir IPC
- **Health Checks**: Backend connectivity testing

### 4. React Frontend (`src/`)

- **Core Boundary**: `src/core/` holds renderer-side business logic façades and shared contracts:
  - `chatEngine.js` re-exports Chat V2 orchestration behind a stable import path.
  - `modelResolver.js` centralizes model family/default resolver imports.
  - `modelCatalogService.js` owns model catalog source fetching and dedupe.
  - `sparkAdapter.js` owns renderer Spark Model Hub IPC and MoE-name helpers.
- **State Management**: Zustand store (`src/stores/appStore.js`)
- **Components**: React components for UI
- **Styling**: Tailwind CSS with custom workspace themes
- **Routing**: Single-page app with workspace switching

### 5. Electron Service Adapters (`electron/services/`)

- **Inference Orchestration**: `inference-orchestrator.js` remains the main routing coordinator.
- **Spark Adapter**: `spark-adapter.js` isolates Spark profile detection, llama.cpp Spark backend registration, and Spark MoE backend selection.
- **Model Hub Services**: `spark-model-hub-service.js` owns Spark dashboard data, model fit estimates, Ollama operations, LM Studio scans, and Continue config updates.

## Data Flow

### LLM Chat Flow

1. User types a message in `ChatV2Surface` (`src/chat-v2/ui/ChatV2Surface.jsx`)
2. `ChatV2Engine.sendUserMessage()` validates and starts generation
3. Runtime adapter (`createElectronRuntimeAdapter`) builds inference options and payload
4. IPC call to `llm:stream` handler
5. HTTP request to Ollama `/api/chat` (or compatible backend stream endpoint)
6. Stream chunks are processed by Chat V2 engine guardrails and watchdogs
7. UI updates incrementally through engine subscriptions
8. Final assistant turn is committed to SQLite-backed conversation history

### Encryption Flow (Vault Workspace)

1. User sets password via `nsfw:setPassword` IPC
2. Password hashed with scrypt plus random salt
3. Hash stored in `nsfw_auth` table. The persisted workspace id remains `nsfw` for compatibility, while UI and code helpers refer to the workspace as Vault.
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
- `role` (TEXT, `user` or `assistant`)
- `content` (TEXT, encrypted if `conversation.encrypted = 1`)
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
- `id` (TEXT PRIMARY KEY, always `nsfw`)
- `password_hash` (TEXT)
- `salt` (TEXT)
- `created_at`, `updated_at` (DATETIME)

## Security Considerations

1. **Context Isolation**: Renderer cannot access Node.js directly
2. **Sandbox**: Renderer runs in sandboxed environment
3. **Encryption**: Vault workspace uses AES-256-GCM
4. **Password Storage**: Only hashes stored, never plaintext
5. **Local-Only**: No external network calls (except user-configured backends)

## IPC API Contract

See `docs/ipc-api.md` for complete IPC channel documentation, including v2 typed data and scoped filesystem APIs plus deprecation notes.

## Extension Points

- **New Workspaces**: Add to `WORKSPACES` in `src/stores/appStore.js`
- **New Backends**: Add handlers in `electron/ipc-handlers.js`
- **Custom Models**: Works with any Ollama-compatible backend
- **Image Backends**: Extend `image:generate` handler for other APIs
