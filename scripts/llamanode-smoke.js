#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Llamanode smoke (Phase 0 gate).
 *
 * Static-analysis check that direct GGUF loading is wired end-to-end:
 *   - package.json has node-llama-cpp dependency
 *   - LlamaNodeBackend exists and exports the helpers we rely on
 *   - orchestrator registers llamanode unconditionally
 *   - orchestrator routes `gguf:` model ids to llamanode
 *   - IPC handlers expose model:loadLocalGguf without file copy
 *   - preload bridges the new IPC methods
 *   - the deprecated ollama:createFromFile shim no longer spawns `ollama create`
 *
 * This does NOT spawn a real inference; that requires the native module
 * to be installed and a GGUF to be available. A separate live-inference
 * smoke runs under eval:live-chat-smoke.
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

  const pkgJson = JSON.parse(read('package.json'));
  const llamanodeBackend = read('electron/services/backends/llamanode-backend.js');
  const orchestrator = read('electron/services/inference-orchestrator.js');
  const ipcHandlers = read('electron/ipc-handlers.js');
  const preload = read('electron/preload.js');
  const ensureDeps = read('scripts/ensure-deps.js');

  // Dependency pin.
  assert(
    pkgJson.dependencies && pkgJson.dependencies['node-llama-cpp'],
    'package.json must declare node-llama-cpp as a dependency',
    failures
  );

  // asarUnpack must include node-llama-cpp so the native binary is extracted.
  const asarUnpack = pkgJson.build?.asarUnpack || [];
  assert(
    asarUnpack.some((entry) => entry.includes('node-llama-cpp')),
    'package.json build.asarUnpack must include node-llama-cpp for native binary extraction',
    failures
  );

  // ensure-deps validates the native module loads.
  assert(
    ensureDeps.includes('validateNativeModules'),
    'ensure-deps.js must validate native modules load correctly',
    failures
  );
  assert(
    ensureDeps.includes('node-llama-cpp'),
    'ensure-deps.js must reference node-llama-cpp in native validation',
    failures
  );

  // LlamaNodeBackend exports.
  assert(
    llamanodeBackend.includes('class LlamaNodeBackend extends BaseBackend'),
    'LlamaNodeBackend must extend BaseBackend',
    failures
  );
  assert(
    llamanodeBackend.includes('module.exports.GGUF_MODEL_PREFIX = GGUF_MODEL_PREFIX;'),
    'LlamaNodeBackend module must export GGUF_MODEL_PREFIX',
    failures
  );
  assert(
    llamanodeBackend.includes('module.exports.isGgufModelId = isGgufModelId;'),
    'LlamaNodeBackend module must export isGgufModelId',
    failures
  );
  assert(
    llamanodeBackend.includes('module.exports.stripPrefix = stripPrefix;'),
    'LlamaNodeBackend module must export stripPrefix',
    failures
  );

  // Lazy-loads the native module so the app boots even when install fails.
  // Uses dynamic import() to load the ESM entry; works for both v2 and v3.
  // v3 (Phase 2) requires Node 20+, which is satisfied by Electron 32+.
  assert(
    /await import\(['"]node-llama-cpp['"]\)/.test(llamanodeBackend),
    'LlamaNodeBackend must use dynamic import() for node-llama-cpp (ESM with TLA)',
    failures
  );
  assert(
    /err\?\.code === 'MODULE_NOT_FOUND'/.test(llamanodeBackend),
    'LlamaNodeBackend must report clearly when node-llama-cpp is not installed',
    failures
  );

  // Orchestrator registration: llamanode is always set, independent of GPU vendor.
  assert(
    orchestrator.includes("const LlamaNodeBackend = require('./backends/llamanode-backend');"),
    'Orchestrator must import LlamaNodeBackend',
    failures
  );
  assert(
    orchestrator.includes("this.backends.set('llamanode', new LlamaNodeBackend("),
    'Orchestrator must register llamanode backend',
    failures
  );
  // llamanode is registered outside the hasArcGpu / OpenVINO opt-in guards.
  assert(
    !/if \(hasArcGpu\) \{[\s\S]{0,300}this\.backends\.set\('llamanode'/.test(orchestrator),
    'llamanode registration must not be gated behind hasArcGpu',
    failures
  );

  // gguf: model ids force-route to llamanode.
  assert(
    orchestrator.includes('const modelRequiresGguf = isGgufModelId(payload.model);'),
    'Orchestrator must detect gguf: model ids in _selectBackendForRequest',
    failures
  );
  assert(
    orchestrator.includes('if (modelRequiresGguf)'),
    'Orchestrator must force-route gguf: model ids to llamanode',
    failures
  );
  assert(
    /selectionSource: 'gguf-model'/.test(orchestrator),
    'Orchestrator must tag gguf routing decisions with selectionSource: gguf-model',
    failures
  );

  // IPC: new handler replaces the old copy-to-blob path.
  assert(
    ipcHandlers.includes("ipcMain.handle('model:loadLocalGguf'"),
    'ipc-handlers must register model:loadLocalGguf',
    failures
  );
  assert(
    ipcHandlers.includes("ipcMain.handle('model:listLocalGgufs'"),
    'ipc-handlers must register model:listLocalGgufs',
    failures
  );
  assert(
    ipcHandlers.includes("ipcMain.handle('model:unregisterLocalGguf'"),
    'ipc-handlers must register model:unregisterLocalGguf',
    failures
  );
  assert(
    ipcHandlers.includes("store.set('localGgufCatalog', catalog);"),
    'model:loadLocalGguf must persist entries into localGgufCatalog',
    failures
  );

  // Deprecated shim: must NOT spawn `ollama create`.
  const createFromFileRegex = /ipcMain\.handle\('ollama:createFromFile'[\s\S]*?^\s*\}\);/m;
  const createFromFileMatch = ipcHandlers.match(createFromFileRegex);
  assert(createFromFileMatch, 'ollama:createFromFile shim must exist', failures);
  if (createFromFileMatch) {
    const handlerBody = createFromFileMatch[0];
    assert(
      !/spawn\(\s*['"]ollama['"],\s*\[\s*['"]create['"]/.test(handlerBody),
      'Deprecated ollama:createFromFile must NOT spawn `ollama create` anymore',
      failures
    );
    assert(
      !/Modelfile-/.test(handlerBody),
      'Deprecated ollama:createFromFile must NOT write a temporary Modelfile',
      failures
    );
    assert(
      /Deprecated IPC/.test(handlerBody),
      'Deprecated ollama:createFromFile must log a deprecation warning',
      failures
    );
    assert(
      /localGgufCatalog/.test(handlerBody),
      'Deprecated ollama:createFromFile must forward to the registration catalog',
      failures
    );
  }

  // Preload bridge exposes the new IPC methods.
  assert(
    /loadLocalGguf:.*ipcRenderer\.invoke\('model:loadLocalGguf'/.test(preload),
    'preload must expose loadLocalGguf',
    failures
  );
  assert(
    /listLocalGgufs:.*ipcRenderer\.invoke\('model:listLocalGgufs'/.test(preload),
    'preload must expose listLocalGgufs',
    failures
  );
  assert(
    /unregisterLocalGguf:.*ipcRenderer\.invoke\('model:unregisterLocalGguf'/.test(preload),
    'preload must expose unregisterLocalGguf',
    failures
  );

  // Profile order tables include llamanode.
  assert(
    /PROFILE_ORDER_STANDARD[\s\S]*?'llamanode'/.test(orchestrator),
    'PROFILE_ORDER_STANDARD must include llamanode',
    failures
  );
  assert(
    /PROFILE_ORDER_UNIFIED[\s\S]*?'llamanode'/.test(orchestrator),
    'PROFILE_ORDER_UNIFIED must include llamanode',
    failures
  );

  if (failures.length > 0) {
    console.error('Llamanode gate FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Llamanode gate PASS');
}

main();
