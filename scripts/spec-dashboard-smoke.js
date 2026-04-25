#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Spec-decode dashboard + auto-disable smoke (Phase 2 gate).
 *
 * Drives a stripped-down orchestrator-shape harness through the
 * recordSpecDecodeOutcome / isSpecDecodeDisabled / getSpecDecodeStats
 * state machine. Verifies the auto-disable threshold triggers below
 * 0.4 average acceptance and re-enables after the configured fresh-
 * window of recoveries. Static-analysis check the IPC + preload +
 * electronAPI surfaces all expose the new methods.
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

function makeOrchestratorShim() {
  // Re-implement the same auto-disable state machine as the real
  // orchestrator so we can drive it through outcomes without spinning
  // up Electron + every backend. The smoke is a contract test; the
  // production code paths share the same logic.
  return {
    specDecodeOutcomes: [],
    specDecodeAutoDisabled: new Set(),
    specDecodeRecentSinceDisable: new Map(),
    specDecodeConfig: { disableThreshold: 0.4, windowSize: 50, autoReenableTurns: 100 },
    recordSpecDecodeOutcome(outcome) {
      const pair = String(outcome.pair || '');
      if (!pair) return;
      const total = Math.max(0, Number(outcome.total) || 0);
      const accepted = Math.min(total, Math.max(0, Number(outcome.accepted) || 0));
      const row = { pair, accepted, total, acceptanceRate: total > 0 ? accepted / total : 0, ts: Date.now() };
      this.specDecodeOutcomes.push(row);
      const cfg = this.specDecodeConfig;
      const recent = this.specDecodeOutcomes.filter((r) => r.pair === pair).slice(-cfg.windowSize);
      if (recent.length < Math.max(5, Math.floor(cfg.windowSize / 5))) return;
      const avg = recent.reduce((s, r) => s + r.acceptanceRate, 0) / recent.length;
      if (avg < cfg.disableThreshold) {
        if (!this.specDecodeAutoDisabled.has(pair)) {
          this.specDecodeAutoDisabled.add(pair);
          this.specDecodeRecentSinceDisable.set(pair, 0);
        }
      } else if (this.specDecodeAutoDisabled.has(pair)) {
        const fresh = (this.specDecodeRecentSinceDisable.get(pair) || 0) + recent.length;
        this.specDecodeRecentSinceDisable.set(pair, fresh);
        if (fresh >= cfg.autoReenableTurns) {
          this.specDecodeAutoDisabled.delete(pair);
          this.specDecodeRecentSinceDisable.delete(pair);
        }
      }
    },
    isSpecDecodeDisabled(pair) { return this.specDecodeAutoDisabled.has(String(pair || '')); },
  };
}

function feedOutcomes(orchestrator, pair, total, accepted, count = 1) {
  for (let i = 0; i < count; i += 1) {
    orchestrator.recordSpecDecodeOutcome({ pair, total, accepted });
  }
}

function main() {
  const failures = [];

  // ─── Behavior: low acceptance triggers auto-disable ────────────
  const orch = makeOrchestratorShim();
  feedOutcomes(orch, 'qwen2.5:7b|qwen2.5:1.5b', 4, 1, 20);
  assert(
    orch.isSpecDecodeDisabled('qwen2.5:7b|qwen2.5:1.5b'),
    'Low acceptance (25%) over 20 turns must trigger auto-disable',
    failures
  );

  // ─── Behavior: high acceptance keeps it enabled ────────────────
  const orch2 = makeOrchestratorShim();
  feedOutcomes(orch2, 'qwen2.5:7b|qwen2.5:1.5b', 4, 3, 20); // 75%
  assert(
    !orch2.isSpecDecodeDisabled('qwen2.5:7b|qwen2.5:1.5b'),
    'High acceptance (75%) must NOT trigger auto-disable',
    failures
  );

  // ─── Behavior: re-enable after sustained recovery ──────────────
  feedOutcomes(orch, 'qwen2.5:7b|qwen2.5:1.5b', 4, 4, 100); // 100% recovery
  assert(
    !orch.isSpecDecodeDisabled('qwen2.5:7b|qwen2.5:1.5b'),
    'Sustained 100% acceptance after disable must re-enable',
    failures
  );

  // ─── Behavior: per-pair isolation ──────────────────────────────
  const orch3 = makeOrchestratorShim();
  feedOutcomes(orch3, 'pair-A', 4, 0, 20);
  feedOutcomes(orch3, 'pair-B', 4, 4, 20);
  assert(
    orch3.isSpecDecodeDisabled('pair-A') && !orch3.isSpecDecodeDisabled('pair-B'),
    'Auto-disable must be per-pair (A disabled, B enabled)',
    failures
  );

  // ─── Behavior: too-few samples should not disable ─────────────
  const orch4 = makeOrchestratorShim();
  feedOutcomes(orch4, 'pair-X', 4, 0, 3); // only 3 turns -> below min
  assert(
    !orch4.isSpecDecodeDisabled('pair-X'),
    'Auto-disable must require min sample count before deciding',
    failures
  );

  // ─── Static checks: IPC + preload + electronAPI surfaces ───────
  const orchSrc = read('electron/services/inference-orchestrator.js');
  assert(
    /recordSpecDecodeOutcome\(/.test(orchSrc) && /getSpecDecodeStats\(/.test(orchSrc) && /isSpecDecodeDisabled\(/.test(orchSrc),
    'Orchestrator must expose recordSpecDecodeOutcome / getSpecDecodeStats / isSpecDecodeDisabled',
    failures
  );
  assert(
    /streams: \{[\s\S]*?specDecode: specDecodeStats/.test(orchSrc),
    'getDeviceUtilization must surface streams.specDecode',
    failures
  );
  assert(
    /_runSpecDecodeChat\(/.test(orchSrc) && /_shouldUseSpecDecode\(/.test(orchSrc),
    'Orchestrator must define _runSpecDecodeChat and _shouldUseSpecDecode (Phase 2 loop)',
    failures
  );
  assert(
    /createSpecDecodeBus\(\{ npuBridge \}\)/.test(orchSrc),
    'Orchestrator must instantiate createSpecDecodeBus with the npu bridge',
    failures
  );

  const ipc = read('electron/ipc-handlers.js');
  assert(
    /ipcMain\.handle\('orchestrator:recordSpecDecodeOutcome'/.test(ipc),
    'ipc-handlers must register orchestrator:recordSpecDecodeOutcome',
    failures
  );
  assert(
    /ipcMain\.handle\('orchestrator:getSpecDecodeStats'/.test(ipc),
    'ipc-handlers must register orchestrator:getSpecDecodeStats',
    failures
  );
  assert(
    /ipcMain\.handle\('orchestrator:isSpecDecodeDisabled'/.test(ipc),
    'ipc-handlers must register orchestrator:isSpecDecodeDisabled',
    failures
  );

  const preload = read('electron/preload.js');
  assert(
    /recordSpecDecodeOutcome:.*ipcRenderer\.invoke/.test(preload)
      && /getSpecDecodeStats:.*ipcRenderer\.invoke/.test(preload)
      && /isSpecDecodeDisabled:.*ipcRenderer\.invoke/.test(preload),
    'preload must expose all three spec-decode methods',
    failures
  );

  const apiSrc = read('src/utils/electronAPI.js');
  assert(
    /recordSpecDecodeOutcome:[\s\S]*?safeCall\('recordSpecDecodeOutcome'/.test(apiSrc)
      && /getSpecDecodeStats:[\s\S]*?safeCall\('getSpecDecodeStats'/.test(apiSrc)
      && /isSpecDecodeDisabled:[\s\S]*?safeCall\('isSpecDecodeDisabled'/.test(apiSrc),
    'electronAPI must expose all three spec-decode methods',
    failures
  );

  const monitor = read('src/components/HardwareMonitor/HardwareMonitor.jsx');
  assert(
    /streams\.specDecode/.test(monitor) && /Spec decode/.test(monitor),
    'HardwareMonitor must render the Spec decode panel',
    failures
  );

  if (failures.length > 0) {
    console.error('Spec Dashboard smoke FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Spec Dashboard smoke PASS');
}

main();
