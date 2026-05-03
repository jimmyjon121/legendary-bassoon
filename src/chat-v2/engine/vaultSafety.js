/**
 * Client-side vault safety primitives.
 *
 * - Detects user-defined safewords (red/yellow/green) in outgoing messages.
 * - Safewords are NEVER forwarded to the model.
 * - Emits a normalized intent that the engine interprets:
 *     { type: 'hard-stop' }   → abort stream, engage aftercare
 *     { type: 'soft-limit' }  → clamp intensity, send a gentle signal to model
 *     { type: 'resume' }      → release yellow clamp
 *
 * The user is always the director. Detection happens before any network call.
 */

import { isVaultWorkspace } from '../../core/types';

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  safewords: { red: 'red', yellow: 'yellow', green: 'green' },
  aftercare: {
    enabled: true,
    inactivityMs: 90_000,
    persona: "You are a kind, attentive aftercare companion. The previous scene has ended. Offer the user warmth and reassurance. Keep responses short and grounded.",
    autoTriggerIntensityThreshold: 0.6,
  },
  intensity: { yellowClamp: 0.5, redHardStop: true },
});

let cachedConfig = null;
let inflightLoad = null;

export function getSafetyConfigSync() {
  return cachedConfig || DEFAULT_CONFIG;
}

export async function loadSafetyConfig(force = false) {
  if (!force && cachedConfig) return cachedConfig;
  if (inflightLoad) return inflightLoad;
  inflightLoad = (async () => {
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api?.vaultSafetyGetConfig) {
        const res = await api.vaultSafetyGetConfig();
        if (res?.success && res.config) {
          cachedConfig = res.config;
          return cachedConfig;
        }
      }
    } catch (_) { /* fall through to default */ }
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  })();
  try { return await inflightLoad; } finally { inflightLoad = null; }
}

export async function saveSafetyConfig(patch) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (!api?.vaultSafetySetConfig) return null;
  const res = await api.vaultSafetySetConfig(patch || {});
  if (res?.success && res.config) {
    cachedConfig = res.config;
  }
  return cachedConfig;
}

/**
 * Detect a safeword in user input. Only active in the Vault workspace
 * and the config is enabled. Matches case-insensitively against the entire
 * trimmed message OR a leading "!red" / "!yellow" / "!green" sigil so a user
 * can write "red alert I need out" if they wish.
 *
 * Returns one of:
 *   null                             → no safeword
 *   { type: 'hard-stop', word }      → red
 *   { type: 'soft-limit', word }     → yellow
 *   { type: 'resume', word }         → green
 */
export function detectSafeword(text, workspace, config = cachedConfig) {
  if (!text || typeof text !== 'string') return null;
  if (!isVaultWorkspace(workspace)) return null;
  const cfg = config || DEFAULT_CONFIG;
  if (!cfg.enabled) return null;

  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const { red, yellow, green } = cfg.safewords || DEFAULT_CONFIG.safewords;
  const rk = String(red || 'red').toLowerCase();
  const yk = String(yellow || 'yellow').toLowerCase();
  const gk = String(green || 'green').toLowerCase();

  const matches = (word) => {
    if (!word) return false;
    if (trimmed === word) return true;
    if (trimmed.startsWith(`!${word}`)) return true;
    if (trimmed.startsWith(`${word} `) || trimmed.startsWith(`${word}.`) || trimmed.startsWith(`${word},`)) return true;
    return false;
  };

  if (matches(rk)) return { type: 'hard-stop', word: rk };
  if (matches(yk)) return { type: 'soft-limit', word: yk };
  if (matches(gk)) return { type: 'resume', word: gk };
  return null;
}

/**
 * Build an aftercare system message. The engine injects this ahead of the
 * regular vault system prompt for one turn to swap persona.
 */
export function buildAftercarePersona(config = cachedConfig) {
  const cfg = config || DEFAULT_CONFIG;
  return cfg.aftercare?.persona || DEFAULT_CONFIG.aftercare.persona;
}

export function getInactivityMs(config = cachedConfig) {
  const cfg = config || DEFAULT_CONFIG;
  return Math.max(30_000, Math.min(600_000, Number(cfg.aftercare?.inactivityMs) || DEFAULT_CONFIG.aftercare.inactivityMs));
}

/**
 * Intensity estimator: crude heuristic based on recent assistant tokens.
 * Counts explicit content keywords as a rough scene-intensity proxy so the
 * aftercare autopilot knows when to actually trigger vs stay silent.
 *
 * NOTE: This is client-only, never sent anywhere. It exists to decide whether
 * to proactively suggest aftercare after long inactivity.
 */
const INTENSITY_HINTS = [
  'moan', 'gasp', 'thrust', 'grind', 'climax', 'shudder', 'whimper', 'whisper',
  'bite', 'pin', 'tangle', 'writhe', 'surrender', 'edge', 'release', 'pulse',
];

export function estimateSceneIntensity(recentText) {
  if (!recentText || typeof recentText !== 'string') return 0;
  const lower = recentText.toLowerCase();
  let hits = 0;
  for (const hint of INTENSITY_HINTS) {
    if (lower.includes(hint)) hits += 1;
  }
  return Math.min(1, hits / 6);
}

// ─── Vault profile cache for persona hints ───────────────────────────────
let _profileCache = { at: 0, value: null };
export async function loadVaultProfile(force = false) {
  const now = Date.now();
  if (!force && now - _profileCache.at < 30_000 && _profileCache.value !== null) {
    return _profileCache.value;
  }
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    const res = api?.vaultGetProfile ? await api.vaultGetProfile() : null;
    const profile = res?.success ? res.profile : null;
    _profileCache = { at: now, value: profile };
    return profile;
  } catch (_) {
    _profileCache = { at: now, value: null };
    return null;
  }
}

export function getVaultProfileSync() {
  return _profileCache.value;
}

export function buildPersonaHint(profile) {
  if (!profile) return '';
  if (!isVaultWorkspace(profile.workload)) return '';
  const label = profile.profile || 'default';
  const c = profile.corruption || {};
  const bits = [];
  if (c.escalation_rate > 1.5) bits.push('escalate pacing deliberately across the scene');
  if (c.memory_bleed > 0.7) bits.push('weave in specifics the user established earlier');
  if (c.reality_bleed > 0.4) bits.push('blur boundaries between scene and sensory detail');
  if (c.personality_fracture > 0.6) bits.push('let the persona shift tone as intimacy deepens');
  if (bits.length === 0) return '';
  return `\n\nPersona profile "${label}" active: ${bits.join('; ')}. Stay in character throughout.`;
}
