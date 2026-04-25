#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * User-autonomy UI contract smoke (v0.4.4).
 *
 * Static contract gate for the per-model device pin (in ModelPresets) and
 * per-chat backend override (in ChatV2 toolbar):
 *
 *   1. SQLite migration adds `device_pin` to `model_presets`, presets:save
 *      validates the pin against an allow-list, presets:getForModel returns
 *      it, and `null` is the documented "auto" sentinel.
 *   2. ModelPresets UI exposes a `device_pin` <select> with the same
 *      allow-list + an "Auto" entry.
 *   3. chatV2SessionStore persists `backendOverride` and validates against
 *      the allow-list before storing.
 *   4. buildChatV2InferenceOptions copies the preset's `device_pin` and
 *      session `backendOverride` (session wins) onto `options.forceBackend`.
 *   5. The chat engine extracts `forceBackend` from the inference options
 *      and forwards it on the stream request.
 *   6. createElectronRuntimeAdapter forwards `forceBackend` to backend IPC.
 *   7. ipc-handlers' `sanitizeInferenceInput` whitelists the same set and
 *      forwards `forceBackend` to the orchestrator's `inferencePayload`.
 *   8. The orchestrator's `_selectBackendForRequest` honors `payload.forceBackend`.
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

const ALLOWED = [
  'ollama-cuda',
  'ollama-cpu',
  'llamanode',
  'openvino-npu',
  'openvino-gpu',
  'openvino-hybrid',
  'llamacpp-vulkan',
];

function main() {
  const failures = [];

  const ipc = read('electron/ipc-handlers.js');
  const orchestrator = read('electron/services/inference-orchestrator.js');
  const presetsUi = read('src/components/Settings/ModelPresets.jsx');
  const sessionStore = read('src/stores/chatV2SessionStore.js');
  const buildOpts = read('src/chat-v2/runtime/buildInferenceOptions.js');
  const engine = read('src/chat-v2/engine/chatEngine.js');
  const electronAdapter = read('src/chat-v2/runtime/createElectronRuntimeAdapter.js');
  const surface = read('src/chat-v2/ui/ChatV2Surface.jsx');

  assert(
    ipc.includes('device_pin TEXT,'),
    'ipc-handlers must declare device_pin TEXT in model_presets schema',
    failures,
  );
  assert(
    ipc.includes('ALTER TABLE model_presets ADD COLUMN device_pin TEXT'),
    'ipc-handlers must migrate existing model_presets tables to add device_pin',
    failures,
  );
  assert(
    ipc.includes('hasDevicePin = columns.includes(\'device_pin\')'),
    'ipc-handlers presets:getForModel must guard projection on hasDevicePin',
    failures,
  );
  for (const id of ALLOWED) {
    assert(
      ipc.includes(`'${id}'`),
      `ipc-handlers must list ${id} in the device-pin / forceBackend allow-list`,
      failures,
    );
  }
  assert(
    ipc.includes('INSERT INTO model_presets (id, model_name, temperature, top_p, top_k, context_length, system_prompt, workspace, is_default, device_pin)'),
    'presets:save must insert device_pin',
    failures,
  );
  assert(
    ipc.includes('safeDevicePin = rawDevicePin && ALLOWED_DEVICE_PINS.has(rawDevicePin) ? rawDevicePin : null'),
    'presets:save must reject non-allowlisted device pins',
    failures,
  );

  assert(
    ipc.includes('forceBackend = rawForceBackend && ALLOWED_FORCE_BACKENDS.has(rawForceBackend) ? rawForceBackend : null'),
    'sanitizeInferenceInput must validate forceBackend against the allow-list',
    failures,
  );
  assert(
    ipc.includes("...(safePayload.forceBackend ? { forceBackend: safePayload.forceBackend } : {})"),
    'ipc-handlers llm:send/stream must forward safePayload.forceBackend to orchestrator inferencePayload',
    failures,
  );

  assert(
    /if \(payload\.forceBackend && this\.backends\.has\(payload\.forceBackend\)\)/.test(orchestrator),
    'orchestrator _selectBackendForRequest must honor payload.forceBackend (selectionSource: forceBackend)',
    failures,
  );
  assert(
    orchestrator.includes("selectionSource: 'forceBackend'"),
    'orchestrator must report selectionSource forceBackend on the routing decision',
    failures,
  );

  assert(
    presetsUi.includes('Device pin (per-model backend)'),
    'ModelPresets UI must expose a "Device pin (per-model backend)" control',
    failures,
  );
  assert(
    presetsUi.includes('DEVICE_PIN_OPTIONS'),
    'ModelPresets UI must drive options off DEVICE_PIN_OPTIONS',
    failures,
  );
  for (const id of ALLOWED) {
    assert(
      presetsUi.includes(`value: '${id}'`),
      `ModelPresets UI must include ${id} in DEVICE_PIN_OPTIONS`,
      failures,
    );
  }

  assert(
    sessionStore.includes('ALLOWED_BACKEND_OVERRIDES'),
    'chatV2SessionStore must define ALLOWED_BACKEND_OVERRIDES',
    failures,
  );
  assert(
    sessionStore.includes('setBackendOverride: (id) =>'),
    'chatV2SessionStore must expose setBackendOverride',
    failures,
  );
  assert(
    sessionStore.includes("normalized = trimmed && ALLOWED_BACKEND_OVERRIDES.has(trimmed) ? trimmed : null"),
    'setBackendOverride must validate against the allow-list and fall back to null',
    failures,
  );

  assert(
    buildOpts.includes('const presetDevicePin = String(activePreset?.device_pin ?? \'\').trim();'),
    'buildInferenceOptions must read activePreset.device_pin',
    failures,
  );
  assert(
    buildOpts.includes('const sessionBackendOverride = String(sessionState.backendOverride || \'\').trim();'),
    'buildInferenceOptions must read sessionState.backendOverride',
    failures,
  );
  assert(
    /if \(sessionBackendOverride\) \{\s*options\.forceBackend = sessionBackendOverride;\s*\}/.test(buildOpts),
    'session backendOverride must overwrite preset device_pin (session wins) on options.forceBackend',
    failures,
  );

  assert(
    engine.includes("const forceBackend = String(inferenceOptions?.forceBackend ?? '').trim();"),
    'chatEngine must extract forceBackend from inference options',
    failures,
  );
  assert(
    engine.includes('delete inferenceOptions.forceBackend'),
    'chatEngine must strip forceBackend before passing options to runtime',
    failures,
  );
  assert(
    engine.includes('...(forceBackend ? { forceBackend } : {})'),
    'chatEngine must forward forceBackend on the stream request',
    failures,
  );

  assert(
    electronAdapter.includes("...(request.forceBackend ? { forceBackend: String(request.forceBackend).trim() } : {})"),
    'createElectronRuntimeAdapter must forward forceBackend on streamChat + generateChat',
    failures,
  );
  // Both call sites should include the forwarder.
  const forceBackendForwardCount = (electronAdapter.match(/request\.forceBackend \? \{ forceBackend: String\(request\.forceBackend\)\.trim\(\) \} : \{\}/g) || []).length;
  assert(
    forceBackendForwardCount >= 2,
    'createElectronRuntimeAdapter must forward forceBackend on both stream and generate paths',
    failures,
  );

  assert(
    surface.includes('BACKEND_OVERRIDE_CHOICES'),
    'ChatV2Surface must define BACKEND_OVERRIDE_CHOICES',
    failures,
  );
  assert(
    surface.includes('useChatV2SessionStore((s) => s.backendOverride)'),
    'ChatV2Surface must read backendOverride from chatV2SessionStore',
    failures,
  );
  assert(
    surface.includes('aria-label="Per-chat backend override"'),
    'ChatV2Surface must render an accessible per-chat backend override <select>',
    failures,
  );

  if (failures.length) {
    console.error('autonomy-routing-smoke FAILED');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log('autonomy-routing-smoke PASS');
}

main();
