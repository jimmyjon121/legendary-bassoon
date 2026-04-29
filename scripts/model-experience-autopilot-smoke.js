#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const resolver = require(path.join(ROOT, 'electron/services/model-experience-resolver'));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function main() {
  const failures = [];

  const fallback = resolver.resolveModelExperiencePlan({
    model: 'qwen2.5:7b',
    workspace: 'casual',
    prompt: '',
  });
  assert(fallback.success === true, 'resolver should return a safe plan without MAEE/metadata/hardware inputs', failures);
  assert(fallback.plan?.effectiveOptions?.num_ctx > 0, 'fallback plan should include a positive context length', failures);
  assert(!fallback.plan?.provider && !fallback.plan?.cloudProvider, 'Autopilot must stay local-first and avoid cloud routing fields', failures);

  const codePlan = resolver.resolveModelExperiencePlan({
    model: 'deepseek-coder:33b',
    workspace: 'casual',
    prompt: 'Refactor this TypeScript class and explain the bug.',
    modelInfo: { contextLength: 32768, parameterSize: '33B', quantizationLevel: 'Q4_K_M' },
  });
  assert(codePlan.plan?.taskIntent === 'code', `DeepSeek/code prompt should resolve code intent (got ${codePlan.plan?.taskIntent})`, failures);
  assert(codePlan.plan?.effectiveOptions?.temperature <= 0.3, 'code intent should keep deterministic sampling defaults', failures);
  assert(codePlan.plan?.effectiveOptions?.num_ctx <= 32768, 'code plan should respect model context metadata', failures);
  assert(!['openai', 'anthropic', 'opus', 'gpt'].includes(String(codePlan.plan?.softBackendPreference || '').toLowerCase()), 'soft backend should be a local backend id', failures);

  const clamped = resolver.resolveModelExperiencePlan({
    model: 'llama3.1:8b',
    workspace: 'work',
    modelInfo: { contextLength: 8192 },
    session: {
      tuningMode: 'advanced',
      contextLengthTokens: 131072,
      advancedOverrides: {
        temperature: 9,
        top_p: 2,
        num_batch: 9999,
        softBackendPreference: 'mosaic',
        ignoredDanger: true,
      },
    },
  });
  assert(clamped.plan?.effectiveOptions?.num_ctx === 8192, `context override should clamp to metadata cap (got ${clamped.plan?.effectiveOptions?.num_ctx})`, failures);
  assert(clamped.plan?.effectiveOptions?.temperature === 2, 'advanced temperature should clamp to resolver max', failures);
  assert(clamped.plan?.effectiveOptions?.top_p === 1, 'advanced top_p should clamp to resolver max', failures);
  assert(clamped.plan?.effectiveOptions?.num_batch === 2048, 'advanced batch should clamp to resolver max', failures);
  assert(!Object.prototype.hasOwnProperty.call(clamped.plan?.effectiveOptions || {}, 'ignoredDanger'), 'invalid advanced keys must be dropped', failures);
  assert(clamped.plan?.softBackendPreference !== 'mosaic', 'Mosaic must not be accepted as an Autopilot soft backend', failures);

  const presetAndSession = resolver.resolveModelExperiencePlan({
    model: 'qwen2.5-coder:14b',
    workspace: 'code',
    preset: {
      temperature: 0.33,
      top_p: 0.81,
      top_k: 17,
      context_length: 24576,
      system_prompt: 'Use repository-local evidence.',
      device_pin: 'ollama-cpu',
      task_intent: 'reasoning',
      advanced_options: { repeat_penalty: 1.19, softBackendPreference: 'llamanode' },
    },
    session: {
      contextLengthTokens: 4096,
      backendOverride: 'openvino-npu',
      taskIntent: 'code',
    },
  });
  assert(presetAndSession.plan?.effectiveOptions?.temperature === 0.33, 'stored preset should override sampling temperature', failures);
  assert(presetAndSession.plan?.effectiveOptions?.repeat_penalty === 1.19, 'stored advanced preset options should apply', failures);
  assert(presetAndSession.plan?.systemPrompt === 'Use repository-local evidence.', 'stored preset system prompt should flow into the plan', failures);
  assert(presetAndSession.plan?.effectiveOptions?.num_ctx === 4096, 'per-chat context override should win over preset context', failures);
  assert(presetAndSession.plan?.explicitBackendPin === 'openvino-npu', 'per-chat backend override should win over preset device pin', failures);
  assert(presetAndSession.plan?.taskIntent === 'code', 'per-chat task intent should win over preset task intent', failures);

  const sanitized = resolver.sanitizeAdvancedOptions({
    softBackendPreference: 'mosaic',
    forceBackend: 'ollama-cpu',
    temperature: '0.42',
    script: 'rm -rf',
  });
  assert(sanitized.temperature === 0.42, 'valid advanced numeric values should survive sanitization', failures);
  assert(!Object.prototype.hasOwnProperty.call(sanitized, 'forceBackend'), 'advanced options must not smuggle forceBackend', failures);
  assert(!Object.prototype.hasOwnProperty.call(sanitized, 'softBackendPreference'), 'invalid soft backend ids must be rejected', failures);
  assert(!Object.prototype.hasOwnProperty.call(sanitized, 'script'), 'unknown advanced keys must be rejected', failures);

  const resolverSource = read('electron/services/model-experience-resolver.js');
  const ipcSource = read('electron/ipc-handlers.js');
  const orchestratorSource = read('electron/services/inference-orchestrator.js');
  const sessionStoreSource = read('src/stores/chatV2SessionStore.js');
  const modelSliceSource = read('src/stores/slices/modelSlice.js');
  const buildOptionsSource = read('src/chat-v2/runtime/buildInferenceOptions.js');
  const chatEngineSource = read('src/chat-v2/engine/chatEngine.js');
  const presetsSource = read('src/components/Settings/ModelPresets.jsx');
  const surfaceSource = read('src/chat-v2/ui/ChatV2Surface.jsx');

  assert(!resolver.ALLOWED_BACKENDS.has('mosaic'), 'resolver allow-list must keep Mosaic out of normal Autopilot routing', failures);
  assert(!resolverSource.includes('DEVFORGE_SPEC_DECODE_ENABLE'), 'Autopilot resolver must not enable speculative decoding', failures);
  assert(ipcSource.includes("ipcMain.handle('model:resolveExperiencePlan'"), 'IPC must expose model:resolveExperiencePlan', failures);
  assert(ipcSource.includes('softBackendPreference') && ipcSource.includes('sanitizeExperiencePlan'), 'IPC must sanitize soft backend preference and experiencePlan metadata', failures);
  assert(orchestratorSource.includes('softBackendPreference') && orchestratorSource.includes("selectionSource: 'softBackendPreference'"), 'orchestrator must treat soft backend preference as advisory routing only', failures);
  assert(orchestratorSource.includes('selectedTaskIntent')
    && orchestratorSource.includes('overrideTrace')
    && orchestratorSource.includes('clampReasons')
    && orchestratorSource.includes('backendDecisionSource'),
  'runtime telemetry must expose selected task intent, override trace, clamp reasons, and backend decision source', failures);
  assert(modelSliceSource.includes('selectedTaskIntent')
    && modelSliceSource.includes('overrideTrace')
    && modelSliceSource.includes('clampReasons')
    && modelSliceSource.includes('backendDecisionSource'),
  'renderer runtime state must preserve Autopilot telemetry fields', failures);
  assert(sessionStoreSource.includes("tuningMode: 'auto'") && sessionStoreSource.includes('sanitizeAdvancedOverrides'), 'session store must expose safe auto/advanced controls', failures);
  assert(buildOptionsSource.includes('resolveAutopilotOptions') && buildOptionsSource.includes('buildSessionPayload'), 'Chat V2 option builder must delegate to the Autopilot resolver', failures);
  assert(chatEngineSource.includes('experiencePlan') && chatEngineSource.includes('softBackendPreference'), 'Chat engine must carry Autopilot metadata separately from raw options', failures);
  assert(presetsSource.includes('task_intent') && presetsSource.includes('advanced_options'), 'Model Presets UI must persist task intent and whitelisted advanced options', failures);
  assert(surfaceSource.includes("handleAdvancedNumber('top_k'")
    && surfaceSource.includes("handleAdvancedNumber('repeat_penalty'")
    && surfaceSource.includes("handleAdvancedNumber('num_ctx'"),
  'Chat V2 Advanced drawer must expose top-k, repeat penalty, and context overrides', failures);
  assert(surfaceSource.includes('handleSaveTuningPreset')
    && surfaceSource.includes('handleResetTuningSession')
    && surfaceSource.includes('handleResetModelPreset')
    && surfaceSource.includes('handleApplySafeFit')
    && surfaceSource.includes('autopilotDetailsOpen')
    && surfaceSource.includes('preflightWarnings')
    && surfaceSource.includes('Why This Plan')
    && surfaceSource.includes('Reset Preset'),
  'Chat V2 must expose explainable Autopilot details, preflight warnings, and tuning-session save/reset flows', failures);
  assert(surfaceSource.includes('modelHealthOpen')
    && surfaceSource.includes('modelHealthStatus')
    && surfaceSource.includes('modelHealthChecks')
    && surfaceSource.includes('No model selected.')
    && surfaceSource.includes('Backend is not ready yet.')
    && surfaceSource.includes('Auto Fallback')
    && surfaceSource.includes('Large local GGUF may be more stable with Safe Fit tuning.'),
  'Chat V2 must expose a model health preflight and recovery surface with blocked/readiness diagnostics', failures);
  assert(surfaceSource.includes('recoveryState')
    && surfaceSource.includes('handleRetrySameBackend')
    && surfaceSource.includes('handleRetryAutoFallback')
    && surfaceSource.includes('handleReloadAndRetry')
    && surfaceSource.includes('Fallback')
    && surfaceSource.includes('Reload'),
  'Chat V2 must expose guided recovery choices for same-backend retry, safe fallback, and reload/retry', failures);
  assert(orchestratorSource.includes('isMosaicRuntimeEnabled()') && ipcSource.includes("ALLOWED_FORCE_BACKENDS.add('mosaic')"), 'Mosaic must remain hidden behind existing dev env gates', failures);

  if (failures.length) {
    console.error('model-experience-autopilot-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('model-experience-autopilot-smoke PASS');
}

main();
