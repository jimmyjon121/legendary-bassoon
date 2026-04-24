# Chat V2 Standard Checklist

## Entry Condition
- `src/App.jsx` routes chat surfaces to `ChatV2Harness` by default.
- Build succeeds with no runtime errors.
- `npm run eval:chat-v2` passes.

## Functional Gates
- `hello`, `thanks`, `ok` return short natural responses.
- Stream start/stop/cancel work reliably.
- Long responses stream smoothly without UI lockups.
- Message history persists correctly.
- Model change applies to next generation.
- Error states surface clear recovery actions.

## Parity Gates
- Edit/regenerate parity
- Branching parity
- Attachment parity (image/file)
- Follow-up suggestion parity
- Workspace policy parity

## Performance Gates
- Input remains responsive during streaming.
- No full-list rerender on each stream chunk.
- No periodic save-related freeze during active chat.

## Runtime Safety
- Core shell modals remain available: model selector, model hub, downloads, image generation, settings.
- Code workspace remains independent from chat runtime.

## Rollback
- If any P0 regression appears, roll back the Chat V2 cutover commit.
- Keep V2 message format migration-free until stabilization is complete.

## Phase 1 — Tiered NPU Utilization QA
Run these after a fresh launch on Copilot+ hardware (Intel NPU present).

### NPU registered without opt-in
- Launch app with `preferredBackend = 'auto'` (never flipped Unified Brain).
- Open Settings → Hardware Monitor → GPUs/NPU section. NPU card should
  display "Ready" or "Standby" status.
- `orchestrator:getDeviceUtilization` (via DevTools: `await window.electronAPI.getDeviceUtilization(60000)`)
  should return `warmloop.available === true` on first launch.

### Embedding routes to NPU
- With NPU registered, open a chat with RAG enabled (upload a small text file).
- Send a message that triggers a RAG lookup.
- Open Device Activity expander in Hardware Monitor.
  - NPU row should show ≥1 job within the last 60s after the RAG retrieval.
  - Last workload label should read `embedding` (or `lane_embedding`).

### Power-aware routing
- With NPU registered and a ≤3B model selected, chat on AC power.
  - Device Activity → GPU row accumulates jobs; NPU stays low.
- Unplug AC, send a short reply ("hi") to the same chat.
  - Device Activity → NPU row accumulates jobs; GPU stays idle.
- Replug AC, send another short reply.
  - Device Activity → GPU row resumes accumulating jobs.

### Warm-loop gating
- On AC, balanced profile: warmloop reports `active: true`.
- Switch profile to `efficiency` or `laptop`.
  - Warmloop re-evaluates within ~5s; reports `active: false` with reason `profile=efficiency` or `profile=laptop`.
- Switch back to `balanced`: warmloop re-loads, `active: true` returns.

### Release gate
- `npm run eval:release-gate` → 12/12 pass (adds `tiered-utilization` gate in Phase 1).

## v0.3 Stabilization Run (2026-04-24)

Evidence source:
- `npm run eval:tiered-utilization` -> PASS
- `npm run eval:live-smoke` -> PASS (run with DevForge app/NPU server active)
- `node scripts/chat-v2-eval.js` -> PASS
- `node scripts/release-gate.js` -> PASS (12/12)

### Phase 1 acceptance results
- NPU registered without opt-in: **PASS** (NPU server responds on default config; `npu-genai-smoke` reports `engine=genai`, `device=NPU`).
- Embedding routes to NPU in Device Activity: **FAIL (manual UI evidence still required)**.
- AC↔battery swap changes routing distribution: **FAIL (manual hardware toggle required)**.
- Warm-loop active/inactive profile gating in ~5s: **FAIL (manual profile flip + Device Activity capture required)**.

### Streaming UX v0.3 results
- On send, "Preparing the model..." status appears immediately: **PASS** (engine sets status before stream starts; verified in state path).
- On first real token, status clears and partial text is preserved: **PASS** (watchdog/retry path no longer overwrites streaming content; validated by chat-v2 + live smoke behavior).
- Cold-load 7B Q4 first token <= 180s: **PASS** (`stream-cold-load-smoke`: 4452 ms first token on this machine).
- Mid-stream kill shows retry banner under partial reply and keeps recovery visible: **FAIL (manual kill-flow verification still required)**.
- GenAI NPU path streams at least one response (not optimum fallback): **PASS** (`npu-genai-smoke`: `engine=genai`, `device=NPU`).

### Follow-up actions
- Manual-only FAIL items are tracked in WS-V4 closure notes and should be re-run interactively with screenshot/log evidence from Hardware Monitor Device Activity.
