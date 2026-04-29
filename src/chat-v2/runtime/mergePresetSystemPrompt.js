/**
 * ESM twin of mergePresetSystemPrompt.cjs for Vite/browser imports.
 * Keep behavior in sync with the CommonJS helper used by Node smokes.
 */
export function mergePresetSystemPrompt(options, activePreset) {
  if (!activePreset || !options || typeof options !== 'object') return options;
  const raw = activePreset.system_prompt != null ? activePreset.system_prompt : activePreset.systemPrompt;
  const sp = String(raw ?? '').trim();
  if (!sp) return options;
  return { ...options, systemPrompt: sp };
}
