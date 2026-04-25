#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Draft Selector smoke (Phase 2 gate).
 *
 * Verifies the speculative-decoding pair table is wired correctly:
 *   - Curated table covers our shipped main-model families.
 *   - getDraftFor returns sensible drafts for representative mains.
 *   - User override file at scripts/draft-pairs.json takes precedence.
 *   - validatePair refuses pairs with mismatched tokenizer hashes.
 *   - IPC + preload + electronAPI surfaces are present.
 *
 * Static-analysis only; does not require the live NPU server.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];

  // ─── Service exists and exports the expected API ───────────────
  const selectorPath = path.join(ROOT, 'electron/services/draft-selector.js');
  assert(fs.existsSync(selectorPath), 'electron/services/draft-selector.js must exist', failures);
  if (!fs.existsSync(selectorPath)) {
    console.error('Draft Selector smoke FAILED: service file missing');
    process.exit(1);
  }

  const selector = require(selectorPath);
  assert(typeof selector.getDraftFor === 'function', 'draft-selector must export getDraftFor', failures);
  assert(typeof selector.listSupportedMains === 'function', 'draft-selector must export listSupportedMains', failures);
  assert(typeof selector.validatePair === 'function', 'draft-selector must export validatePair', failures);
  assert(Array.isArray(selector.CURATED_PAIRS), 'draft-selector must expose CURATED_PAIRS', failures);

  // ─── Curated pair sanity ───────────────────────────────────────
  const fixtures = [
    { main: 'qwen2.5:7b', expectedFamily: 'qwen2.5' },
    { main: 'Qwen2.5-14B-Instruct', expectedFamily: 'qwen2.5' },
    { main: 'qwen2.5-coder:14b', expectedFamily: 'qwen2.5-coder' },
    { main: 'llama3.1:8b', expectedFamily: 'llama3.1' },
    { main: 'deepseek-r1:14b', expectedFamily: 'deepseek-r1' },
    { main: 'phi-4:14b', expectedFamily: 'phi-4' },
  ];
  for (const fx of fixtures) {
    const result = selector.getDraftFor(fx.main);
    assert(
      result && result.draftModelId,
      `getDraftFor("${fx.main}") must return a draft pair`,
      failures
    );
    assert(
      !result || (result.score >= 0.7 && result.source !== 'heuristic'),
      `Curated pair for ${fx.main} should score >= 0.7 and source=curated (got ${result?.source}/${result?.score})`,
      failures
    );
    assert(
      !result || result.family === fx.expectedFamily,
      `Family for ${fx.main} should be ${fx.expectedFamily} (got ${result?.family})`,
      failures
    );
  }

  // Heuristic fallback for an unknown-but-Qwen-like model id.
  const heuristic = selector.getDraftFor('qwen2.5-finetuned-mystery-3b');
  assert(
    heuristic && heuristic.source === 'heuristic',
    'Unknown qwen2.5 ids should fall through to heuristic match',
    failures
  );

  // Unsupported family returns null.
  const unsupported = selector.getDraftFor('made-up-architecture:99b');
  assert(unsupported === null, 'Unsupported model ids must return null', failures);

  // ─── Override precedence ───────────────────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-selector-smoke-'));
  const overridePath = path.join(tmpDir, 'draft-pairs.json');
  fs.writeFileSync(overridePath, JSON.stringify({
    version: 1,
    pairs: [
      { main: 'qwen2.5:7b', draft: 'custom-draft:1.0b', tokenizerId: 'custom', score: 0.92 },
    ],
  }), 'utf8');
  const overrideHit = selector.getDraftFor('qwen2.5:7b', { overridePath });
  assert(
    overrideHit && overrideHit.source === 'override' && overrideHit.draftModelId === 'custom-draft:1.0b',
    'Override file must take precedence over curated table',
    failures
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ─── validatePair: hash equivalence is the strongest gate ──────
  const hashMatch = selector.validatePair({
    mainTokenizerHash: 'abc123',
    draftTokenizerHash: 'abc123',
  });
  assert(hashMatch.compatible === true, 'Equal tokenizer hashes must be compatible', failures);

  const hashMismatch = selector.validatePair({
    mainTokenizerHash: 'abc123',
    draftTokenizerHash: 'def456',
  });
  assert(hashMismatch.compatible === false, 'Mismatched tokenizer hashes must be incompatible', failures);

  const idMatch = selector.validatePair({
    mainTokenizer: 'qwen2',
    draftTokenizer: 'qwen2',
  });
  assert(idMatch.compatible === true, 'Equal tokenizer ids must be compatible', failures);

  const noInfo = selector.validatePair({});
  assert(
    noInfo.compatible === false && noInfo.reason === 'tokenizer-info-missing',
    'Empty tokenizer payload must report tokenizer-info-missing',
    failures
  );

  // ─── Default override file present (ships in repo) ─────────────
  const overrideShip = path.join(ROOT, 'scripts/draft-pairs.json');
  assert(fs.existsSync(overrideShip), 'scripts/draft-pairs.json (override template) must exist', failures);
  if (fs.existsSync(overrideShip)) {
    const overrideJson = JSON.parse(fs.readFileSync(overrideShip, 'utf8'));
    assert(overrideJson.version === 1, 'draft-pairs.json should declare version 1', failures);
    assert(Array.isArray(overrideJson.pairs), 'draft-pairs.json must have a pairs array', failures);
  }

  // ─── IPC + preload + electronAPI wiring ────────────────────────
  const ipcHandlers = read('electron/ipc-handlers.js');
  assert(ipcHandlers.includes("ipcMain.handle('model:getDraftFor'"), 'ipc-handlers must register model:getDraftFor', failures);
  assert(ipcHandlers.includes("ipcMain.handle('model:listSupportedSpecMains'"), 'ipc-handlers must register model:listSupportedSpecMains', failures);
  assert(ipcHandlers.includes("ipcMain.handle('model:validateSpecPair'"), 'ipc-handlers must register model:validateSpecPair', failures);

  const preload = read('electron/preload.js');
  assert(/getDraftFor:.*ipcRenderer\.invoke\('model:getDraftFor'/.test(preload), 'preload must expose getDraftFor', failures);
  assert(/listSupportedSpecMains:.*ipcRenderer\.invoke\('model:listSupportedSpecMains'/.test(preload), 'preload must expose listSupportedSpecMains', failures);
  assert(/validateSpecPair:.*ipcRenderer\.invoke\('model:validateSpecPair'/.test(preload), 'preload must expose validateSpecPair', failures);

  const electronApi = read('src/utils/electronAPI.js');
  assert(/getDraftFor:.*safeCall\('getDraftFor'/.test(electronApi), 'electronAPI must expose getDraftFor', failures);
  assert(/listSupportedSpecMains:.*safeCall\('listSupportedSpecMains'/.test(electronApi), 'electronAPI must expose listSupportedSpecMains', failures);
  assert(/validateSpecPair:.*safeCall\('validateSpecPair'/.test(electronApi), 'electronAPI must expose validateSpecPair', failures);

  if (failures.length > 0) {
    console.error('Draft Selector smoke FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Draft Selector smoke PASS');
}

main();
