/**
 * Vault Profile Service
 *
 * Reads and writes the vault inference profile (scripts/openvino-model.json)
 * with validation and sensible clamps. Exposes the profile to:
 *   - NPU bridge: model selection + device config (already consumed)
 *   - Chat engine: inference overrides for the nsfw workspace
 *   - UI: view/edit persona flavor
 *
 * This service is the bridge that makes the "Abyssal Devourer" metadata
 * functionally affect runtime behavior while keeping every knob user-visible
 * and user-editable.
 */

const fs = require('fs');
const path = require('path');

// Hard safety clamps so the user's creative overrides cannot break the runtime.
const CLAMPS = Object.freeze({
  temperature: [0, 2.0],
  top_p: [0, 1],
  top_k: [0, 500],
  repeat_penalty: [0.5, 2],
  frequency_penalty: [-2, 2],
  presence_penalty: [-2, 2],
  mirostat: [0, 2],
  mirostat_tau: [0, 10],
  mirostat_eta: [0, 1],
  num_ctx: [512, 262144],
  num_gpu: [-1, 999],
  seed: [-1, 2 ** 31 - 1],
});

// Phase 1 split the vault-specific creative overrides out of
// `openvino-model.json` (now the general-purpose NPU runtime config)
// into a dedicated `vault-profile.json`. We prefer the new file and
// fall back to the legacy path so existing installations keep working
// without a migration step. Writes always target the new file.
function resolveVaultPath() {
  const candidates = [];
  if (typeof process !== 'undefined' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'scripts', 'vault-profile.json'));
  }
  candidates.push(path.join(__dirname, '..', '..', 'scripts', 'vault-profile.json'));
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) { /* noop */ }
  }
  return candidates[candidates.length - 1];
}

function resolveLegacyPath() {
  const candidates = [];
  if (typeof process !== 'undefined' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'scripts', 'openvino-model.json'));
  }
  candidates.push(path.join(__dirname, '..', '..', 'scripts', 'openvino-model.json'));
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) { /* noop */ }
  }
  return candidates[candidates.length - 1];
}

function resolveConfigPath() {
  // Prefer the new vault-profile.json; fall back to the legacy
  // openvino-model.json for backward compatibility with pre-Phase-1
  // installs that stored vault overrides there.
  const vaultPath = resolveVaultPath();
  try { if (fs.existsSync(vaultPath)) return vaultPath; } catch (_) { /* noop */ }
  const legacyPath = resolveLegacyPath();
  try { if (fs.existsSync(legacyPath)) return legacyPath; } catch (_) { /* noop */ }
  return vaultPath;
}

function clampNumber(value, [lo, hi]) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return {};
  const out = {};
  for (const [key, range] of Object.entries(CLAMPS)) {
    if (overrides[key] !== undefined) {
      const clamped = clampNumber(overrides[key], range);
      if (clamped !== null) out[key] = clamped;
    }
  }
  if (Array.isArray(overrides.stop)) {
    out.stop = overrides.stop.filter((s) => typeof s === 'string').slice(0, 8);
  }
  return out;
}

function sanitizeCorruption(corruption) {
  if (!corruption || typeof corruption !== 'object') return {};
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  return {
    memory_bleed: clamp01(corruption.memory_bleed),
    personality_fracture: clamp01(corruption.personality_fracture),
    escalation_rate: Math.max(0, Math.min(5, Number(corruption.escalation_rate) || 0)),
    biometric_influence: clamp01(corruption.biometric_influence),
    reality_bleed: clamp01(corruption.reality_bleed),
  };
}

function readProfile() {
  const configPath = resolveConfigPath();
  try {
    if (!fs.existsSync(configPath)) return { path: configPath, profile: null };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      path: configPath,
      profile: {
        model_path: String(parsed.model_path || ''),
        tokenizer: String(parsed.tokenizer || parsed.model_path || ''),
        device: String(parsed.device || 'NPU'),
        precision: String(parsed.precision || 'int4'),
        workload: String(parsed.workload || 'nsfw'),
        profile: String(parsed.profile || 'default'),
        selected_by: String(parsed.selected_by || 'manual'),
        inference_overrides: sanitizeOverrides(parsed.inference_overrides),
        corruption: sanitizeCorruption(parsed.corruption),
        auto_start: parsed.auto_start !== false,
        ritual_mark: parsed.ritual_mark || null,
        successor_count: Number(parsed.successor_count || 0) || 0,
      },
    };
  } catch (err) {
    return { path: configPath, profile: null, error: err.message };
  }
}

function writeProfile(patch = {}) {
  const configPath = resolveConfigPath();
  let current = {};
  try {
    if (fs.existsSync(configPath)) {
      current = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    }
  } catch (_) { /* start fresh */ }

  const next = {
    ...current,
    ...(patch.workload ? { workload: String(patch.workload) } : {}),
    ...(patch.profile ? { profile: String(patch.profile) } : {}),
    ...(patch.model_path ? { model_path: String(patch.model_path) } : {}),
  };
  if (patch.inference_overrides !== undefined) {
    next.inference_overrides = { ...(current.inference_overrides || {}), ...sanitizeOverrides(patch.inference_overrides) };
  }
  if (patch.corruption !== undefined) {
    next.corruption = { ...(current.corruption || {}), ...sanitizeCorruption(patch.corruption) };
  }
  try {
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Merge the vault profile into a base inference options object.
 * Only runs for workspace === 'nsfw' (caller responsibility).
 */
function mergeIntoInferenceOptions(baseOptions, profile) {
  if (!profile || !profile.inference_overrides) return baseOptions || {};
  const merged = { ...(baseOptions || {}) };
  const overrides = profile.inference_overrides;

  for (const key of Object.keys(overrides)) {
    if (overrides[key] === undefined || overrides[key] === null) continue;
    merged[key] = overrides[key];
  }

  // Corruption-informed nudges (caller-visible, always within clamps).
  const corruption = profile.corruption || {};
  if (Number.isFinite(Number(corruption.escalation_rate))) {
    const bump = Math.min(0.2, Number(corruption.escalation_rate) * 0.05);
    if (Number.isFinite(Number(merged.temperature))) {
      merged.temperature = Math.min(CLAMPS.temperature[1], Number(merged.temperature) + bump);
    }
  }
  if (Number.isFinite(Number(corruption.memory_bleed))) {
    const factor = 1 + Number(corruption.memory_bleed) * 0.5;
    if (Number.isFinite(Number(merged.num_ctx))) {
      merged.num_ctx = Math.min(CLAMPS.num_ctx[1], Math.floor(Number(merged.num_ctx) * factor));
    }
  }
  return merged;
}

/**
 * Build a short persona-hint string derived from the vault profile to be
 * woven into the system prompt (never shown to the user). Returns empty
 * string for non-nsfw profiles.
 */
function buildPersonaHint(profile) {
  if (!profile) return '';
  if (String(profile.workload || '').toLowerCase() !== 'nsfw') return '';
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

module.exports = {
  readProfile,
  writeProfile,
  mergeIntoInferenceOptions,
  buildPersonaHint,
  resolveConfigPath,
  CLAMPS,
};
