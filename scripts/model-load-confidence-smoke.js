#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createModelLoadConfidence, CHECK_IDS } = require(path.join(ROOT, 'electron/services/model-load-confidence'));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function checkById(result, id) {
  return (result.checks || []).find((check) => check.id === id) || null;
}

function main() {
  const failures = [];
  const service = createModelLoadConfidence({});

  const missingModel = service.resolveLoadConfidence({});
  assert(missingModel.status === 'blocked', 'missing model must return blocked', failures);
  assert(checkById(missingModel, 'model')?.status === 'blocked', 'missing model check must be blocked', failures);

  const missingPath = path.join(os.tmpdir(), `devforge-missing-${Date.now()}-24B-Q4_K_M.gguf`);
  const missingGguf = service.resolveLoadConfidence({
    model: `gguf:${missingPath}`,
    runtimeState: { currentBackend: { id: 'llamanode' } },
    effectiveOptions: { num_ctx: 4096, num_batch: 64 },
  });
  assert(missingGguf.status === 'blocked', 'missing local GGUF file must return blocked', failures);
  assert(checkById(missingGguf, 'file')?.status === 'blocked', 'missing GGUF file check must be blocked', failures);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devforge-mlc-'));
  const ggufPath = path.join(tempDir, 'Example-24B-Q4_K_M.gguf');
  fs.writeFileSync(ggufPath, '');
  const riskyGguf = service.resolveLoadConfidence({
    model: `gguf:${ggufPath}`,
    runtimeState: { currentBackend: { id: 'llamanode' } },
    modelInfo: { contextLength: 8192 },
    effectiveOptions: { num_ctx: 16384, num_batch: 192, kv_cache_type: 'q8_0' },
  });
  assert(riskyGguf.status === 'check', `large risky GGUF must return check (got ${riskyGguf.status})`, failures);
  assert(riskyGguf.suggestedActions.includes('apply_safe_fit'), 'large risky GGUF must suggest Safe Fit', failures);
  assert(checkById(riskyGguf, 'safe_fit')?.status === 'check', 'Safe Fit check must flag risky large GGUF', failures);

  const safeGguf = service.resolveLoadConfidence({
    model: `gguf:${ggufPath}`,
    runtimeState: { currentBackend: { id: 'llamanode' } },
    modelInfo: { contextLength: 8192 },
    advancedOverrides: { num_ctx: 4096, num_batch: 64, kv_cache_type: 'q4_0' },
    effectiveOptions: { num_ctx: 4096, num_batch: 64, kv_cache_type: 'q4_0' },
  });
  assert(checkById(safeGguf, 'safe_fit')?.status === 'ok', 'Safe Fit active must improve safe_fit check', failures);

  const noBackend = service.resolveLoadConfidence({
    model: 'qwen2.5:7b',
    runtimeState: {},
    effectiveOptions: { num_ctx: 4096 },
  });
  assert(noBackend.status === 'blocked', 'backend unavailable must block confidence', failures);
  assert(noBackend.suggestedActions.includes('refresh_runtime'), 'backend unavailable must suggest refresh_runtime', failures);

  const serviceSource = read('electron/services/model-load-confidence.js');
  const ipcSource = read('electron/ipc-handlers.js');
  const preloadSource = read('electron/preload.js');
  const apiSource = read('src/utils/electronAPI.js');
  const surfaceSource = read('src/chat-v2/ui/ChatV2Surface.jsx');
  const releaseGate = read('scripts/release-gate.js');

  ['model', 'file', 'metadata', 'backend', 'context', 'memory', 'preset', 'safe_fit', 'warmup', 'last_good'].forEach((id) => {
    assert(CHECK_IDS.has(id), `CHECK_IDS must include ${id}`, failures);
  });
  assert(serviceSource.includes('model_load_outcomes')
    && serviceSource.includes('recordLoadOutcome')
    && serviceSource.includes('getLastKnownGood'),
  'load confidence must persist local last-known-good outcomes', failures);
  assert(!serviceSource.includes('DEVFORGE_SPEC_DECODE_ENABLE'), 'load confidence must not enable speculative decoding', failures);
  assert(!serviceSource.includes("ALLOWED_FORCE_BACKENDS.add('mosaic')"), 'load confidence must not expose Mosaic routing', failures);
  [
    'model:resolveLoadConfidence',
    'model:recordLoadOutcome',
    'model:getLastKnownGood',
  ].forEach((channel) => {
    assert(ipcSource.includes(channel), `IPC must expose ${channel}`, failures);
  });
  assert(ipcSource.includes('sanitizeLoadConfidencePayload'), 'IPC must sanitize load confidence payloads', failures);
  assert(preloadSource.includes('resolveModelLoadConfidence')
    && preloadSource.includes('recordModelLoadOutcome')
    && preloadSource.includes('getLastKnownGoodModelLoad'),
  'preload must bridge load confidence methods', failures);
  assert(apiSource.includes('resolveModelLoadConfidence')
    && apiSource.includes('recordModelLoadOutcome')
    && apiSource.includes('getLastKnownGoodModelLoad'),
  'renderer API wrapper must expose load confidence helpers', failures);
  assert(surfaceSource.includes('loadConfidence')
    && surfaceSource.includes('Load Confidence')
    && surfaceSource.includes('lastKnownGoodProfile')
    && surfaceSource.includes('warmupResult')
    && surfaceSource.includes('recordModelLoadOutcome')
    && surfaceSource.includes('Local GGUF'),
  'Chat V2 must render confidence, warmup, local GGUF, and last-known-good state', failures);
  assert(releaseGate.includes('model-load-confidence'), 'release gate must include model-load-confidence smoke', failures);

  try { fs.unlinkSync(ggufPath); fs.rmdirSync(tempDir); } catch (_) {}

  if (failures.length) {
    console.error('model-load-confidence-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('model-load-confidence-smoke PASS');
}

main();
