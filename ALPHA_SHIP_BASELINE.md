# Paid Alpha Ship Baseline

Captured: 2026-05-08T21:11:52-04:00

## Final Status

PASS. The Anvil Hub paid-alpha polish gate is implemented and passing. The Electron app is treated as the paid alpha artifact, while DevForge IDE remains an optional advanced handoff path.

## Implemented Evidence

- Added `ALPHA_SHIP_PLAN.md` and this baseline.
- Added `ALPHA_README.md` for paid-alpha buyer/setup boundaries.
- Added `electron/services/alpha-readiness.js` with versioned `anvil.alphaReadiness.v1` readiness results.
- Added `alpha:getReadiness` IPC, preload exposure, and renderer API wrapper.
- Added sidebar paid-alpha readiness footer with app, Ollama/local model runtime, selected model, Vault/default policy, DevForge handoff, and storage checks.
- Added title-bar alpha readiness pill so setup state is visible without opening the sidebar.
- Updated Code workspace copy to **Quick Code Workspace** and **Open Full DevForge IDE**.
- Removed fake-feeling Code page toolbar actions from the rendered alpha surface.
- Replaced edit-implying quick actions (`Refactor`, `Write Tests`, `Document`) with read/advice-oriented prompts.
- Updated package metadata and installer shortcut so the paid artifact presents as **Anvil** while keeping internal package names unchanged.
- Added `scripts/alpha-ship-smoke.mjs`, `npm run eval:alpha-ship`, and release-gate coverage.

## Command Evidence

### Alpha smoke

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH npm run eval:alpha-ship
```

Result:

```text
PASS
checked:
- Anvil app metadata/version
- paid alpha README boundary
- versioned alpha readiness object
- local model runtime setup guidance
- selected model/storage/policy/handoff checks
- Quick Code Workspace copy
- Open Full DevForge IDE handoff copy
- alpha-blocked fake actions hidden
- readiness IPC wiring
- title bar alpha readiness pill
- release gate includes alpha smoke
- DevForge handoff smoke
- IPC security smoke
status: ready
```

### DevForge handoff smoke

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH npm run eval:devforge-handoff
```

Result:

```text
PASS
checked:
- project validation
- devforge protocol URL
- shared ~/.devforge-style home
- protocol mismatch skip
- launcher fallback
- isolated IDE profile args
- linux dev launch flags
- sanitized inherited extension-host env
- raw binary dot arg
- forced protocol path
- versioned handoff metadata
```

### IPC security

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH npm run eval:ipc-security
```

Result:

```text
IPC Security Eval PASS
```

### Targeted lint/syntax

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH ./node_modules/.bin/eslint src/components/Layout/Layout.jsx src/components/Sidebar/Sidebar.jsx src/components/Code/CodeWorkbench.jsx src/components/Code/CodeEditor.jsx src/components/Code/CodeChatPanel.jsx src/utils/electronAPI.js scripts/alpha-ship-smoke.mjs
```

Result:

```text
PASS
```

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH node -c electron/services/alpha-readiness.js && PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH node -c electron/ipc-handlers.js
```

Result:

```text
PASS
```

### App build

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH npm run build:app
```

Result:

```text
PASS
✓ 3623 modules transformed.
✓ built in 29.81s
```

Warnings:

```text
Browserslist: browsers data (caniuse-lite) is 6 months old.
modelWarmupStore.js is dynamically imported and statically imported, so dynamic import will not move it into another chunk.
Some chunks are larger than 1000 kB after minification.
```

### Release gate

Command:

```sh
PATH=/home/fredbowl2023/.local/node-v22.14.0-linux-arm64/bin:$PATH npm run eval:release-gate
```

Result:

```text
Release Gate PASS
```

Included alpha evidence:

```text
Running alpha-ship gate... PASS
```

## Remaining Warnings / Follow-Up

- Build chunk-size warnings remain from the existing bundle shape.
- Browserslist/caniuse-lite data is stale.
- The Anvil paid alpha does not package the DevForge IDE; DevForge is still launched through configured checkout/binary handoff.
- Payment/licensing is intentionally out of scope for this pass.

## Rollback Instructions

To roll back this alpha polish pass, revert:

- `ALPHA_SHIP_PLAN.md`
- `ALPHA_SHIP_BASELINE.md`
- `electron/services/alpha-readiness.js`
- `scripts/alpha-ship-smoke.mjs`
- `ALPHA_README.md`
- `scripts/release-gate.js`
- alpha readiness IPC additions in `electron/ipc-handlers.js` and `electron/preload.js`
- `getAlphaReadiness` in `src/utils/electronAPI.js`
- Anvil/alpha UI copy and readiness footer changes in `src/components/Layout/Layout.jsx`, `src/components/Sidebar/Sidebar.jsx`, and `src/components/Code/*`
- `eval:alpha-ship` and `build.productName` metadata changes in `package.json`
