/**
 * Shared runtime vocabulary for the renderer core.
 *
 * DevForge is still JavaScript-first, so this module provides stable string
 * contracts that would otherwise be scattered across UI, stores, and runtime
 * adapters.
 */

export const WORKSPACE_IDS = Object.freeze({
  CASUAL: 'casual',
  WORK: 'work',
  CODE: 'code',
  RESEARCH: 'research',
  CREATIVE: 'creative',
  // Persisted workspace id. UI and docs call this workspace "Vault".
  VAULT: 'nsfw',
});

export const MODEL_CATALOG_SOURCES = Object.freeze({
  OLLAMA: 'ollama',
  LLAMANODE: 'llamanode',
  LM_STUDIO: 'lmstudio',
  NPU: 'npu',
});

export const RUNTIME_MODES = Object.freeze({
  LIVE: 'live',
  MOCK: 'mock',
});

export function normalizeWorkspaceId(value, fallback = WORKSPACE_IDS.CASUAL) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'vault') return WORKSPACE_IDS.VAULT;
  return normalized;
}

export function isVaultWorkspace(value) {
  return normalizeWorkspaceId(value) === WORKSPACE_IDS.VAULT;
}
