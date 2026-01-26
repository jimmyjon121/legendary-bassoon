# DevForge Sovereign Cognitive OS (Full Plan)

## Vision
Transform DevForge into a local-first Cognitive OS: Unified Ledger (provenance + replay), Receipts-Only answers, Session Replay, Intent→Actions compiler, Counterfactual simulator, Friction-driven LMA, Soul Engine, and RetroFuture glow UI.

---

## UX Layering (Anti-Mess Architecture)

### 3-Layer Model

**Layer 1: Core (unchanged)**
- Sidebar: workspaces + conversations
- Main: Chat / Code / ImageGen / Characters as today

**Layer 2: Ambient (always light)**
- SoulIndicator (top bar): state + circadian mode
- Receipts pills on answers (only when relevant)
- Proactive nudge bubble (dismissable, rate-limited)

**Layer 3: Deep Tools (Forge Console)**
Single hub with tabs:
- Replay (timeline scrubber)
- Runs (intent→actions history)
- Forks (counterfactual comparisons)
- Mindprint (LMA adapters + training)
- Insights (Mirror dashboard)

### Anti-Mess Rules
- One new entry point only (Forge Console via Ctrl+Shift+F or command palette)
- No new permanent sidebar sections
- Progressive disclosure (default view minimal; details on click)
- Rate-limit proactive UI (max 1 nudge per 5 min)
- Mode clarity (Receipts-only / Muse labeled in input bar)
- Unified search finds everything

---

## Build Phases

### Phase 0: Visual System (RetroFuture)
- Tokens: phosphor glow, CRT amber/green, noise/scanlines
- FX overlay with quality scaler
- Motion primitives (magnetic hover, phosphor reveal)

### Phase 1: Unified Ledger Core
- ledger.db with hash chain
- IPC for events/evidence
- Baseline recording (messages, workspace switches, generation)

### Phase 2: Receipts-Only Mode
- Structured answers with receipts
- ReceiptsView drawer
- Per-workspace toggle

### Phase 3: Session Replay
- Timeline UI + event capture expansion
- Scrubber + "jump to moment"

### Phase 4: Intent→Actions (Prompt Compiler)
- Plan IR schema + validator
- Run executor with logging
- Compile sheet UI

### Phase 5: Counterfactual Simulator
- DecisionForks + predictions
- Compare/merge UI

### Phase 6: Soul Integration
- State inference + patterns
- Feed suggestions + compiler defaults

### Phase 7: LMA (llama.cpp + adapters)
- Backend integration
- Hot-load + Mindprint UI

### Phase 8: Friction Training
- FrictionSignals → datasets
- Overnight QLoRA + vault

---

## Starting Point
Begin with Phase 0 (visual tokens) + Phase 1 (ledger foundation) in parallel.

