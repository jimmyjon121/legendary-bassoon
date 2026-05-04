#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function assertContains(haystack, needle, description, failures) {
  if (!haystack.includes(needle)) {
    failures.push(description);
  }
}

function assertNotContains(haystack, needle, description, failures) {
  if (haystack.includes(needle)) {
    failures.push(description);
  }
}

function main() {
  const failures = [];
  const messageSlice = read('src/stores/slices/messageSlice.js');
  const app = read('src/App.jsx');
  const ipcHandlers = read('electron/ipc-handlers.js');
  const modelSlice = read('src/stores/slices/modelSlice.js');
  const modelExperience = read('src/services/modelExperience.js');
  const presetsUi = read('src/components/Settings/ModelPresets.jsx');
  const modelOptimizer = read('src/services/modelOptimizer.js');
  const layout = read('src/components/Layout/Layout.jsx');

  // Frontend should send one chat-style payload; compatibility shaping lives in main process.
  assertContains(
    messageSlice,
    'const streamPayload = {',
    'Message slice must build a single chat-style stream payload',
    failures
  );
  assertContains(
    messageSlice,
    '( there| again)?',
    'Message slice greeting detection must include simple variants like "hi there"',
    failures
  );
  assertNotContains(
    messageSlice,
    'buildGenerateFallbackPrompt(',
    'Message slice must not build compat fallback prompts directly',
    failures
  );
  assertNotContains(
    messageSlice,
    'buildGptOssHarmonyPrompt(',
    'Message slice must not build GPT-OSS harmony prompts directly',
    failures
  );

  // Natural-chat overhaul: no short-turn shaping, no stability mode, no post-hoc sanitization
  assertNotContains(
    messageSlice,
    'SHORT TURN MODE',
    'Message slice must not inject SHORT TURN MODE into system prompt',
    failures
  );
  assertNotContains(
    messageSlice,
    'enableStabilityMode',
    'Message slice must not contain enableStabilityMode (stability mode removed)',
    failures
  );
  assertNotContains(
    messageSlice,
    'enforceShortCasualResponse',
    'Message slice must not contain enforceShortCasualResponse (post-hoc sanitization removed)',
    failures
  );
  assertNotContains(
    messageSlice,
    'sanitizeSimpleGreetingResponse',
    'Message slice must not contain sanitizeSimpleGreetingResponse (post-hoc sanitization removed)',
    failures
  );

  // Model optimizer must set adaptive num_predict per workspace
  assertContains(
    modelOptimizer,
    "settings.num_predict = 8192",
    'Model optimizer must set num_predict=8192 for code workspace',
    failures
  );
  assertContains(
    modelOptimizer,
    "settings.num_predict = 2048",
    'Model optimizer must set num_predict=2048 for casual workspace',
    failures
  );
  assertContains(
    modelOptimizer,
    "'qwen3':",
    'Model optimizer must include a dedicated Qwen3 family profile',
    failures
  );
  assertContains(
    modelOptimizer,
    "family: 'qwen3'",
    'Model optimizer family detection must route Qwen3 names to the Qwen3 profile',
    failures
  );

  // IPC ingress must sanitize/clamp input before routing.
  assertContains(
    ipcHandlers,
    'function sanitizeInferenceInput(rawPayload = {})',
    'IPC handlers must define inference payload sanitizer',
    failures
  );
  assertContains(
    ipcHandlers,
    'const safePayload = sanitizeInferenceInput(payload);',
    'llm:send must sanitize payload before request construction',
    failures
  );
  assertContains(
    ipcHandlers,
    'const safePayload = sanitizeInferenceInput(payload || {});',
    'llm:stream must sanitize payload before request construction',
    failures
  );

  assertContains(
    layout,
    'window.electronAPI?.reloadWindow',
    'Layout refresh button must attempt Electron window reload when available',
    failures
  );
  assertContains(
    layout,
    'window.location.reload();',
    'Layout refresh button must guarantee a renderer reload fallback',
    failures
  );
  assertContains(
    app,
    'devforge:startup-complete',
    'App must skip the startup screen after an in-session refresh',
    failures
  );

  // Model readiness should not report online before setup phases settle.
  assertContains(
    modelSlice,
    "set({ isWarmingUp: false, modelStatus: 'online' });",
    'Model slice must finalize online state after warmup flow',
    failures
  );
  assertContains(
    modelSlice,
    "set({ modelStatus: 'online' });",
    'Model slice must finalize online state when warmup is unavailable',
    failures
  );

  // Capability hook contract should expose getCapabilityLevel for UI consumers.
  assertContains(
    modelExperience,
    'getCapabilityLevel: (capability) => {',
    'Model awareness hook must expose getCapabilityLevel',
    failures
  );

  // Preset editor should clamp values before saving.
  assertContains(
    presetsUi,
    'const PRESET_LIMITS = {',
    'Model presets UI must define input bounds',
    failures
  );
  assertContains(
    presetsUi,
    "if (field === 'context_length') {",
    'Model presets UI must normalize context length inputs',
    failures
  );

  if (failures.length > 0) {
    console.error('Normal Mode Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Normal Mode Eval PASS');
}

main();
