#!/usr/bin/env node
/* eslint-disable no-console */

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
  const selector = read('src/components/ModelSelector/ModelSelector.jsx');
  const helper = read('src/components/ModelSelector/modelSelectorCatalogue.js');
  const buildInferenceOptions = read('src/chat-v2/runtime/buildInferenceOptions.js');
  const catalogSlice = read('src/stores/slices/modelCatalogSlice.js');
  const inventory = read('docs/model-selector-feature-inventory.md');
  const packageJson = read('package.json');
  const builderConfig = read('electron-builder.config.cjs');
  const settingsModal = read('src/components/Settings/SettingsModal.jsx');
  const ipcHandlers = read('electron/ipc-handlers.js');
  const npuBridge = read('electron/services/npu-bridge.js');
  const openvinoBackend = read('electron/services/backends/openvino-backend.js');

  assert(inventory.includes('No-removal') || inventory.includes('no-removal'), 'feature inventory must document the no-removal contract', failures);
  for (const required of [
    'Quant filters',
    'Agentic Research tab',
    'LM Studio scan',
    'NPU/OpenVINO status',
    'Imported GGUF list',
    'Spec chip',
    'VRAM fit dot',
    'Footer counts',
  ]) {
    assert(inventory.includes(required), `feature inventory must include ${required}`, failures);
  }

  assert(selector.includes('@tanstack/react-virtual'), 'selector must use @tanstack/react-virtual', failures);
  assert(selector.includes('Catalogue') && selector.includes('Browse All'), 'selector must expose Catalogue and Browse All modes', failures);
  assert(selector.includes('ModelExperienceWorkbench'), 'selector must deep-link/embed the Workbench', failures);
  assert(selector.includes('AliasDialog') && selector.includes('CompareDrawer') && selector.includes('PinDialog'), 'selector must include alias, compare, and pin surfaces', failures);
  assert(selector.includes('Start Ollama') && selector.includes('Open Model Hub') && selector.includes('Use local GGUF'), 'selector must include empty/offline recovery actions', failures);
  assert(selector.includes('Add model') && selector.includes('Pull Ollama variant') && selector.includes('HuggingFace GGUF') && selector.includes('Open NPU converter'), 'selector must include Add model menu for existing add/import/converter flows', failures);
  assert(selector.includes('Your rating') && selector.includes('rateModel'), 'selector details must expose library rating controls', failures);
  assert(selector.includes('Keyboard: / search') && selector.includes('Space compare') && selector.includes('W workbench'), 'selector must document keyboard map', failures);
  assert(selector.includes("currentWorkspace === 'nsfw' ? 'cache-only'"), 'Vault selector enrichment must default to cache-only', failures);
  assert(selector.includes('toggleModelHub') && selector.includes('toggleSettings'), 'add actions must launch existing Hub/Settings flows', failures);
  assert(settingsModal.includes('discoveryNetworkAccess') && settingsModal.includes('vaultModelGating'), 'settings must expose discovery network and Vault gating controls', failures);
  assert(ipcHandlers.includes("store?.get?.('discoveryNetworkAccess')") && ipcHandlers.includes("store?.get?.('vaultModelGating')"), 'selector insight IPC must read persisted catalogue policy settings', failures);
  assert(selector.includes('function renderToken') && selector.includes('renderToken(llmRuntimeState?.currentBackend)'), 'selector must render backend objects as text labels, not React children', failures);
  assert(selector.includes('data-index={virtualRow.index}'), 'selector virtual rows must provide data-index for measurement', failures);
  assert(selector.includes("const modelsDirectory = await electronAPI.getSettings('modelsDirectory')") && selector.includes('scanModels?.(modelsDirectory)'), 'selector must not call scanModels without a configured directory', failures);
  assert(buildInferenceOptions.includes("mergePresetSystemPrompt.js") && !buildInferenceOptions.includes("mergePresetSystemPrompt.cjs"), 'renderer build must import the ESM system-prompt helper, not the CJS smoke helper', failures);

  assert(helper.includes('SCORE_PRESETS'), 'helper must define score weight presets', failures);
  assert(helper.includes('parent_model') && helper.includes('base_model'), 'helper must support parent/base model metadata', failures);
  assert(helper.includes('{params}-{tune}-{quant}-{format}-{source}') || helper.includes('variantKey'), 'helper must expose deterministic variant keys', failures);
  assert(helper.includes('buildLibraryIndex'), 'helper must reuse library metadata for aliases', failures);
  assert(helper.includes('groupModels') && helper.includes('buildSmartGroups'), 'helper must provide grouping and smart-group helpers', failures);

  assert(catalogSlice.includes('entryHasAnySource'), 'catalog slice must detect source membership for partial refreshes', failures);
  assert(catalogSlice.includes('!entryHasAnySource(entry, wantedSources)'), 'partial refresh must preserve entries from non-requested sources', failures);
  assert(catalogSlice.includes('allWantedSourcesFresh'), 'partial refresh cache checks must account for requested source freshness', failures);

  assert(!npuBridge.includes('30279d') && !openvinoBackend.includes('30279d'), 'hardcoded debug session id must be removed from NPU/OpenVINO paths', failures);
  assert(npuBridge.includes('DEVFORGE_DEBUG_NPU_TRACE') && openvinoBackend.includes('DEVFORGE_DEBUG_NPU_TRACE'), 'NPU/OpenVINO tracing must be env-gated', failures);
  assert(!fs.existsSync(path.join(ROOT, 'debug-30279d.log')), 'debug-30279d.log must not exist in the repo root', failures);

  assert(packageJson.includes('electron-builder --config electron-builder.config.cjs'), 'packaging scripts must use dynamic electron-builder config', failures);
  assert(builderConfig.includes('DEVFORGE_PACKAGE_MOSAIC'), 'Mosaic packaging must be gated by DEVFORGE_PACKAGE_MOSAIC', failures);
  assert(!JSON.parse(packageJson).build.files.includes('native/mosaic-coordinator/index.node'), 'package.json build.files must not ship Mosaic unconditionally', failures);

  if (failures.length > 0) {
    console.error('Model selector catalogue smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('Model selector catalogue smoke passed.');
}

main();
