# IPC API Reference

This document describes all IPC channels exposed via `window.electronAPI` in the renderer process.

## Window Controls

- `minimizeWindow()` - Minimize the main window
- `maximizeWindow()` - Toggle maximize/restore
- `closeWindow()` - Hide the window (doesn't quit)
- `isMaximized()` - Check if window is maximized

## Settings/Store

- `getSettings(key)` - Get a setting value from electron-store
- `setSettings(key, value)` - Set a setting value

## LLM Communication

- `sendToLLM(payload)` - Send non-streaming request to Ollama
- `streamFromLLM(payload, callback)` - Stream response from Ollama
  - Returns cleanup function to cancel stream
  - Payload: `{ model, prompt, system, options, channel }`
- `cancelLLMStream(channel)` - Cancel an active stream
- `getModels()` - Get list of available Ollama models
- `loadModel(modelPath)` - Pull/load a model in Ollama
- `unloadModel()` - Unload current model (no-op for Ollama)
- `checkLLMHealth()` - Check Ollama backend health
  - Returns: `{ healthy: boolean, status: string, models: number, error?: string }`

## Image Generation

- `generateImage(payload)` - Submit workflow to ComfyUI
  - Payload: `{ workflow: object }`
- `getImageModels()` - Get available ComfyUI checkpoints
- `interruptGeneration()` - Cancel active image generation
- `checkImageHealth()` - Check ComfyUI backend health
  - Returns: `{ healthy: boolean, status: string, error?: string }`

## File System

- `selectFile(options)` - Show file picker dialog
- `selectFolder(options)` - Show folder picker dialog
- `readFile(filePath)` - Read file contents as UTF-8
- `writeFile(filePath, content)` - Write file contents
- `listModels(directory)` - List GGUF/BIN files in directory

## Database

- `dbQuery(sql, params)` - Execute SELECT query
  - Returns: Array of rows
- `dbRun(sql, params)` - Execute INSERT/UPDATE/DELETE
  - Returns: `{ changes: number, lastInsertRowid: number }`

## NSFW Password Management

- `setNsfwPassword(password)` - Set/update NSFW workspace password
- `verifyNsfwPassword(password)` - Verify password
  - Returns: `{ verified: boolean, error?: string }`
- `hasNsfwPassword()` - Check if password is set
  - Returns: `{ hasPassword: boolean }`

## Encryption

- `encrypt(data, password)` - Encrypt data with password
  - Returns: `{ encrypted: string, iv: string, salt: string, authTag: string }`
- `decrypt(data, password)` - Decrypt data with password
  - Data: `{ encrypted, iv, salt, authTag }`
  - Returns: Decrypted string

## System Events

- `onPanicMode(callback)` - Listen for panic mode trigger
  - Returns cleanup function

## App Info

- `getAppPath()` - Get user data directory path
- `getVersion()` - Get app version
- `getPlatform()` - Get OS platform (win32, darwin, linux)
- `getGPUInfo()` - Get GPU information

## Error Handling

All IPC handlers may throw errors. The renderer should catch and handle appropriately:

```javascript
try {
  const result = await window.electronAPI.someMethod();
} catch (error) {
  console.error('IPC error:', error.message);
  // Show user-friendly error message
}
```

## Channel Naming Convention

- `window:*` - Window operations
- `store:*` - Settings storage
- `llm:*` - LLM/Ollama operations
- `image:*` - Image generation
- `fs:*` - File system
- `db:*` - Database operations
- `crypto:*` - Encryption/decryption
- `nsfw:*` - NSFW workspace management
- `app:*` - App metadata
- `system:*` - System information

