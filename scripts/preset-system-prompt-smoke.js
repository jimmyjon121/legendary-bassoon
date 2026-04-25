#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { mergePresetSystemPrompt } = require('../src/chat-v2/runtime/mergePresetSystemPrompt.cjs');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  const failures = [];

  const o = mergePresetSystemPrompt({ num_ctx: 4096, temperature: 0.7 }, { system_prompt: 'Preset wins.' });
  if (o.systemPrompt !== 'Preset wins.') failures.push('mergePresetSystemPrompt should set systemPrompt from system_prompt');

  const o2 = mergePresetSystemPrompt({ num_ctx: 1 }, { system_prompt: '   ' });
  if ('systemPrompt' in o2) failures.push('mergePresetSystemPrompt must omit empty system_prompt');

  const bo = read('src/chat-v2/runtime/buildInferenceOptions.js');
  if (!bo.includes('mergePresetSystemPrompt')) failures.push('buildInferenceOptions must call mergePresetSystemPrompt');
  if (!bo.includes('useChatV2SessionStore')) failures.push('buildInferenceOptions must read chat session store for context override');

  const eng = read('src/chat-v2/engine/chatEngine.js');
  if (!eng.includes('presetSystemPrompt')) failures.push('chatEngine must extract presetSystemPrompt before IPC options');
  if (!eng.includes('presetPrompt || workspacePrompt')) failures.push('chatEngine buildSystemPrompt must prefer preset over workspace');

  if (failures.length) {
    console.error('preset-system-prompt-smoke FAILED');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log('preset-system-prompt-smoke PASS');
}

main();
