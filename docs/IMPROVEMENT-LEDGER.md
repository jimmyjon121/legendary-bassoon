# DevForge Improvement Ledger

Last updated: 2026-05-03

This ledger replaces the older root-level planning snapshots:

- `DEVFORGE-MASTER-LEDGER.md`
- `COMPREHENSIVE-IMPROVEMENTS.md`
- `STABILITY_PLAN.md`
- `PERFORMANCE-PLAN.md`

Use this file as the current source of truth for completed work, active risks, and next cleanup priorities.

## Current Baseline

- App version: `0.4.8`
- Primary branch: `wip/mac-handoff-2026-02-13`
- Runtime target in this workspace: NVIDIA Spark Linux / ARM64
- Launch command: `./run-devforge-spark.sh` or `npm run app:spark`
- Main runtime surface: Electron main/preload + React/Vite renderer
- Local inference targets: Ollama, llama.cpp, OpenVINO/NPU, opt-in Mosaic/spec-decode labs

## Completed Tracks

### Core-First Cleanup

- Renderer business logic now has a small `src/core/` boundary:
  - `src/core/chatEngine.js`
  - `src/core/modelResolver.js`
  - `src/core/modelCatalogService.js`
  - `src/core/sparkAdapter.js`
  - `src/core/types.js`
- Vault workspace checks now route through shared helpers while preserving the persisted `nsfw` workspace id for compatibility.
- Model catalog source fetching and dedupe moved out of the Zustand slice and into `src/core/modelCatalogService.js`.
- Large UI surfaces were split incrementally:
  - Settings: `NPUModelConverter.jsx`, `SparkSettings.jsx`
  - Model Hub: `ModelCard.jsx`, `ModelFitIndicator.jsx`
- Spark orchestration logic moved behind `electron/services/spark-adapter.js`.

### Security and IPC Guardrails

- DOMPurify is installed and used for markdown/HTML rendering paths.
- Path validation exists at `electron/utils/pathValidator.js`.
- Rate limiting exists at `electron/utils/rateLimiter.js`.
- Main process IPC remains split between the legacy `electron/ipc-handlers.js` monolith and the modular `electron/ipc/` directory.
- The modular IPC path now includes Spark Model Hub handlers at `electron/ipc/spark-model-hub-handlers.js`.

### Performance and Resource Controls

- Memory cache/pressure helpers exist at `electron/utils/memoryManager.js`.
- Idle/power profile helpers exist at `electron/utils/idleManager.js`.
- Search indexing exists at `electron/services/searchService.js`.
- Chat V2 performance and runtime control work is documented under `docs/perf/`.
- Large speculative decoding and Mosaic experiments remain opt-in.

### Spark Linux Profile

- Spark launch profile exists at `run-devforge-spark.sh`.
- Spark runtime defaults live in `electron/services/spark-profile.js` and `electron/services/spark-retuner.js`.
- MoE detection and Spark memory estimates live in:
  - `electron/services/moe-detector.js`
  - `electron/services/spark-memory-estimator.js`
  - `electron/services/families/spark-moe-profiles.js`
- Spark-specific llama.cpp backend support exists at `electron/services/backends/llamacpp-spark-backend.js`.
- Spark inference routing adapter exists at `electron/services/spark-adapter.js`.
- Spark user guide lives at `docs/spark-linux-profile.md`.

### Spark Model Hub

- Spark Model Hub service exists at `electron/services/spark-model-hub-service.js`.
- Spark Model Hub panel exists at `src/components/ModelHub/SparkModelHubPanel.jsx`.
- Renderer Spark helpers exist at `src/core/sparkAdapter.js`.
- Spark Model Hub IPC/preload surface is wired.
- Smoke test exists at `scripts/spark-model-hub-smoke.js`.
- Original drop-in rationale is preserved at `docs/spark-model-hub-integration.md`.

### Model Warmup and Load Progress

- Load progress tracking exists at `electron/services/model-load-progress.js`.
- Renderer warmup overlay exists at `src/components/ModelExperience/WarmupOverlay.jsx`.
- Warmup state store exists at `src/stores/modelWarmupStore.js`.
- Settings NPU converter hides on Spark hosts without violating React hook order.

### Research and Long-Running Workflows

- Research project/run persistence is implemented.
- Research IPC exists under `electron/ipc/research-handlers.js`.
- Research orchestration exists under `electron/services/research/`.
- Current handoff details are preserved at `docs/handoffs/2026-02-12.md`.

## Known Open Risks

### Legacy IPC Monolith

`electron/ipc-handlers.js` is still very large and overlaps with modular handlers. New work should prefer `electron/ipc/*.js`, but a dedicated migration pass is still needed before the monolith can be retired.

### Lint Warnings

`npm run lint` currently exits successfully after the Spark cleanup, but the output still includes many warnings for unused imports/vars and hook dependency warnings across older components. Treat these as technical debt, not as release blockers unless the touched area is being modified.

### Stale Platform Scripts

Windows-only helpers (`*.bat`, `*.ps1`, `shortcut*` scripts) are still present by design. Pruning or isolating them is out of scope for the Spark cleanup and should be handled in a platform packaging pass.

### Eval Script Sprawl

The `scripts/` directory contains many one-off smoke/eval runners. They are useful for historical gates but should eventually be grouped into `scripts/eval/`, `scripts/smoke/`, and `scripts/perf/`.

### Speculative Decoding

Spec-decode correctness is wired and opt-in, but speedup gates remain open for practical asymmetric drafters. Keep it disabled by default unless explicitly testing.

## Recommended Next Work

1. Finish the `electron/ipc-handlers.js` to `electron/ipc/*.js` migration in small domain commits.
2. Continue reducing lint warnings in recently active surfaces first: `SettingsModal.jsx`, `ModelHubPanel.jsx`, `Sidebar.jsx`, and Spark-specific components.
3. Continue splitting large UI files only when actively changing them, with `Sidebar.jsx` as the next best candidate.
4. Organize smoke/eval scripts into subdirectories and update `package.json` scripts.
5. Do a separate platform packaging cleanup for Windows vs Linux artifacts and docs.

## Documentation Index

- Current product overview: `README.md`
- Release chronology: `CHANGELOG.md`
- User guide: `docs/user-guide.md`
- Spark profile: `docs/spark-linux-profile.md`
- Spark Model Hub integration rationale: `docs/spark-model-hub-integration.md`
- Runtime tracker: `docs/unified-runtime-tracker.md`
- Active notes: `docs/notes.md`
- Historical handoff: `docs/handoffs/2026-02-12.md`
