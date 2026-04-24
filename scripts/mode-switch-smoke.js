#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Mode-switch smoke (Phase 0 gate).
 *
 * Static-analysis check that setPreferredBackend no longer tears down the
 * backend map on Unified Brain toggles. The old behavior called
 * `this.backends.clear()` and re-ran initializeBackends, which caused
 * mid-stream connection errors and UI flicker. The new behavior registers
 * OpenVINO backends additively via _registerOpenVinoBackends and relies on
 * lazy Python-server spawn to preserve the one-runtime-family-at-a-time
 * invariant.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunctionBody(source, signatureRegex) {
  const match = source.match(signatureRegex);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];

  const orchestrator = read('electron/services/inference-orchestrator.js');
  const openvinoBackend = read('electron/services/backends/openvino-backend.js');

  // setPreferredBackend must NOT call backends.clear or reset initialized state.
  const setPreferredBody = extractFunctionBody(
    orchestrator,
    /async setPreferredBackend\(backendId\)\s*\{/
  );
  assert(setPreferredBody !== null, 'setPreferredBackend function must exist', failures);

  if (setPreferredBody) {
    assert(
      !setPreferredBody.includes('this.backends.clear()'),
      'setPreferredBackend must not call this.backends.clear()',
      failures
    );
    assert(
      !setPreferredBody.includes('this.initialized = false'),
      'setPreferredBackend must not reset this.initialized',
      failures
    );
    assert(
      !/await this\.initializeBackends\(\);/.test(setPreferredBody),
      'setPreferredBackend must not call initializeBackends() (nuclear rebuild)',
      failures
    );
    assert(
      setPreferredBody.includes('this._registerOpenVinoBackends()'),
      'setPreferredBackend must call _registerOpenVinoBackends() additively when entering Unified mode',
      failures
    );
  }

  // _registerOpenVinoBackends must exist and handle hybrid idempotently.
  // Phase 1 split the passive NPU/iGPU registration into a dedicated
  // _registerPassiveOpenVinoBackends — _registerOpenVinoBackends now
  // focuses on Unified Brain (HETERO:GPU,NPU) which requires opt-in.
  assert(
    /async _registerOpenVinoBackends\(\)\s*\{/.test(orchestrator),
    'Orchestrator must define _registerOpenVinoBackends',
    failures
  );
  assert(
    /async _registerPassiveOpenVinoBackends\(\)\s*\{/.test(orchestrator),
    'Orchestrator must define _registerPassiveOpenVinoBackends (Phase 1)',
    failures
  );

  const passiveBody = extractFunctionBody(
    orchestrator,
    /async _registerPassiveOpenVinoBackends\(\)\s*\{/
  );
  if (passiveBody) {
    assert(
      /if \(npuDetected && !this\.backends\.has\('openvino-npu'\)\)/.test(passiveBody),
      '_registerPassiveOpenVinoBackends must guard NPU registration on existing state (idempotent)',
      failures
    );
    assert(
      /if \(hasArcGpu && !this\.backends\.has\('openvino-gpu'\)\)/.test(passiveBody),
      '_registerPassiveOpenVinoBackends must guard Intel Arc registration on existing state (idempotent)',
      failures
    );
  }

  const registerBody = extractFunctionBody(
    orchestrator,
    /async _registerOpenVinoBackends\(\)\s*\{/
  );
  if (registerBody) {
    assert(
      registerBody.includes("if (!this.backends.has('openvino-hybrid')"),
      '_registerOpenVinoBackends must guard hybrid registration on existing state (idempotent)',
      failures
    );
  }

  // OpenVinoBackend must have lazy-start promise serialization for concurrent callers.
  assert(
    openvinoBackend.includes('this._lazyStartPromise = null;'),
    'OpenVinoBackend must initialize _lazyStartPromise in constructor',
    failures
  );
  assert(
    openvinoBackend.includes('if (this._lazyStartPromise)'),
    'OpenVinoBackend._handleServerOffline must share in-flight start promise across concurrent callers',
    failures
  );

  if (failures.length > 0) {
    console.error('Mode-switch gate FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Mode-switch gate PASS');
}

main();
