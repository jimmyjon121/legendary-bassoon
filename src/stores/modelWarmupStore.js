/**
 * Lightweight global store for the model warm-up progress overlay.
 *
 * Components that trigger a load (chat send, ModelSelector "Use", Settings
 * Warmup, etc.) call `runWithProgress(model)` and a single overlay mounted
 * in <Layout> renders the progress bar so we never build duplicate UIs.
 */

import { create } from 'zustand';
import { api } from '../utils/electronAPI';

const INITIAL_STATE = Object.freeze({
  active: false,
  model: null,
  stage: null,           // preparing | loading-weights | verifying-first-token | ready | error
  message: '',
  progress: 0,           // 0..100
  startedAt: null,
  elapsedMs: 0,
  etaMs: null,
  sizeBytes: 0,
  sizeGiB: 0,
  family: null,
  quantization: null,
  estimateMs: null,
  memoryRequirement: null,
  memoryVerdict: null,
  sparkProfile: null,
  moe: null,
  expertTelemetry: null,
  error: null,
});

export const useModelWarmupStore = create((set, get) => ({
  ...INITIAL_STATE,
  _activeHandle: null,

  reset: () => set({ ...INITIAL_STATE }),

  acceptEvent: (chunk = {}) => {
    if (!chunk || typeof chunk !== 'object') return;

    const patch = {
      active: chunk.type !== 'done' && chunk.type !== 'error' && chunk.type !== 'cancelled',
      stage: chunk.stage || get().stage,
      message: typeof chunk.message === 'string' ? chunk.message : get().message,
      progress: Number.isFinite(Number(chunk.progress))
        ? Math.max(0, Math.min(100, Number(chunk.progress)))
        : get().progress,
      elapsedMs: Number.isFinite(Number(chunk.elapsedMs)) ? Number(chunk.elapsedMs) : get().elapsedMs,
      etaMs: Number.isFinite(Number(chunk.etaMs)) ? Number(chunk.etaMs) : get().etaMs,
      sizeBytes: Number.isFinite(Number(chunk.sizeBytes)) && chunk.sizeBytes > 0
        ? Number(chunk.sizeBytes)
        : get().sizeBytes,
      sizeGiB: Number.isFinite(Number(chunk.sizeGiB)) && chunk.sizeGiB > 0
        ? Number(chunk.sizeGiB)
        : get().sizeGiB,
      family: chunk.family || get().family,
      quantization: chunk.quantization || get().quantization,
      estimateMs: Number.isFinite(Number(chunk.estimateMs)) ? Number(chunk.estimateMs) : get().estimateMs,
      memoryRequirement: chunk.memoryRequirement || get().memoryRequirement,
      memoryVerdict: chunk.memoryVerdict || get().memoryVerdict,
      sparkProfile: chunk.sparkProfile || get().sparkProfile,
      moe: chunk.moe || get().moe,
      expertTelemetry: chunk.expertTelemetry || get().expertTelemetry,
      error: chunk.type === 'error' ? (chunk.message || 'Warmup failed') : (chunk.type === 'done' ? null : get().error),
    };

    if (chunk.type === 'start') {
      patch.active = true;
      patch.startedAt = chunk.startedAt || Date.now();
      patch.error = null;
      patch.progress = 0;
    }

    set(patch);
  },

  runWithProgress: async (model) => {
    if (!model) return { success: false, error: 'No model selected' };
    const current = get();
    if (current.active && current.model === model) {
      return { success: false, error: 'Warmup already in progress' };
    }

    // Cancel any prior subscription cleanly.
    if (current._activeHandle?.unsubscribe) {
      try { current._activeHandle.unsubscribe(); } catch (_) { /* noop */ }
    }

    set({
      ...INITIAL_STATE,
      active: true,
      model,
      stage: 'preparing',
      message: 'Preparing runtime...',
      progress: 1,
      startedAt: Date.now(),
    });

    let handle = null;
    try {
      handle = api.warmupModelWithProgress(model, (chunk) => {
        get().acceptEvent({ ...chunk, model });
      });
      set({ _activeHandle: handle });
      const result = await (handle?.promise || Promise.resolve({ success: false }));

      if (result?.success === false && get().active) {
        set({
          active: false,
          stage: 'error',
          message: result?.error || 'Warmup failed',
          error: result?.error || 'Warmup failed',
        });
      } else if (result?.success !== false) {
        set({ active: false, stage: 'ready', progress: 100 });
      }
      return result;
    } catch (error) {
      set({
        active: false,
        stage: 'error',
        message: error?.message || 'Warmup failed',
        error: error?.message || 'Warmup failed',
      });
      return { success: false, error: error?.message || 'Warmup failed' };
    } finally {
      try { handle?.unsubscribe?.(); } catch (_) { /* noop */ }
      set({ _activeHandle: null });
    }
  },

  dismiss: () => {
    const handle = get()._activeHandle;
    if (handle?.unsubscribe) {
      try { handle.unsubscribe(); } catch (_) { /* noop */ }
    }
    set({ ...INITIAL_STATE });
  },
}));

export function triggerWarmupWithProgress(model) {
  return useModelWarmupStore.getState().runWithProgress(model);
}
