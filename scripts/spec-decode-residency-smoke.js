#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Phase 2 unblock contract smoke (v0.4.4).
 *
 * Static-only — never touches live NPU/CUDA hardware. Verifies:
 *   1. The orchestrator exposes `prewarmSpecDecodeVerifier(model, opts)`
 *      and short-circuits with a `{ skipped }` reason when spec-decode
 *      is gated off, never throws.
 *   2. The llamanode backend's `loadModel` is idempotent for a matching
 *      path + ctx (no-op fast path returns `{ already: true }`).
 *   3. Python NPU server's `/draft/session` opens a chat-mode session
 *      via `LLMPipeline.start_chat()` when supported, falls back
 *      gracefully when not, and reports the mode back to callers.
 *   4. `/draft/session/{id}/extend` feeds delta-only text into the pipe
 *      when chat-mode is active and falls back to full-prompt on a
 *      single failed delta call.
 *   5. `/draft/session/{id}` close path calls `finish_chat()` when the
 *      session was chat-mode-active.
 *   6. ChatV2Harness fires the prewarm hook on model change.
 *   7. IPC + preload + electronAPI surfaces are wired.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];

  const orchestrator = read('electron/services/inference-orchestrator.js');
  const llamanode = read('electron/services/backends/llamanode-backend.js');
  const npuServer = read('scripts/start-npu-server.py');
  const harness = read('src/chat-v2/ui/ChatV2Harness.jsx');
  const ipc = read('electron/ipc-handlers.js');
  const preload = read('electron/preload.js');
  const electronApi = read('src/utils/electronAPI.js');

  assert(
    /async prewarmSpecDecodeVerifier\(mainModel,\s*options\s*=\s*\{\}\)\s*\{/.test(orchestrator),
    'orchestrator must expose async prewarmSpecDecodeVerifier(mainModel, options)',
    failures,
  );
  assert(
    orchestrator.includes("warmed: false, skipped: 'spec_decode_disabled_by_default'"),
    'prewarmSpecDecodeVerifier must short-circuit when spec-decode is disabled by default',
    failures,
  );
  assert(
    orchestrator.includes("warmed: false, skipped: 'pair_auto_disabled'"),
    'prewarmSpecDecodeVerifier must respect pair auto-disable',
    failures,
  );
  assert(
    orchestrator.includes("warmed: false, skipped: 'verifier_gguf_unavailable'"),
    'prewarmSpecDecodeVerifier must skip when no local GGUF resolves for the verifier',
    failures,
  );
  assert(
    /try\s*\{\s*const result = await backend\.loadModel\(verifierModel,\s*\{\s*contextSize\s*\}\);/.test(orchestrator),
    'prewarmSpecDecodeVerifier must call llamanode loadModel with verifierModel + contextSize',
    failures,
  );

  assert(
    /if \(this\._current[\s\S]{0,180}return\s*\{\s*success:\s*true,\s*already:\s*true,\s*metadata:\s*this\._current\.metadata\s*\};/.test(llamanode),
    'llamanode loadModel must short-circuit with `already: true` for matching path + ctx',
    failures,
  );

  assert(
    npuServer.includes("if hasattr(state.genai_pipe, 'start_chat'):"),
    'NPU server must guard start_chat() behind a hasattr check',
    failures,
  );
  assert(
    npuServer.includes("'chat_mode_active': chat_mode_active"),
    'NPU server /draft/session response must include chat_mode_active',
    failures,
  );
  assert(
    npuServer.includes("'chat_mode_skip_reason': chat_mode_skip_reason"),
    'NPU server /draft/session response must include chat_mode_skip_reason',
    failures,
  );
  assert(
    npuServer.includes('generate_input = full_text[last_full_text_len:]'),
    'NPU server extend must feed delta-only generate_input when chat-mode is active',
    failures,
  );
  assert(
    npuServer.includes("'generate_mode': generate_mode"),
    'NPU server extend response must report generate_mode (full vs delta vs full-fallback)',
    failures,
  );
  assert(
    npuServer.includes("generate_mode = 'full-fallback'"),
    'NPU server extend must downgrade to full-prompt when delta generate raises',
    failures,
  );
  assert(
    npuServer.includes("hasattr(state.genai_pipe, 'finish_chat')"),
    'NPU server close path must call finish_chat() when available',
    failures,
  );

  assert(
    harness.includes("api.prewarmSpecDecodeVerifier === 'function'") || harness.includes("typeof api.prewarmSpecDecodeVerifier !== 'function'"),
    'ChatV2Harness must guard prewarm call behind a typeof check',
    failures,
  );
  assert(
    /api\.prewarmSpecDecodeVerifier\(\{\s*model:\s*currentModel\s*\}\)/.test(harness),
    'ChatV2Harness must invoke prewarmSpecDecodeVerifier({ model: currentModel })',
    failures,
  );

  assert(
    ipc.includes("ipcMain.handle('orchestrator:prewarmSpecDecodeVerifier'"),
    'ipc-handlers must register orchestrator:prewarmSpecDecodeVerifier',
    failures,
  );
  assert(
    preload.includes("prewarmSpecDecodeVerifier: (payload) => ipcRenderer.invoke('orchestrator:prewarmSpecDecodeVerifier'"),
    'preload must bridge prewarmSpecDecodeVerifier',
    failures,
  );
  assert(
    electronApi.includes('prewarmSpecDecodeVerifier:'),
    'electronAPI must expose prewarmSpecDecodeVerifier',
    failures,
  );

  if (failures.length) {
    console.error('Spec-decode residency smoke FAILED');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log('spec-decode-residency-smoke PASS');
}

main();
