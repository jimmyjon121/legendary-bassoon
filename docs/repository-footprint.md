# Repository footprint

Snapshot of **documentation layout**, **large or generated artifacts**, and **notable source hot spots**. Use this when pruning noise, onboarding, or planning splits.

## Documentation map

| Area | Role |
|------|------|
| [README.md](../README.md) | Product overview, quick start, main doc links |
| [CHANGELOG.md](../CHANGELOG.md) | Versioned release notes |
| [REFACTOR-LOG.md](../REFACTOR-LOG.md) | Healthy-weight refactor branch slice log |
| [docs/architecture.md](architecture.md) | High-level system shape |
| [docs/ipc-api.md](ipc-api.md) | Renderer ↔ main IPC contract |
| [docs/agent-harness-approved-plan.md](agent-harness-approved-plan.md) | Canonical coding-agent harness plan |
| [ALPHA_README.md](../ALPHA_README.md) | Paid-alpha product scope, boundaries, DevForge IDE handoff |
| [ALPHA_SHIP_PLAN.md](../ALPHA_SHIP_PLAN.md) / [ALPHA_SHIP_BASELINE.md](../ALPHA_SHIP_BASELINE.md) | Alpha ship checklist and baseline notes |
| [docs/IMPROVEMENT-LEDGER.md](IMPROVEMENT-LEDGER.md) | Consolidated improvement / planning ledger |
| [docs/release-notes.md](release-notes.md) | Long-form release material (moved from root) |
| [docs/handoffs/](handoffs/) | Human handoff notes (e.g. `2026-02-12.md`) |
| [docs/perf/](perf/) | Baselines, Mosaic gates, spec-decode measurements, JSON profiles |
| [docs/wireless-brain-*.md](wireless-brain-plan.md) | Secure remote-access design set |
| [scripts/setup-openvino.md](../scripts/setup-openvino.md) | OpenVINO setup |
| [.cursor/plans/](../.cursor/plans/) | Cursor-generated planning stubs (often duplicate themes in `docs/`) |
| [native/mosaic-coordinator/README.md](../native/mosaic-coordinator/README.md) | Native Mosaic coordinator |

**Research typings:** [docs/HarnessResearch.ts](HarnessResearch.ts) is TypeScript notes/research scaffolding, not end-user prose.

### `REFACTOR-BASELINE/` (baseline captures)

Roughly **~800 KB** of **slice/baseline snapshots**: lint logs, LOC counts, IPC channel inventories, eval outputs, `tracked-files.txt`, patches. These are intentionally frozen audit artifacts from the refactor safety net—not everyday reading. Safe to archive elsewhere if you want a slimmer clone; deleting should be a deliberate archival decision because some entries are referenced from [REFACTOR-LOG.md](../REFACTOR-LOG.md).

## Heavy directories on disk (usually not in Git)

| Path | Typical size | Notes |
|------|----------------|-------|
| `node_modules/` | Large | Dependencies; ignored |
| `.tooling/` | ~230 MB repo-local Node tarball + unpack | Embedded toolchain; ignored |
| `release/` | ~270 MB unpacked Linux app here | Electron build output; ignored |
| `dist/` | Varies | Vite/Electron intermediates; ignored |

If `release/` or `.tooling/` exist locally, they dominate working-tree size—they should **never** need committing (see [.gitignore](../.gitignore)).

## Heavy or “god file” sources (tracked)

These are legitimate code but disproportionately broad; edits deserve extra review and eventual decomposition:

| File | Approx. LOC | Notes |
|------|-------------|-------|
| `electron/ipc-handlers.js` | ~10k+ | Central IPC registrations; grows with features |
| `src/components/ModelHub/ModelHubPanel.jsx` | ~6k+ | Large composite UI surface |
| `src/services/agents/agentOrchestrator.js` | ~2k+ | Agent routing and tool orchestration |

## `.gitignore` and `.txt` files

The root [.gitignore](../.gitignore) ignores **`*.txt`** globally (with narrow exceptions). New narrative docs should prefer **Markdown** (`*.md`) or adjust ignore rules deliberately so text fixtures are not silently omitted from commits.
