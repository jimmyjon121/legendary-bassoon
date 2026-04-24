# DevForge Performance Baseline (February 2026)

## Scope
- Chat render hot path (`src/chat-v2/ui/*`, `src/chat-v2/engine/*`)
- Streaming markdown pipeline
- Main-process database persistence (`electron/ipc-handlers.js`)
- UI polling pressure (renderer intervals)

## Baseline (pre-hardening, code-scan observed)
- Bare `useAppStore()` subscriptions in chat components: `8`
- Inline per-message callbacks in chat surface: `3`
- Main-process DB saves on `fs.writeFileSync`: `yes`
- V8 heap cap policy: fixed `512MB`
- Missing sort indexes:
: `messages(conversation_id, created_at)`
: `messages(created_at)`
: `conversations(workspace, updated_at)`

## Current Snapshot (post-hardening)
- `node scripts/perf-chat-stream.js`
: `bareUseStoreCount=0`
: `inlineCallbackCount=0`
- `node scripts/perf-db-save.js`
: async queued save path enabled (`DatabaseWriter`)
: sync write isolated to quit/explicit sync fallback path
: autosave uses queued writer path
: target indexes present
- `node scripts/perf-ui-polling.js`
: `totalIntervals=19` (threshold `<=35`)

## Release Gate
- `node scripts/release-perf-gate.js` passes all checks.
