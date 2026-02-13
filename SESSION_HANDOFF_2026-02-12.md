# DevForge Session Handoff (2026-02-12)

## 1) Executive summary
This session focused on two major tracks:

- Deep Research system (project-based, multi-agent, long-running, official-source gated) with a more chat-like UX and stronger relevance filtering.
- Model Hub / catalog expansion work (from prior handoff in this thread), including larger Ollama catalog exposure and richer model browsing.

You can use this file as the complete carry-forward context for a new chat.

---

## 2) What is currently built (Research)

### Backend data model + persistence
Research tables are created in DB init and indexed:
- `research_projects`
- `research_project_conversations`
- `research_project_documents`
- `research_runs`
- `research_tasks`
- `research_records`
- `research_evidence`
- `research_checkpoints`

Reference:
- `electron/ipc-handlers.js:407`
- `electron/ipc-handlers.js:592`

### Research orchestration engine
Main-process long-running orchestrator is in place with:
- Coordinator + worker phases (`discover`, `official_verify`, `extract_fields`, `evidence_validate`, `persist`)
- Checkpointing + resume support
- Convergence-based stopping
- Run progress snapshots + event stream (`recentActivity`, `domainStats`, `goalProgress`)
- Depth presets (`standard`, `deep`, `exhaustive`) including long-run goals

Reference:
- `electron/services/research/research-orchestrator.js`
- `electron/services/research/research-orchestrator.js:143`
- `electron/services/research/research-orchestrator.js:1167`
- `electron/services/research/research-orchestrator.js:1817`

### Stronger relevance and record safety gates
Added/confirmed:
- Topic relevance scoring (prevents off-topic pages)
- Program-specificity gate before save (blocks generic official pages that are not treatment programs)

Key additions in this session:
- `PROGRAM_SIGNAL_TERMS`
- `PROGRAM_DISQUALIFY_TERMS`
- `assessProgramSpecificity(...)`
- Block reason: `insufficient_program_specificity`

Reference:
- `electron/services/research/research-orchestrator.js:471`
- `electron/services/research/research-orchestrator.js:523`
- `electron/services/research/research-orchestrator.js:1596`

### IPC + preload + renderer API
Research IPC exists for:
- project CRUD
- linking chats/docs
- run lifecycle (start/pause/resume/cancel/list/get)
- record/evidence list/get
- export (json/csv/md)
- run progress channel

Reference:
- `electron/ipc/research-handlers.js`
- `electron/ipc/research-handlers.js:61`
- `electron/preload.js:384`
- `src/utils/electronAPI.js:320`

### Research UI (current behavior)
`ResearchWorkspace` is mounted as its own workspace and includes:
- Chat-like run feed card
- Live worker activity list
- Source domain panel (where searches are coming from)
- Run history cards + controls
- Verified records list + evidence detail drawer
- Guided state helper
- Advanced options (task/output/workers/depth/strict topic lock)
- Inspector tabs (`setup`, `sources`, `schema`, `audit`)
- Export button for `MD (Cursor)`

Reference:
- `src/components/Chat/ChatArea.jsx:31`
- `src/components/Research/ResearchWorkspace.jsx:850`
- `src/components/Research/ResearchWorkspace.jsx:967`
- `src/components/Research/ResearchWorkspace.jsx:1180`
- `src/components/Research/ResearchWorkspace.jsx:1731`

### Clarifying prompts in composer (added this session)
Added click-to-append clarifier chips in the composer to make prompt shaping feel more conversational:
- Detects missing location/age/care-level/gender hints
- Shows compact suggestions
- Appends suggestion text directly to the objective

Reference:
- `src/components/Research/ResearchWorkspace.jsx:197`
- `src/components/Research/ResearchWorkspace.jsx:753`
- `src/components/Research/ResearchWorkspace.jsx:762`
- `src/components/Research/ResearchWorkspace.jsx:1180`

---

## 3) What is currently built (Model Hub)
From the prior in-thread handoff (already present in repo):

- Live Ollama catalog expansion:
  - `getRemoteLibraryModels(...)`
  - `getCatalogModels(...)`
  - provider option support for `popular`, `all`, `newest`
- ModelHubPanel wiring for broader catalog loading and larger result slices
- Catalog count display in UI

Reference:
- `electron/services/model-providers.js:527`
- `electron/services/model-providers.js:582`
- `electron/services/model-providers.js:1398`
- `src/components/ModelHub/ModelHubPanel.jsx:2710`
- `src/components/ModelHub/ModelHubPanel.jsx:3433`
- `src/components/ModelHub/ModelHubPanel.jsx:3560`

---

## 4) Known issues still open

### A) Model download event serialization failures (important)
You reported repeated:
- `Error sending from webFrameMain: Error: Failed to serialize arguments`

Likely source path:
- `electron/ipc-handlers.js` around provider pull progress emits
- `electron/ipc-handlers.js:4522`
- `electron/services/model-downloader.js:39`

Status: not fully resolved in this session.

### B) Intermittent `startOllamaDownload is not a function`
You reported:
- `TypeError: modelDownloader.startOllamaDownload is not a function`

Current code now includes a guard path before calling it:
- `electron/ipc-handlers.js:4535`

Status: guard exists, but full root-cause hardening (service load/order) should still be verified end-to-end.

### C) Research quality expectation gap
Your target is true deep-research behavior (45+ min, very large search breadth, highly visible search trace). Engine supports long-run presets now, but further UX + policy tightening can still be done:
- stricter domain allow/block controls in UI
- clearer source quality scoring surfaced in feed
- better summarization checkpoints while long run is active

---

## 5) Validation performed in this session
Ran build successfully:
- `npm run build:app`

Result:
- Build passed.
- Large chunk warnings remain (non-blocking, existing pattern).

---

## 6) Files touched in this session

Primary files:
- `electron/services/research/research-orchestrator.js`
- `src/components/Research/ResearchWorkspace.jsx`

Also verified context in:
- `electron/ipc/research-handlers.js`
- `electron/ipc-handlers.js`
- `electron/services/model-providers.js`
- `src/components/ModelHub/ModelHubPanel.jsx`

---

## 7) Suggested immediate next steps (new chat)
1. Fix provider download serialization bug first (stability blocker).
2. Add explicit source-policy controls to Research UI:
   - strict official domains only
   - block directory/review/social domains
   - min-source-count and min-runtime locks per project
3. Refine Research UX into an even more chat-native timeline:
   - persistent progress milestones
   - grouped source batches
   - clickable search trace for each worker cycle
4. Add an automatic per-run markdown export package:
   - clinical dossier markdown
   - family write-up markdown
   - evidence appendix markdown

---

## 8) New chat starter prompt
Use this in your next chat:

"Read `SESSION_HANDOFF_2026-02-12.md` and continue implementation from there. Prioritize fixing the model download serialization error and then make Research fully chat-native with transparent deep-search progress and strict official-source controls for FFAS workflows."
