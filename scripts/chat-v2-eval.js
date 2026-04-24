#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function assertContains(haystack, needle, description, failures) {
  if (!haystack.includes(needle)) {
    failures.push(description);
  }
}

function assertNotContains(haystack, needle, description, failures) {
  if (haystack.includes(needle)) {
    failures.push(description);
  }
}

function main() {
  const failures = [];
  const app = read('src/App.jsx');
  const engine = read('src/chat-v2/engine/chatEngine.js');
  const shortTurn = read('src/chat-v2/engine/shortTurnPolicy.js');
  const runtime = read('src/chat-v2/runtime/createElectronRuntimeAdapter.js');
  const resolver = read('electron/services/llm-execution-resolver.js');
  const ui = read('src/chat-v2/ui/ChatV2Surface.jsx');
  const dataService = read('electron/services/ipc/data-service.js');
  const ollamaBackend = read('electron/services/backends/ollama-backend.js');
  const mainProcess = read('electron/main.js');
  const defaultConfig = read('electron/default-config.js');

  // App routing: Chat V2 is the default chat surface, Code has dedicated workbench.
  assertContains(
    app,
    "const ChatV2Harness = lazy(() => import('./chat-v2/ui/ChatV2Harness')",
    'App must lazy-load Chat V2 harness',
    failures
  );
  assertContains(
    app,
    "currentWorkspace === 'code' ? (",
    'App must keep Code workspace route',
    failures
  );
  assertContains(
    app,
    '<ChatV2Harness />',
    'App must render Chat V2 for non-code chat surfaces',
    failures
  );
  assertNotContains(
    app,
    'ChatArea',
    'App must not route through legacy ChatArea',
    failures
  );

  // Protected UX paths must remain available.
  assertContains(app, 'ImageGenModal', 'App must keep image generation modal wiring', failures);
  assertContains(app, 'ModelHubPanel', 'App must keep model hub modal wiring', failures);
  assertContains(app, 'DownloadCenter', 'App must keep download center modal wiring', failures);

  // Engine/runtime/UI contracts.
  assertContains(engine, 'async hydrateConversation(payload = {})', 'Chat V2 engine must support live conversation hydration', failures);
  assertContains(engine, 'async retryLastGeneration()', 'Chat V2 engine must support retry flow', failures);
  assertContains(engine, 'async regenerateLastAssistant()', 'Chat V2 engine must support regenerate flow', failures);
  assertContains(engine, 'async editUserMessage(messageId, newContent)', 'Chat V2 engine must support edit+regenerate flow', failures);
  assertContains(engine, 'async createBranchFromMessage(messageId, name = null)', 'Chat V2 engine must support branch creation', failures);
  assertContains(engine, 'async switchBranch(branchId)', 'Chat V2 engine must support branch switching', failures);
  assertContains(engine, 'async buildWebGroundingContext(prompt, runId)', 'Chat V2 engine must support research web-search tooling', failures);
  assertContains(engine, 'buildSearchQueryFromPrompt', 'Chat V2 engine must normalize web-search queries before grounding', failures);
  assertContains(engine, '[Current Clock Context]', 'Chat V2 engine must inject clock context for fresh-info prompts', failures);
  assertContains(engine, 'async buildPromptContext(prompt, historyMessages, options = {})', 'Chat V2 engine must build prompt context from app state before generation', failures);
  assertContains(engine, 'resetConversation(options = {})', 'Chat V2 engine must support clearing stale conversation state', failures);
  assertContains(engine, 'syncConversationMeta(messages = this.state.messages)', 'Chat V2 engine must sync sidebar metadata', failures);
  assertContains(engine, "['research', 'casual', 'work']", 'Chat V2 engine web-search gating must include work workspace', failures);
  assertContains(engine, 'stream_idle_timeout', 'Chat V2 engine must include idle timeout watchdog', failures);
  assertContains(engine, 'stream_hard_timeout', 'Chat V2 engine must include hard timeout watchdog', failures);
  assertContains(engine, 'workspaceSettings?.[workspace]?.systemPrompt', 'Chat V2 engine must honor workspace-configured system prompts', failures);
  assertContains(engine, 'sanitizeStreamingPreview(response)', 'Chat V2 engine must sanitize streamed output before rendering', failures);
  assertContains(engine, 'retryInvalidFinalResponse', 'Chat V2 engine must retry invalid final answers before committing them', failures);
  assertContains(engine, 'forceModelFallback', 'Chat V2 engine must carry fallback routing hints through retries', failures);
  assertContains(engine, 'shouldUseConservativeEntityFallback', 'Chat V2 engine must short-circuit unstable web-off entity lookups to a conservative fallback', failures);
  assertContains(shortTurn, 'export function sanitizeShortTurnOutput(prompt, output)', 'Short-turn policy must sanitize overlong outputs', failures);
  assertContains(shortTurn, 'export function isAssistantSelfCheckPrompt(text)', 'Short-turn policy must detect assistant self-check prompts', failures);
  assertContains(shortTurn, "I don't actually have a day", 'Short-turn policy must avoid anthropomorphic day claims', failures);
  assertContains(shortTurn, 'const GREETING_TRAILING_TOKENS = new Set([', 'Short-turn policy must recognize friendly greeting variants like "hi friend"', failures);

  assertContains(runtime, 'async loadConversation(payload = {})', 'Electron runtime adapter must support hydration bridge', failures);
  assertContains(runtime, 'async saveAttachments(payload = {})', 'Electron runtime adapter must support attachment persistence', failures);
  assertContains(runtime, 'attachmentsListByMessage', 'Electron runtime adapter must hydrate attachments on reload', failures);
  assertContains(runtime, 'messageCount', 'Electron runtime adapter must forward conversation metadata updates', failures);
  assertContains(runtime, 'async streamChat(request, onEvent)', 'Electron runtime adapter must expose streaming bridge', failures);
  assertContains(runtime, 'forceCompatMode', 'Electron runtime adapter must forward compat mode hints', failures);
  assertContains(runtime, 'forceModelFallback', 'Electron runtime adapter must forward model fallback hints', failures);
  assertContains(runtime, 'safeOnEvent({ meta: chunk.meta })', 'Electron runtime adapter must surface execution metadata from streams', failures);
  assertContains(resolver, 'buildExecutionPlan', 'Main-process resolver must expose a shared execution plan builder', failures);
  assertContains(resolver, 'CASUAL_BASELINE_FALLBACKS', 'Main-process resolver must define vetted casual fallback candidates', failures);
  assertContains(resolver, "templateMode === 'raw_prompt'", 'Main-process resolver must detect raw prompt template mode', failures);
  assertContains(ollamaBackend, "let buffer = ''", 'Ollama backend must buffer partial NDJSON lines across stream chunks', failures);
  assertContains(dataService, "branch_id = 'main'", 'Data service must treat Chat V2 main branch as root during hydration', failures);

  assertContains(ui, "import('./StreamingMarkdown')", 'Chat V2 surface must import local StreamingMarkdown module', failures);
  assertContains(ui, 'bg-black text-zinc-100', 'Chat V2 surface must keep AMOLED-first dark shell', failures);
  assertContains(ui, 'Branch:', 'Chat V2 surface must expose active branch state', failures);
  assertContains(ui, 'Retry', 'Chat V2 surface must expose retry action', failures);
  assertContains(ui, 'function buildFollowUps(state)', 'Chat V2 surface must expose quick follow-up prompts', failures);
  assertContains(ui, 'researchWebSearchEnabled', 'Chat V2 surface must persist web-search preference', failures);
  assertContains(ui, 'Web On', 'Chat V2 surface must expose web-search toggle controls', failures);
  assertContains(ui, 'ResizeObserver', 'Chat V2 surface must recompute composer height on layout changes', failures);
  assertContains(ui, 'casual baseline fallback', 'Chat V2 surface must expose fallback execution mode badges', failures);
  assertContains(ui, 'compat generate', 'Chat V2 surface must expose compat execution mode badges', failures);

  // Keep key defaults stable.
  assertContains(mainProcess, 'chat_v2_enabled: false', 'Electron store defaults must define chat_v2_enabled', failures);
  assertContains(defaultConfig, 'chat_v2_enabled: false', 'Default config must define chat_v2_enabled', failures);

  if (failures.length > 0) {
    console.error('Chat V2 Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Chat V2 Eval PASS');
}

main();
