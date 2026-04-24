/**
 * Vault Safety Service
 *
 * Stores and exposes the user-controlled safety configuration for the vault
 * workspace: safeword strings, aftercare persona, inactivity thresholds,
 * and intensity clamps. All state lives in electron-store; the chat engine
 * reads the relevant bits via IPC and enforces them client-side.
 *
 * Safewords are NEVER sent to the model. This service simply records what
 * the safewords are so the renderer can match them; detection and interception
 * happen in the renderer engine.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  safewords: {
    red: 'red',
    yellow: 'yellow',
    green: 'green',
  },
  aftercare: {
    enabled: true,
    inactivityMs: 90_000,
    persona: "You are a kind, attentive aftercare companion. The previous scene has ended. Offer the user warmth, reassurance, water, a blanket. Check in gently. Do not reference the scene's content in detail unless the user asks. Keep responses short and grounded.",
    autoTriggerIntensityThreshold: 0.6,
  },
  intensity: {
    yellowClamp: 0.5,
    redHardStop: true,
  },
});

function readConfig(store) {
  if (!store || typeof store.get !== 'function') return { ...DEFAULTS };
  const saved = store.get('vaultSafety');
  if (!saved || typeof saved !== 'object') return { ...DEFAULTS };
  return {
    enabled: saved.enabled !== false,
    safewords: {
      red: String(saved.safewords?.red || DEFAULTS.safewords.red).slice(0, 32).toLowerCase(),
      yellow: String(saved.safewords?.yellow || DEFAULTS.safewords.yellow).slice(0, 32).toLowerCase(),
      green: String(saved.safewords?.green || DEFAULTS.safewords.green).slice(0, 32).toLowerCase(),
    },
    aftercare: {
      enabled: saved.aftercare?.enabled !== false,
      inactivityMs: Math.max(30_000, Math.min(600_000, Number(saved.aftercare?.inactivityMs) || DEFAULTS.aftercare.inactivityMs)),
      persona: String(saved.aftercare?.persona || DEFAULTS.aftercare.persona).slice(0, 4000),
      autoTriggerIntensityThreshold: clamp01(Number(saved.aftercare?.autoTriggerIntensityThreshold) ?? DEFAULTS.aftercare.autoTriggerIntensityThreshold),
    },
    intensity: {
      yellowClamp: clamp01(Number(saved.intensity?.yellowClamp) ?? DEFAULTS.intensity.yellowClamp),
      redHardStop: saved.intensity?.redHardStop !== false,
    },
  };
}

function writeConfig(store, patch) {
  if (!store || typeof store.set !== 'function') {
    throw new Error('Store unavailable');
  }
  const current = readConfig(store);
  const next = {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    safewords: {
      ...current.safewords,
      ...(patch.safewords && typeof patch.safewords === 'object' ? patch.safewords : {}),
    },
    aftercare: {
      ...current.aftercare,
      ...(patch.aftercare && typeof patch.aftercare === 'object' ? patch.aftercare : {}),
    },
    intensity: {
      ...current.intensity,
      ...(patch.intensity && typeof patch.intensity === 'object' ? patch.intensity : {}),
    },
  };
  store.set('vaultSafety', next);
  return readConfig(store);
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  DEFAULTS,
  readConfig,
  writeConfig,
};
