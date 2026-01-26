# QA Checklist

Use this checklist when testing DevForge before release.

## First Run & Onboarding

- [ ] Onboarding wizard appears on first launch
- [ ] Can skip NSFW workspace setup
- [ ] Ollama connection check works correctly
- [ ] Model selection works
- [ ] Onboarding completes successfully
- [ ] App doesn't show onboarding on subsequent launches

## Workspace Functionality

- [ ] Can switch between Casual, Work, Code, and Private workspaces
- [ ] Each workspace shows correct system prompt
- [ ] Conversations are isolated per workspace
- [ ] Workspace indicator shows in title bar

## Private (NSFW) Workspace

- [ ] Lock screen appears when accessing Private workspace without password
- [ ] Can set password on first access
- [ ] Password verification works correctly
- [ ] Invalid password shows error
- [ ] Messages are encrypted when saved
- [ ] Messages are decrypted when loaded
- [ ] Locking workspace clears password from memory
- [ ] Switching away from Private workspace locks it

## LLM Chat

- [ ] Can select model from model selector
- [ ] Model selector shows available models
- [ ] Can refresh model list
- [ ] Sending message creates conversation
- [ ] Messages stream correctly
- [ ] Can stop generation mid-stream
- [ ] Conversation history persists
- [ ] Can delete conversations
- [ ] Markdown rendering works
- [ ] Code highlighting works
- [ ] Copy message button works

## Panic Mode & Boss Key

- [ ] Ctrl+Shift+H hides/shows window
- [ ] Ctrl+Shift+P triggers panic mode
- [ ] Panic mode clears in-memory state
- [ ] Panic mode switches to Casual workspace
- [ ] Panic mode locks Private workspace

## Image Generation

- [ ] Image generation modal opens
- [ ] Can enter prompt and settings
- [ ] Model selector shows available checkpoints
- [ ] Health check works for ComfyUI
- [ ] Generation workflow submits correctly
- [ ] Generated images appear in gallery
- [ ] Can download images
- [ ] Images are saved to database
- [ ] Images are linked to conversations

## Settings

- [ ] Settings modal opens/closes
- [ ] Can change Ollama endpoint
- [ ] Can change ComfyUI endpoint
- [ ] Health checks work for both backends
- [ ] Settings persist across restarts
- [ ] Can view keyboard shortcuts
- [ ] Privacy settings work

## Error Handling

- [ ] Shows error when Ollama is not running
- [ ] Shows error when no model selected
- [ ] Shows error when model doesn't exist
- [ ] Shows error when ComfyUI is not available
- [ ] Error messages are user-friendly
- [ ] Errors don't crash the app

## Windows-Specific

- [ ] App installs correctly via NSIS installer
- [ ] Desktop shortcut created
- [ ] Start menu shortcut created
- [ ] App launches from shortcuts
- [ ] App uninstalls cleanly
- [ ] Window controls work (minimize, maximize, close)
- [ ] Window size/position persists
- [ ] App works on Windows 10
- [ ] App works on Windows 11

## Performance

- [ ] App starts quickly (< 3 seconds)
- [ ] UI is responsive
- [ ] No memory leaks during extended use
- [ ] Database queries are fast
- [ ] Large conversations load quickly

## Security

- [ ] No hard-coded secrets in code
- [ ] Passwords are hashed, not stored plaintext
- [ ] Encryption works correctly
- [ ] Context isolation is enabled
- [ ] Sandbox is enabled
- [ ] No external network calls (except configured backends)

## Data Persistence

- [ ] Conversations persist across restarts
- [ ] Settings persist across restarts
- [ ] Model selection persists
- [ ] Workspace selection persists
- [ ] Generated images persist

## Edge Cases

- [ ] Handles missing Ollama gracefully
- [ ] Handles missing ComfyUI gracefully
- [ ] Handles network errors gracefully
- [ ] Handles invalid model names
- [ ] Handles very long messages
- [ ] Handles special characters in prompts
- [ ] Handles rapid workspace switching
- [ ] Handles multiple rapid messages

## Documentation

- [ ] README is accurate
- [ ] User guide is complete
- [ ] Architecture docs are accurate
- [ ] IPC API docs are complete

