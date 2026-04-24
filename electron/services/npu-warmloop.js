/**
 * NPU Warm-Loop
 *
 * Keeps a small model (≤1.5B) resident on the Intel NPU during idle time
 * so embedding / intent / autocomplete calls hit a warm model with no
 * load-time penalty. Unloads when the system is under memory pressure,
 * on battery at low charge, or when the user opts into an efficiency /
 * laptop performance profile.
 *
 * Contract:
 *   const warmloop = createNpuWarmloop({ npuBridge, powerMode, getProfile });
 *   await warmloop.start();           // evaluates gates, loads if allowed
 *   await warmloop.evaluate();        // re-check gates (e.g., on profile change)
 *   await warmloop.stop();            // explicit unload
 *   warmloop.getStatus();             // UI/telemetry readout
 *
 * All gate evaluation is non-blocking and safe to call repeatedly. The
 * actual model load is delegated to npu-bridge so that we share the same
 * OpenVINO server process with user-initiated chat work.
 */

const os = require('os');

const DEFAULT_WARM_MODEL = 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov';

// Gates are conservative: we never hold the NPU hostage if the user is
// about to run out of memory or battery. These thresholds err on the
// side of "let the system breathe."
const DEFAULT_GATES = Object.freeze({
  minFreeRamGb: 4,       // skip warmloop if less than this is free
  batteryFloorPercent: 30, // unload when battery drops below this
  idleBeforeUnloadMs: 5 * 60 * 1000, // 5 min idle-plus-locked = unload
  coldWindowAfterUnloadMs: 60 * 1000, // don't re-load for 60s after an unload to avoid flap
  evaluationIntervalMs: 30 * 1000, // re-check every 30s
});

function formatBytes(n) {
  return `${(n / (1024 ** 3)).toFixed(1)} GB`;
}

function createNpuWarmloop({
  npuBridge,
  powerMode,
  getProfile,
  warmModel = DEFAULT_WARM_MODEL,
  gates = DEFAULT_GATES,
  onTransition = null,
  log = (...args) => console.log('[NpuWarmloop]', ...args),
} = {}) {
  if (!npuBridge) throw new Error('createNpuWarmloop requires npuBridge');
  if (typeof getProfile !== 'function') {
    throw new Error('createNpuWarmloop requires getProfile() => string');
  }

  const state = {
    active: false,        // true once a warm load succeeded
    lastEvaluatedAt: 0,
    lastLoadedAt: 0,
    lastUnloadedAt: 0,
    lastLoadedModel: null,
    lastDecision: null,
    lastError: null,
    transitions: [],
    timer: null,
    evaluating: false,
  };

  function emitTransition(active, reason, meta = {}) {
    const row = {
      ts: Date.now(),
      active: Boolean(active),
      reason: String(reason || 'unknown'),
      ...meta,
    };
    state.transitions.push(row);
    if (state.transitions.length > 120) {
      state.transitions.shift();
    }
    if (typeof onTransition === 'function') {
      try {
        onTransition(row);
      } catch (_) {
        // Non-blocking telemetry callback.
      }
    }
  }

  async function getFreeRamGb() {
    try {
      return os.freemem() / (1024 ** 3);
    } catch {
      return null;
    }
  }

  async function shouldBeWarm() {
    const profile = String(getProfile() || 'balanced').toLowerCase();
    if (profile === 'efficiency' || profile === 'laptop') {
      return { allow: false, reason: `profile=${profile}` };
    }

    const freeGb = await getFreeRamGb();
    if (freeGb !== null && freeGb < gates.minFreeRamGb) {
      return { allow: false, reason: `low-ram (${freeGb.toFixed(1)} GB free)` };
    }

    if (powerMode && typeof powerMode.getPowerState === 'function') {
      try {
        const power = await powerMode.getPowerState();
        if (power?.onBattery) {
          const pct = Number(power.batteryPercent);
          if (Number.isFinite(pct) && pct < gates.batteryFloorPercent) {
            return { allow: false, reason: `battery=${pct}%` };
          }
        }
      } catch (_) { /* non-blocking */ }
    }

    if (!npuBridge.npuAvailable) {
      // npuBridge maintains this flag after queryDevices; if it's false
      // an OpenVINO device enumeration still hasn't run or the NPU
      // truly isn't there. Either way we can't warm.
      try {
        const status = await npuBridge.getStatus();
        if (!status?.npuAvailable) {
          return { allow: false, reason: 'npu-not-available' };
        }
      } catch {
        return { allow: false, reason: 'npu-status-query-failed' };
      }
    }

    // Respect cold-window after an unload to avoid flapping.
    if (Date.now() - state.lastUnloadedAt < gates.coldWindowAfterUnloadMs) {
      return { allow: false, reason: 'cold-window' };
    }

    return { allow: true, reason: 'ok' };
  }

  async function loadWarmModel() {
    state.evaluating = true;
    try {
      log(`Loading warm model ${warmModel}`);
      const result = await npuBridge.loadModel(warmModel, {
        device: 'NPU',
        precision: 'int4',
      });
      if (result?.success) {
        state.active = true;
        state.lastLoadedAt = Date.now();
        state.lastLoadedModel = warmModel;
        state.lastError = null;
        emitTransition(true, 'warmloop-load', { model: warmModel });
        log('Warm model loaded');
      } else {
        state.lastError = result?.error || 'unknown-load-failure';
        log('Warm load failed:', state.lastError);
      }
    } finally {
      state.evaluating = false;
    }
  }

  async function unloadIfActive(reason = 'explicit') {
    if (!state.active) return;
    state.evaluating = true;
    try {
      // Prefer lightweight model unload over killing the Python server.
      // stopServer remains a fallback for old server versions.
      let unloaded = false;
      if (typeof npuBridge.unloadModel === 'function') {
        try {
          const result = await npuBridge.unloadModel();
          unloaded = Boolean(result?.success);
        } catch (_) {
          unloaded = false;
        }
      }
      if (!unloaded && typeof npuBridge.stopServer === 'function') {
        await npuBridge.stopServer();
      }
      state.active = false;
      state.lastUnloadedAt = Date.now();
      emitTransition(false, reason, { model: state.lastLoadedModel || warmModel });
      log(`Warm model unloaded (${reason})`);
    } finally {
      state.evaluating = false;
    }
  }

  async function evaluate() {
    if (state.evaluating) return state.lastDecision;
    state.lastEvaluatedAt = Date.now();
    const decision = await shouldBeWarm();
    state.lastDecision = decision;

    if (decision.allow && !state.active) {
      await loadWarmModel();
    } else if (!decision.allow && state.active) {
      await unloadIfActive(decision.reason);
    }
    return decision;
  }

  async function start() {
    await evaluate();
    if (!state.timer) {
      state.timer = setInterval(() => {
        evaluate().catch((err) => {
          log('Scheduled evaluation failed:', err?.message || err);
        });
      }, gates.evaluationIntervalMs);
      // Node's setInterval keeps the event loop alive — we don't want
      // that to block shutdown, so unref() on platforms that support it.
      if (typeof state.timer.unref === 'function') state.timer.unref();
    }
  }

  async function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    await unloadIfActive('stopped');
  }

  function getStatus() {
    return {
      active: state.active,
      warmModel,
      lastLoadedAt: state.lastLoadedAt || null,
      lastUnloadedAt: state.lastUnloadedAt || null,
      lastEvaluatedAt: state.lastEvaluatedAt || null,
      lastDecision: state.lastDecision,
      lastError: state.lastError,
      transitionCount: state.transitions.length,
      transitions: state.transitions.slice(-30),
      gates,
      freeRamGbAtLastCheck: null, // filled on demand by caller
    };
  }

  return {
    start,
    stop,
    evaluate,
    getStatus,
  };
}

module.exports = {
  createNpuWarmloop,
  DEFAULT_WARM_MODEL,
  DEFAULT_GATES,
};
