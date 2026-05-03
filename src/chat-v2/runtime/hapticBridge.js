/**
 * Haptic Bridge (renderer-side controller)
 *
 * Maps engine.sceneIntensity to vibrate() calls via IPC. Keeps a throttled
 * heartbeat so the main-process watchdog stays fed while generating, and
 * stops immediately on red safeword or when the user leaves the vault
 * workspace. Also stops when the window loses focus.
 *
 * The controller is strictly reactive — nothing is commanded unless the
 * engine is currently producing an intense beat. The user can always
 * disable the bridge in settings or disconnect from the safety bar.
 */

import { isVaultWorkspace, WORKSPACE_IDS } from '../../core/types';

const HEARTBEAT_MS = 600;
const FLOOR = 0.05;

const attached = new WeakMap();

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

export function attachHapticBridge(engine, { getWorkspace } = {}) {
  if (!engine) return () => {};
  if (attached.has(engine)) return attached.get(engine);

  let stopped = false;
  let config = null;
  let running = false;
  let lastIntensity = 0;
  let heartbeat = null;

  const workspaceOk = () => {
    if (!config) return false;
    if (!config.enabled) return false;
    if (config.enableOnlyInNsfwWorkspace) {
      const ws = typeof getWorkspace === 'function' ? getWorkspace() : WORKSPACE_IDS.VAULT;
      if (!isVaultWorkspace(ws)) return false;
    }
    return true;
  };

  const loadConfig = async () => {
    try {
      const res = await window.electronAPI?.hapticGetConfig?.();
      if (res?.success) config = res.config;
    } catch (_) { /* ignore */ }
  };

  const pushIntensity = async (intensity) => {
    if (stopped || !workspaceOk()) return;
    const target = clamp01(intensity);
    if (target < FLOOR) {
      if (lastIntensity > 0) {
        lastIntensity = 0;
        try { await window.electronAPI?.hapticStop?.(); } catch (_) { /* ignore */ }
      }
      return;
    }
    lastIntensity = target;
    try { await window.electronAPI?.hapticVibrate?.({ intensity: target }); }
    catch (_) { /* ignore */ }
  };

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      if (stopped) return;
      if (!workspaceOk()) { pushIntensity(0); return; }
      if (!running) { pushIntensity(0); return; }
      pushIntensity(engine.sceneIntensity || 0);
    }, HEARTBEAT_MS);
  };

  const stopHeartbeat = () => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  };

  const hardStop = async () => {
    running = false;
    lastIntensity = 0;
    stopHeartbeat();
    try { await window.electronAPI?.hapticStop?.(); } catch (_) { /* ignore */ }
  };

  const unsubEngine = engine.subscribe((state) => {
    if (stopped) return;
    if (state.isGenerating && !running) {
      running = true;
      if (workspaceOk()) startHeartbeat();
    }
    if (!state.isGenerating && running) {
      running = false;
      pushIntensity(0);
      setTimeout(stopHeartbeat, HEARTBEAT_MS * 2);
    }
  });

  const onSafety = (event) => {
    const detail = event?.detail || {};
    if (detail.type === 'hard-stop' || detail.type === 'aftercare-engaged') {
      hardStop();
    }
  };
  window.addEventListener('vault-safety', onSafety);

  const onBlur = () => { hardStop(); };
  window.addEventListener('blur', onBlur);

  const configPoll = setInterval(() => { if (!stopped) loadConfig(); }, 10000);
  loadConfig();

  const detach = () => {
    stopped = true;
    hardStop();
    try { unsubEngine?.(); } catch (_) { /* ignore */ }
    window.removeEventListener('vault-safety', onSafety);
    window.removeEventListener('blur', onBlur);
    clearInterval(configPoll);
    attached.delete(engine);
  };

  attached.set(engine, detach);
  return detach;
}

export default attachHapticBridge;
