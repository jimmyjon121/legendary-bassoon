# Anvil Paid Alpha

Anvil paid alpha is the hub app: local chat, model management, Vault/private workspace affordances, research workflows, image tools, and quick code inspection.

DevForge IDE is the optional deep-coding companion. If it is configured, Anvil can open the current project in DevForge. If it is not configured, Anvil remains useful and shows setup guidance instead of pretending the IDE is bundled.

## What Is Ready

- Local-first chat and model selection.
- Model hub and runtime controls for local models.
- Vault/default privacy state surfaced in the app.
- Research and workspace organization surfaces.
- Quick Code Workspace for inspection, file browsing, project chat, and quick-agent tasks.
- Optional **Open Full DevForge IDE** handoff for deep coding sessions.
- Paid-alpha readiness checks in the title bar and sidebar.

## Early-Access Boundaries

- The first paid artifact is **Anvil Hub only**.
- DevForge IDE is not packaged with this alpha build.
- Code actions in the hub are intentionally read/advice-oriented unless explicitly wired.
- Payment/licensing is not implemented in-app yet; distribution can be manual/private.
- Large-bundle and stale Browserslist build warnings are known and tracked in `ALPHA_SHIP_BASELINE.md`.

## Local Setup Checklist

1. Start Ollama or your configured local model runtime.
2. Select a local chat model in Anvil.
3. Open the sidebar readiness panel and confirm runtime, model, policy, handoff, and storage checks.
4. For deep coding, set `DEVFORGE_IDE_BINARY` or `DEVFORGE_IDE_CHECKOUT`, then use **Open Full DevForge IDE** from the Code workspace.

## Privacy Posture

Anvil alpha is built around local-first defaults. Readiness and handoff logs store metadata such as paths, status, process IDs, versions, and setup errors. They must not store raw prompts, raw file contents, or private workspace content.
