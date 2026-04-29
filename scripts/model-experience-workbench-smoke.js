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
  const serviceSource = read('electron/services/model-experience-workbench.js');
  const ipcSource = read('electron/ipc-handlers.js');
  const preloadSource = read('electron/preload.js');
  const apiSource = read('src/utils/electronAPI.js');
  const surfaceSource = read('src/chat-v2/ui/ChatV2Surface.jsx');
  const workbenchSource = read('src/chat-v2/ui/ModelExperienceWorkbench.jsx');
  const releaseGate = read('scripts/release-gate.js');

  assert(serviceSource.includes('createModelExperienceWorkbench'), 'Workbench service factory must exist', failures);
  assert(serviceSource.includes("require('./model-experience-resolver')")
    && serviceSource.includes('resolveModelExperiencePlan'),
  'Workbench service must build profiles through the Autopilot resolver', failures);
  assert(serviceSource.includes('model_workbench_runs')
    && serviceSource.includes('model_workbench_results'),
  'Workbench service must persist local SQLite run/result history', failures);
  assert(serviceSource.includes("workloadType: 'model-workbench-eval'")
    && serviceSource.includes('orchestrator.generate')
    && !serviceSource.includes('model-testing-service'),
  'Workbench eval must use orchestrator paths and not the legacy model-testing-service', failures);
  assert(serviceSource.includes('EVAL_LIMITS')
    && serviceSource.includes('timeoutMs: 90_000')
    && serviceSource.includes('suiteTimeoutMs: 20 * 60_000')
    && serviceSource.includes('safeNumPredict: 96')
    && serviceSource.includes('cleanupIntent'),
  'Workbench eval must enforce bounded timeouts and record cleanup intent', failures);
  assert(serviceSource.includes('isLargeLocalModel')
    && serviceSource.includes('buildEvalPolicy')
    && serviceSource.includes('large-local-gguf-detected')
    && serviceSource.includes('in-process-live-eval-blocked')
    && serviceSource.includes('Large local GGUF live Workbench eval is blocked in-app until isolated runner containment is available'),
  'Workbench eval must protect large local GGUF models with a safety policy', failures);
  assert(serviceSource.includes('sanitizeAdvancedOptions')
    && serviceSource.includes('delete next.forceBackend')
    && serviceSource.includes('delete next.experiencePlan'),
  'Workbench must sanitize eval options and keep metadata out of raw backend options', failures);
  assert(serviceSource.includes('saveWinner')
    && serviceSource.includes("target === 'session'")
    && serviceSource.includes('savePreset'),
  'Workbench must support save winner to session or preset', failures);
  assert(!serviceSource.includes('DEVFORGE_SPEC_DECODE_ENABLE'), 'Workbench must not enable speculative decoding', failures);

  [
    'model:workbenchGetSnapshot',
    'model:workbenchBuildProfiles',
    'model:workbenchRunEval',
    'model:workbenchCancelEval',
    'model:workbenchGetHistory',
    'model:workbenchSaveWinner',
  ].forEach((channel) => {
    assert(ipcSource.includes(channel), `IPC must expose ${channel}`, failures);
    assert(preloadSource.includes(channel), `preload must bridge ${channel}`, failures);
  });
  assert(ipcSource.includes('sanitizeWorkbenchPayload'), 'IPC must sanitize Workbench payloads', failures);
  assert(ipcSource.includes('fullSuite: safe.fullSuite === true')
    && ipcSource.includes('riskAccepted: safe.riskAccepted === true')
    && ipcSource.includes("slice(0, 1024)"),
  'IPC must carry explicit Workbench suite risk flags and preserve long local GGUF paths', failures);
  assert(ipcSource.includes("ALLOWED_FORCE_BACKENDS.add('mosaic')"), 'Mosaic force backend remains hidden behind env gates', failures);
  assert(apiSource.includes('modelWorkbenchRunEval')
    && apiSource.includes('onModelWorkbenchProgress'),
  'renderer API wrapper must expose Workbench eval and progress helpers', failures);
  assert(surfaceSource.includes('workbenchOpen')
    && surfaceSource.includes('ModelExperienceWorkbench')
    && surfaceSource.includes('handleApplyWorkbenchSession'),
  'Chat V2 surface must host the Workbench and apply session winners', failures);
  assert(workbenchSource.includes("const TABS =")
    && workbenchSource.includes("'plan'")
    && workbenchSource.includes("'profiles'")
    && workbenchSource.includes("'eval'")
    && workbenchSource.includes("'history'")
    && workbenchSource.includes("'save'"),
  'Workbench UI must expose Plan, Profiles, Eval, History, and Save tabs', failures);
  assert(workbenchSource.includes('selectedProfileIds')
    && workbenchSource.includes('Run Selected Suite')
    && workbenchSource.includes('Run All Profiles')
    && workbenchSource.includes('Check Eval Readiness')
    && workbenchSource.includes('Large local GGUF detected')
    && workbenchSource.includes('Live Workbench eval is blocked in-app')
    && workbenchSource.includes('Apply To This Chat')
    && workbenchSource.includes('Save Model Preset'),
  'Workbench UI must compare profiles, run evals, and save/apply winners', failures);
  assert(releaseGate.includes('model-experience-workbench'), 'release gate must include Workbench smoke', failures);

  if (failures.length) {
    console.error('model-experience-workbench-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('model-experience-workbench-smoke PASS');
}

main();
