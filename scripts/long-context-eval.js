#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Long-context eval (Phase 0 gate).
 *
 * Static-analysis check that the stacked num_ctx clamps have been removed
 * or narrowed so that the model's real n_ctx_train can reach the backend.
 *
 * This does NOT spawn Ollama or run real inference — it verifies the code
 * paths that were silently truncating context no longer do so. A follow-up
 * live-inference smoke script will run under `eval:live-chat-smoke` once
 * llamanode lands.
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
  const buildOptions = read('src/chat-v2/runtime/buildInferenceOptions.js');
  const ipcHandlers = read('electron/ipc-handlers.js');
  const clampUtil = read('src/chat-v2/runtime/inferenceOptionsUtil.js');
  const ollamaHelper = read('electron/services/ollama-helper.js');
  const autoSetup = read('electron/services/auto-setup.js');

  // Orchestrator: balanced/speed must NOT hard-cap num_ctx against 12288 or 4096.
  // The old pattern was `const maxCtx = isCuda ? (profile === 'efficiency' ? 8192 : 12288) : 4096`.
  // The new pattern scopes clamps to conservativeProfile only.
  assert(
    !/maxCtx = isCuda \? \(profile === 'efficiency' \? 8192 : 12288\)/.test(orchestrator),
    'Orchestrator still contains unconditional isCuda maxCtx clamp',
    failures
  );
  assert(
    orchestrator.includes("const conservativeProfile = profile === 'efficiency' || profile === 'laptop'"),
    'Orchestrator must gate context clamps on conservativeProfile (efficiency/laptop)',
    failures
  );
  assert(
    /if \(conservativeProfile\)\s*\{/.test(orchestrator),
    'Orchestrator must wrap maxCtx/maxPredict/maxBatch math inside the conservativeProfile branch',
    failures
  );

  // Orchestrator: keep_alive default must be profile-aware, not a flat 8m.
  assert(
    !orchestrator.includes("normalized.keep_alive = profile === 'efficiency' ? '3m' : '8m';"),
    'Orchestrator still uses flat 8m keep_alive default',
    failures
  );
  assert(
    orchestrator.includes("normalized.keep_alive = -1;"),
    'Orchestrator must default keep_alive to -1 for balanced/speed (LM Studio-style residency)',
    failures
  );

  // buildInferenceOptions: casual clamp must be gated on fastChatMode, not on workspaceType alone.
  assert(
    !/if \(workspaceType === 'casual' && !hasExplicitPreset\) \{\s*if \(Number\.isFinite\(Number\(options\.num_ctx\)\)\)/.test(buildOptions),
    'buildInferenceOptions still applies unconditional casual num_ctx clamp',
    failures
  );
  assert(
    buildOptions.includes('const fastChatEnabled = Boolean(appState.fastChatMode);'),
    'buildInferenceOptions must read fastChatMode from app state',
    failures
  );
  assert(
    buildOptions.includes("if (fastChatEnabled && workspaceType === 'casual' && !hasExplicitPreset && !hasUserContextOverride)"),
    'buildInferenceOptions must gate casual clamp on fastChatEnabled AND workspaceType AND no explicit preset AND no user context override',
    failures
  );

  // ipc-handlers: buildGenerateCompatRequest must not apply a flat 16384 cap to non-gpt-oss models.
  assert(
    !/const cappedCtx = isGptOss \? 8192 : 16384;/.test(ipcHandlers),
    'buildGenerateCompatRequest still uses flat cappedCtx = 16384 for non-gpt-oss raw-template models',
    failures
  );
  assert(
    /const resolvedCtx = isGptOss[\s\S]{0,200}Math\.min\(baseCtx \?\? 8192, 8192\)/.test(ipcHandlers),
    'buildGenerateCompatRequest must keep 8K cap only for isGptOss, trusting baseOptions.num_ctx otherwise',
    failures
  );

  // clampInferenceOptionsToModel remains the single source of truth.
  assert(
    clampUtil.includes('export function clampInferenceOptionsToModel'),
    'inferenceOptionsUtil must export clampInferenceOptionsToModel',
    failures
  );
  assert(
    clampUtil.includes('export function resolveEffectiveContextLength'),
    'inferenceOptionsUtil must export resolveEffectiveContextLength',
    failures
  );

  // Env var defaults: balanced/speed should be long (24h) rather than 8m.
  assert(
    !/OLLAMA_KEEP_ALIVE \|\| '8m'/.test(autoSetup),
    'auto-setup.js still defaults OLLAMA_KEEP_ALIVE to 8m',
    failures
  );
  assert(
    /OLLAMA_KEEP_ALIVE \|\| '24h'/.test(autoSetup),
    'auto-setup.js must default OLLAMA_KEEP_ALIVE to 24h',
    failures
  );
  assert(
    !/OLLAMA_KEEP_ALIVE \|\| '8m'/.test(ollamaHelper),
    'ollama-helper.js still defaults OLLAMA_KEEP_ALIVE to 8m',
    failures
  );
  assert(
    /OLLAMA_KEEP_ALIVE \|\| '24h'/.test(ollamaHelper),
    'ollama-helper.js must default OLLAMA_KEEP_ALIVE to 24h',
    failures
  );

  if (failures.length > 0) {
    console.error('Long-context gate FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Long-context gate PASS');
}

main();
