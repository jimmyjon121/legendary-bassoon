#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function main() {
  const failures = [];
  const coordinator = read('electron/services/mosaic-coordinator.js');
  const backend = read('electron/services/backends/mosaic-backend.js');
  const orchestrator = read('electron/services/inference-orchestrator.js');
  const ipc = read('electron/ipc-handlers.js');
  const preload = read('electron/preload.js');
  const api = read('src/utils/electronAPI.js');
  const lab = read('src/components/Dev/MosaicLab.jsx');
  const gate2 = read('scripts/mosaic-gate2-eval.js');
  const buildScript = read('scripts/build-mosaic-coordinator.js');
  const runnerProbe = read('scripts/mosaic-runner-probe.js');
  const pkg = JSON.parse(read('package.json'));
  const builderConfig = read('electron-builder.config.cjs');
  const architecture = read('docs/mosaic-architecture.md');

  assert(architecture.includes('LM Studio Quality Bar'), 'Mosaic architecture must state the LM Studio Quality Bar', failures);
  assert(coordinator.includes('function probeRuntime') && coordinator.includes('function planPlacement') && coordinator.includes('function buildLaunchArgs'), 'coordinator facade must expose the Phase 3 API', failures);
  assert(coordinator.includes('tryLoadNative') && coordinator.includes('Rust napi-rs'), 'coordinator must attempt native Rust napi-rs loading with JS fallback', failures);
  assert(coordinator.includes('runner_incompatible') && coordinator.includes('runner_missing_device_assignment'), 'coordinator must block incompatible runners before live Gate 2', failures);
  assert(backend.includes("id: 'mosaic'") && backend.includes('MOSAIC_UNAVAILABLE'), 'mosaic backend must be hidden/dev and fail cleanly', failures);
  assert(orchestrator.includes('isMosaicRuntimeEnabled()') && orchestrator.includes("this.backends.set('mosaic'"), 'orchestrator must register mosaic only behind env gates', failures);
  assert(ipc.includes("ALLOWED_FORCE_BACKENDS.add('mosaic')") && ipc.includes('mosaicCoordinator.isMosaicRuntimeEnabled()'), 'force-backend allow-list must add mosaic only when dev runtime is enabled', failures);
  assert(ipc.includes("ipcMain.handle('dev:mosaicProbe'") && ipc.includes("gate2: await readJson('gate2-decision.json')"), 'IPC must expose dev probe and Gate 2 artifact', failures);
  assert(preload.includes('mosaicProbe:') && api.includes('mosaicProbe:'), 'preload and electronAPI must expose mosaicProbe', failures);
  assert(lab.includes('Gate 2 Runtime') && lab.includes('gate2?.speedup'), 'MosaicLab must show Gate 2 status and speedup', failures);
  assert(gate2.includes('deepseek-coder:33b') && gate2.includes('gate2-decision.json') && gate2.includes('1.5'), 'Gate 2 eval must use canonical model, artifact, and 1.5x threshold', failures);
  assert(gate2.includes("'blocked'") && gate2.includes("'fail'") && gate2.includes("'pass'"), 'Gate 2 eval must support pass/fail/blocked decisions', failures);
  assert(buildScript.includes('cargo') && pkg.scripts?.['build:native:mosaic'], 'package scripts must expose a Cargo-backed Mosaic native build', failures);
  assert(runnerProbe.includes('probeRuntime') && pkg.scripts?.['eval:mosaic-probe'], 'package scripts must expose a Mosaic runner probe', failures);
  assert(!pkg.build?.files?.includes('native/mosaic-coordinator/index.node'), 'package.json must not ship the Mosaic native addon unconditionally', failures);
  assert(
    builderConfig.includes('DEVFORGE_PACKAGE_MOSAIC')
      && builderConfig.includes("files.push('native/mosaic-coordinator/index.node')")
      && builderConfig.includes("asarUnpack.push('native/mosaic-coordinator/*.node')"),
    'dynamic electron-builder config must include Mosaic native addon only when DEVFORGE_PACKAGE_MOSAIC=1',
    failures,
  );

  if (failures.length > 0) {
    console.error('mosaic-gate2-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('mosaic-gate2-smoke PASS');
}

main();
