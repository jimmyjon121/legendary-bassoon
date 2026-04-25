'use strict';

/**
 * Pure merge for per-model preset system prompts (Chat V2).
 * Kept in CommonJS so release-gate smokes can require() it from Node.
 */
function mergePresetSystemPrompt(options, activePreset) {
  if (!activePreset || !options || typeof options !== 'object') return options;
  const raw = activePreset.system_prompt != null ? activePreset.system_prompt : activePreset.systemPrompt;
  const sp = String(raw ?? '').trim();
  if (!sp) return options;
  return { ...options, systemPrompt: sp };
}

module.exports = { mergePresetSystemPrompt };
