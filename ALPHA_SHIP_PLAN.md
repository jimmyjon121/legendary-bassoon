# Paid Alpha Ship Polish Plan: Anvil Hub First

## Summary

Ship the first paid alpha as the **Anvil Hub app**, not the full DevForge IDE bundle. The app should feel useful immediately for local chat, model management, Vault/local privacy, research, and quick code inspection, with DevForge IDE handoff available for technical users who have the Code-OSS fork installed.

The goal is a narrow, honest paid alpha: fewer fake surfaces, clearer setup status, reliable local-model readiness, and a clean "open full IDE" path from the Code workspace.

## Key Changes

- Add alpha evidence/gate artifacts:
  - `ALPHA_SHIP_PLAN.md`
  - `ALPHA_SHIP_BASELINE.md`
  - `scripts/alpha-ship-smoke.mjs`
  - package script `eval:alpha-ship`
- Treat the Electron Anvil app as the paid artifact:
  - Keep DevForge IDE handoff as an optional advanced coding path.
  - Do not require packaging DevForge IDE for the first paid alpha.
  - Show setup guidance if the DevForge checkout/binary is missing.
- Polish the Code page around the real product flow:
  - Keep it as **Quick Code Workspace** for project inspection, quick chat, and quick agent work.
  - Make **Open Full DevForge IDE** the primary deep-coding action.
  - Hide or clearly mark unfinished/fake actions such as Draft PR, Timeline, Refactor, Write Tests, Document, and similar buttons unless they execute real wired behavior.
  - Keep Project Explorer, file editor, terminal, chat, and agent panels only if they are working enough for alpha.
- Add a top-level readiness surface:
  - Local model status
  - Vault/default policy status
  - selected model / unloaded model state
  - DevForge handoff status
  - storage/database status
  - update/build version
- Add a single alpha readiness result object used by UI and tests:
  - `success`
  - `status: "ready" | "needs_setup" | "degraded"`
  - `checks[]` with `id`, `label`, `status`, `message`, and optional `action`
  - no raw prompts, raw file contents, or private workspace content in logs
- Make failure states actionable:
  - Ollama unavailable: show "Start Ollama" guidance.
  - No loaded model: show model picker / load model action.
  - DevForge IDE missing: show exact path/env guidance.
  - Vault disabled/default: explain current policy without fear-copy.
  - Handoff failure: expose last launch record path and sanitized error.
- Clean alpha copy and naming:
  - Product-facing name: **Anvil**.
  - Coding IDE path: **DevForge IDE**.
  - Internal package names may remain `devforge-*`.
  - Avoid implying full Cursor parity; say local-first, private, early access.

## Test Plan

- Add `scripts/alpha-ship-smoke.mjs` to verify:
  - Anvil app metadata/version can be read.
  - readiness checks return structured statuses.
  - Code page strings use "Quick Code Workspace" and "Open Full DevForge IDE".
  - unfinished alpha-blocked actions are hidden or explicitly marked experimental.
  - DevForge handoff smoke still passes.
  - IPC security smoke still passes.
  - release gate can include alpha smoke without mutating user data.
- Run and record in `ALPHA_SHIP_BASELINE.md`:
  - `npm run eval:alpha-ship`
  - `npm run eval:devforge-handoff`
  - targeted ESLint for touched files
  - `npm run build:app`
  - existing `npm run eval:release-gate` if runtime prerequisites are available
- Acceptance criteria:
  - A user can launch Anvil and understand what is ready, missing, and next.
  - The Code page no longer looks like a broken replacement IDE.
  - DevForge handoff works when configured and gives clear setup guidance when not.
  - No fake coding actions appear as completed product features.
  - Build passes with only documented existing warnings.
  - Baseline records warnings, exact commands, final status, and rollback notes.

## Assumptions

- First paid alpha is **Anvil Hub Only**.
- DevForge IDE remains important, but it is optional/advanced for this alpha artifact.
- Revenue path is early-access technical users, not a broad public launch.
- No license/payment system is added in this pass; distribution can be manual/private.
- No global DevForge-to-Anvil rename is performed.
- No custom embedded VS Code or browser-window IDE is added.
