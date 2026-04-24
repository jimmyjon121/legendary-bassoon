# Dead Path Inventory (Phase 3)

Generated during Chat V2 cutover cleanup to track orphaned or dormant paths before deletion.

| Path | Status | LOC | Decision | Owner Note |
| --- | --- | ---: | --- | --- |
| `src/components/Soul/SoulIndicator.jsx` | Orphaned | 302 | Keep parked | Preserve for potential Soul UI revival. |
| `src/components/ForgeConsole/ForgeConsole.jsx` | Orphaned | 1474 | Keep parked | Preserve for future Forge workflow buildout. |
| `src/components/FX/FXOverlay.jsx` | Orphaned | 97 | Keep parked | Preserve visual FX prototype for later integration. |
| `src/components/Sidebar/SidebarStats.jsx` | Removed | 191 | Completed | Removed from the active runtime. |
| `src/components/Demo/AnimationShowcase.jsx` | Removed | 374 | Completed | Removed from the active runtime. |
| `src/stores/commandsStore.js` | Orphaned | 95 | Remove | No consumers in current app shell. |
| `src/components/CommandPalette/CommandPalette.jsx` | Removed | 343 | Completed | Removed after chat shell simplification. |
| `src/components/Search/GlobalSearch.jsx` | Removed | 361 | Completed | Removed after chat shell simplification. |
| `src/hooks/useSearch.js` | Orphaned | 88 | Remove | No hook consumers. |
| `src/components/Chat/ChatArea.jsx` | Dormant | 946 | Remove | Legacy Chat V1 root; not mounted by `App`. |
| `src/components/Chat/*` (except `StreamingMarkdown.jsx`) | Dormant | ~6200 | Remove | Legacy Chat V1 subtree only reachable via `ChatArea`. |
| `src/stores/casualStore.js` | Dormant | 279 | Remove | Only used by legacy Chat V1 components. |
| `src/hooks/useTypingAnalyzer.js` | Dormant | 249 | Remove | Only used by legacy Chat V1. |
| `scripts/casual-eval.js` | Active | 83 | Keep | Targets `messageSlice` heuristics rather than deleted V1 UI files. |
| `scripts/chat-v2-eval.js` | Active | 247 | Keep | Already aligned with Chat V2 default routing and current shell contracts. |
| `scripts/perf-chat-stream.js` | Active | 71 | Keep | Already targets `src/chat-v2/` surface and engine checks. |

