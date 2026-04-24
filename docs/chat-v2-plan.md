# Chat V2 Runtime Plan

## Goal
Operate Chat V2 as the standard chat surface in the main app, keep Code workspace separate, and remove legacy Chat V1 runtime paths.

## Non-Negotiables
- Keep AMOLED-first dark visual style.
- Preserve core workflows: model chooser, hub, downloads, image generation, code workspace.
- Keep deterministic short-turn behavior and streaming reliability.
- Keep branch/edit/retry/attachments fully available in V2.

## Chat V2 Architecture
- `src/chat-v2/engine/`: state machine, watchdogs, guardrails, branch/edit/retry flows.
- `src/chat-v2/runtime/`: Electron adapter and inference option shaping.
- `src/chat-v2/ui/`: `ChatV2Harness` and `ChatV2Surface`.

## Active Routing Baseline
- `src/App.jsx`:
  - `code` workspace -> `CodeWorkbench`
  - `research` workspace -> `ResearchWorkspace`
  - all other chat workspaces -> `ChatV2Harness`

## Validation Command
- `npm run eval:chat-v2`
- Validates app routing, V2 engine contracts, runtime bridge, and AMOLED shell expectations.

## Current V2 Coverage
- Deterministic short-turn behavior
- Stream + stop/cancel
- Retry after stream error
- Regenerate last assistant turn
- Edit user turn and regenerate
- Branch create/switch
- Draft attachment flow in chat UI
- Casual/work/research web-search toggle + `[SEARCH: ...]` execution path
