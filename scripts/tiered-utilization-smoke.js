#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Tiered-utilization smoke (Phase 1 gate).
 *
 * Static-analysis check that NPU registration, lane routing, warm-loop,
 * power-aware gating, and the default NPU model size are all wired up
 * correctly. This matches Phase 0's pattern — no live inference, just
 * source inspection of the shipped contracts so release-gate stays fast
 * and deterministic.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  try {
    return fs.existsSync(path.join(ROOT, rel));
  } catch {
    return false;
  }
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function parseModelSizeBillions(modelId) {
  if (!modelId) return null;
  const m = String(modelId).match(/(\d+(?:\.\d+)?)\s*B/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function main() {
  const failures = [];

  const orchestrator = read('electron/services/inference-orchestrator.js');
  const npuBridge = read('electron/services/npu-bridge.js');
  const powerMode = read('electron/services/power-mode.js');
  const laneRegistryExists = exists('electron/services/lane-registry.js');
  const warmloopExists = exists('electron/services/npu-warmloop.js');
  const openvinoModelRaw = read('scripts/openvino-model.json');
  const vaultProfileExists = exists('scripts/vault-profile.json');
  const preload = read('electron/preload.js');
  const electronApi = read('src/utils/electronAPI.js');
  const hardwareMonitor = read('src/components/HardwareMonitor/HardwareMonitor.jsx');
  const ipcHandlers = read('electron/ipc-handlers.js');

  // WS1: unconditional NPU registration via _registerPassiveOpenVinoBackends.
  assert(
    /async _registerPassiveOpenVinoBackends\(\)\s*\{/.test(orchestrator),
    'Orchestrator must define _registerPassiveOpenVinoBackends (WS1)',
    failures
  );
  assert(
    /await this\._registerPassiveOpenVinoBackends\(\);/.test(orchestrator),
    'initializeBackends must call _registerPassiveOpenVinoBackends without gating on userWantsOpenVino',
    failures
  );
  // Profile order tables must include openvino-npu in at least efficiency
  // and laptop profiles of the standard mode.
  const profileTableMatch = orchestrator.match(/const PROFILE_ORDER_STANDARD\s*=\s*\{[\s\S]*?\};/);
  assert(profileTableMatch, 'PROFILE_ORDER_STANDARD table must exist', failures);
  if (profileTableMatch) {
    const table = profileTableMatch[0];
    assert(
      /efficiency:\s*\[[^\]]*'openvino-npu'/.test(table),
      'PROFILE_ORDER_STANDARD.efficiency must include openvino-npu',
      failures
    );
    assert(
      /laptop:\s*\[[^\]]*'openvino-npu'/.test(table),
      'PROFILE_ORDER_STANDARD.laptop must include openvino-npu',
      failures
    );
    assert(
      /balanced:\s*\[[^\]]*'openvino-npu'/.test(table),
      'PROFILE_ORDER_STANDARD.balanced must include openvino-npu as a secondary option',
      failures
    );
  }

  // WS2: default NPU model is <=3B and vault overrides live in their own file.
  let openvinoModel;
  try {
    openvinoModel = JSON.parse(openvinoModelRaw);
  } catch (err) {
    failures.push(`scripts/openvino-model.json must be valid JSON: ${err.message}`);
    openvinoModel = {};
  }
  const defaultSize = parseModelSizeBillions(openvinoModel.model_path);
  assert(
    defaultSize !== null,
    `Default NPU model_path must include a parseable size (found: ${openvinoModel.model_path || 'empty'})`,
    failures
  );
  if (defaultSize !== null) {
    assert(
      defaultSize <= 3,
      `Default NPU model must be <=3B (found ${defaultSize}B) to fit Intel NPU 3 budget`,
      failures
    );
  }
  assert(
    String(openvinoModel.workload || '').toLowerCase() === 'general',
    'openvino-model.json workload should be "general" (vault overrides are now in vault-profile.json)',
    failures
  );
  assert(
    vaultProfileExists,
    'scripts/vault-profile.json must exist (vault overrides split from openvino-model.json in WS2)',
    failures
  );

  // DEFAULT_NPU_MODEL_CANDIDATES must prefer small models.
  const candidatesMatch = npuBridge.match(/const DEFAULT_NPU_MODEL_CANDIDATES\s*=\s*\[([\s\S]*?)\];/);
  assert(candidatesMatch, 'DEFAULT_NPU_MODEL_CANDIDATES array must exist in npu-bridge', failures);
  if (candidatesMatch) {
    const firstEntry = candidatesMatch[1].split(',')[0].trim().replace(/^['"]/, '').replace(/['"]$/, '');
    const firstSize = parseModelSizeBillions(firstEntry);
    assert(
      firstSize === null || firstSize <= 3,
      `First DEFAULT_NPU_MODEL_CANDIDATES entry must be <=3B (found ${firstSize}B: ${firstEntry})`,
      failures
    );
  }

  // WS3: start-npu-server.py uses openvino_genai and setup installs it.
  const npuServer = read('scripts/start-npu-server.py');
  assert(
    /import openvino_genai/.test(npuServer),
    'scripts/start-npu-server.py must import openvino_genai (WS3 GenAI migration)',
    failures
  );
  assert(
    /ov_genai\.LLMPipeline/.test(npuServer),
    'scripts/start-npu-server.py must use ov_genai.LLMPipeline for chat',
    failures
  );
  assert(
    /GENAI_AVAILABLE/.test(npuServer),
    'scripts/start-npu-server.py must expose GENAI_AVAILABLE flag',
    failures
  );
  const setupPs1 = read('scripts/setup-openvino.ps1');
  assert(
    /openvino-genai/.test(setupPs1),
    'scripts/setup-openvino.ps1 must include openvino-genai in the package list',
    failures
  );
  assert(
    /huggingface_hub/.test(setupPs1),
    'scripts/setup-openvino.ps1 must include huggingface_hub (needed for GenAI snapshot downloads)',
    failures
  );

  // WS4: lane registry exists and is consumed by the orchestrator.
  assert(laneRegistryExists, 'electron/services/lane-registry.js must exist', failures);
  if (laneRegistryExists) {
    const laneRegistry = read('electron/services/lane-registry.js');
    assert(
      /module\.exports\s*=\s*\{[\s\S]*?getLaneCandidates/.test(laneRegistry),
      'lane-registry must export getLaneCandidates',
      failures
    );
    assert(
      /embedding:\s*\{[\s\S]*?onAc:\s*\[[^\]]*'openvino-npu'/.test(laneRegistry),
      'lane-registry must route embedding workload to openvino-npu on AC',
      failures
    );
    assert(
      /'image-generation':\s*\{[\s\S]*?onAc:\s*\[[^\]]*'openvino-gpu'/.test(laneRegistry),
      'lane-registry must route image-generation to openvino-gpu (Intel Arc)',
      failures
    );
  }
  assert(
    /const \{ getLaneCandidates \} = require\('\.\/lane-registry'\);/.test(orchestrator),
    'Orchestrator must import getLaneCandidates from lane-registry',
    failures
  );
  assert(
    /getLaneCandidates\(payload\.workloadType/.test(orchestrator),
    'Orchestrator _selectBackendForRequest must call getLaneCandidates with payload.workloadType',
    failures
  );

  // WS5: warm-loop exists and is initialized.
  assert(warmloopExists, 'electron/services/npu-warmloop.js must exist', failures);
  if (warmloopExists) {
    const warmloop = read('electron/services/npu-warmloop.js');
    assert(
      /module\.exports\s*=\s*\{[\s\S]*?createNpuWarmloop/.test(warmloop),
      'npu-warmloop must export createNpuWarmloop',
      failures
    );
    assert(
      /DEFAULT_WARM_MODEL/.test(warmloop),
      'npu-warmloop must expose DEFAULT_WARM_MODEL constant',
      failures
    );
    assert(
      /minFreeRamGb/.test(warmloop),
      'npu-warmloop must gate on free RAM',
      failures
    );
  }
  assert(
    /async _startNpuWarmloop\(\)/.test(orchestrator),
    'Orchestrator must define _startNpuWarmloop',
    failures
  );
  assert(
    /this\._startNpuWarmloop\(\)/.test(orchestrator),
    'Orchestrator initialize() must kick off _startNpuWarmloop',
    failures
  );

  // WS6: power-mode exports getPowerState.
  assert(
    /getPowerState\s*\([^)]*\)\s*\{/.test(powerMode),
    'power-mode must define getPowerState method',
    failures
  );
  assert(
    /powerMonitor/.test(powerMode),
    'power-mode must import Electron powerMonitor',
    failures
  );
  assert(
    /async _getPowerState\(\)/.test(orchestrator),
    'Orchestrator must define _getPowerState wrapper',
    failures
  );

  // WS7: device telemetry IPC + UI wiring.
  assert(
    /getDeviceUtilization\(windowMs/.test(orchestrator),
    'Orchestrator must expose getDeviceUtilization(windowMs) (WS7)',
    failures
  );
  assert(
    /ipcMain\.handle\('orchestrator:getDeviceUtilization'/.test(ipcHandlers),
    'ipc-handlers must register orchestrator:getDeviceUtilization',
    failures
  );
  assert(
    /getDeviceUtilization:.*ipcRenderer\.invoke\('orchestrator:getDeviceUtilization'/.test(preload),
    'preload must expose getDeviceUtilization',
    failures
  );
  assert(
    /getDeviceUtilization:.*safeCall\('getDeviceUtilization'/.test(electronApi),
    'electronAPI util must expose getDeviceUtilization',
    failures
  );
  assert(
    /Device Activity/.test(hardwareMonitor),
    'HardwareMonitor must include a Device Activity section',
    failures
  );
  assert(
    /getDeviceUtilization\?\.\(60000\)/.test(hardwareMonitor),
    'HardwareMonitor must poll getDeviceUtilization with a 60s window',
    failures
  );

  if (failures.length > 0) {
    console.error('Tiered-utilization gate FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Tiered-utilization gate PASS');
}

main();
