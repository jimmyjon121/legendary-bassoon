// Unified Model Catalog slice
//
// Single cached source of truth for everything the UI needs to list a model:
// Ollama-managed models, direct-loaded GGUFs, LM Studio scans, and NPU
// OpenVINO state. Replaces the pattern where ModelSelector (and others)
// fired parallel useEffect refreshes on every mount.
//
// Contract:
//   - hydrate({ force }) fetches all sources in parallel, dedupes, updates
//     the catalog + lastHydratedAt. Re-entrancy is serialized with a shared
//     in-flight promise. Default TTL short-circuits when fresh.
//   - invalidate(source?) clears the TTL marker so the next hydrate refetches.
//     If a source is provided, only that source refetches; other sources
//     keep their cached entries.
//   - watch() wires filesystem / IPC events to auto-invalidate (Phase 1+
//     will add fs.watch on the LM Studio directory). For Phase 0 this is a
//     no-op stub so the contract is stable.
//
// Model id is a stable string used across the orchestrator and UI:
//   - Ollama: the tag, e.g. "qwen2.5:7b-instruct-q4_K_M"
//   - Local GGUF: "gguf:<absolute-path>"
//   - LM Studio GGUF (pre-registration): "lmstudio:<absolute-path>" (UI hint
//     that selecting it will call loadLocalGguf and upgrade to gguf:)
//   - NPU/OpenVINO: "npu:<hf-id-or-path>"

import { MODEL_CATALOG_SOURCES } from '../../core/types';
import {
  MODEL_CATALOG_TTL_MS,
  catalogEntryHasAnySource,
  createModelCatalogSourceStates,
  dedupeModelCatalog,
  fetchModelCatalogSource,
} from '../../core/modelCatalogService';

function entryHasAnySource(entry, sourceSet) {
  return catalogEntryHasAnySource(entry, sourceSet);
}

export const createModelCatalogSlice = (set, get) => ({
  // === State ===
  modelCatalog: new Map(),
  modelCatalogSources: createModelCatalogSourceStates(),
  modelCatalogStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  modelCatalogLastHydratedAt: 0,
  modelCatalogLastError: null,
  modelCatalogHydrateInflight: null,
  npuStatus: null,

  // === Actions ===
  hydrateModelCatalog: async ({ force = false, ttlMs = MODEL_CATALOG_TTL_MS, sources = null } = {}) => {
    const state = get();

    // Reuse in-flight hydrate so concurrent callers don't fan out.
    if (state.modelCatalogHydrateInflight) {
      return state.modelCatalogHydrateInflight;
    }

    const wantedSources = Array.isArray(sources) && sources.length > 0
      ? new Set(sources)
      : null;

    const now = Date.now();
    const allWantedSourcesFresh = wantedSources
      ? Array.from(wantedSources).every((source) => {
        const sourceState = state.modelCatalogSources?.[source];
        return sourceState?.status === 'ready' && (now - Number(sourceState.fetchedAt || 0)) < ttlMs;
      })
      : true;

    if (!force && state.modelCatalogStatus === 'ready' && allWantedSourcesFresh && (now - state.modelCatalogLastHydratedAt) < ttlMs) {
      return {
        models: Array.from(state.modelCatalog.values()),
        fromCache: true,
        errors: [],
      };
    }

    const task = (async () => {
      set({ modelCatalogStatus: 'loading' });

      const errors = [];
      const results = wantedSources
        ? Array.from(state.modelCatalog.values()).filter((entry) => !entryHasAnySource(entry, wantedSources))
        : [];
      const next = { ...state.modelCatalogSources };

      const runFetch = async (key, fetchFn, onSuccess) => {
        if (wantedSources && !wantedSources.has(key)) return;
        next[key] = { ...next[key], status: 'loading', error: null };
        try {
          await onSuccess(await fetchFn());
          next[key] = { status: 'ready', error: null, fetchedAt: Date.now() };
        } catch (err) {
          const message = err?.message || String(err);
          errors.push(message);
          next[key] = { status: 'error', error: message, fetchedAt: Date.now() };
        }
      };

      await Promise.all([
        runFetch(MODEL_CATALOG_SOURCES.OLLAMA, () => fetchModelCatalogSource(MODEL_CATALOG_SOURCES.OLLAMA), (entries) => results.push(...entries)),
        runFetch(MODEL_CATALOG_SOURCES.LLAMANODE, () => fetchModelCatalogSource(MODEL_CATALOG_SOURCES.LLAMANODE), (entries) => results.push(...entries)),
        runFetch(MODEL_CATALOG_SOURCES.LM_STUDIO, () => fetchModelCatalogSource(MODEL_CATALOG_SOURCES.LM_STUDIO), (entries) => results.push(...entries)),
        runFetch(MODEL_CATALOG_SOURCES.NPU, () => fetchModelCatalogSource(MODEL_CATALOG_SOURCES.NPU), ({ entries, status }) => {
          results.push(...entries);
          set({ npuStatus: status });
        }),
      ]);

      const catalog = dedupeModelCatalog(results);
      const anyReady = Object.values(next).some((s) => s.status === 'ready');

      set({
        modelCatalog: catalog,
        modelCatalogSources: next,
        modelCatalogStatus: anyReady ? 'ready' : 'error',
        modelCatalogLastHydratedAt: Date.now(),
        modelCatalogLastError: errors.length > 0 ? errors.join('; ') : null,
      });

      return {
        models: Array.from(catalog.values()),
        fromCache: false,
        errors,
      };
    })();

    set({ modelCatalogHydrateInflight: task });
    try {
      return await task;
    } finally {
      set({ modelCatalogHydrateInflight: null });
    }
  },

  invalidateModelCatalog: (source = null) => {
    set((state) => ({
      modelCatalogLastHydratedAt: source ? state.modelCatalogLastHydratedAt : 0,
      modelCatalogSources: source
        ? {
          ...state.modelCatalogSources,
          [source]: { ...(state.modelCatalogSources[source] || {}), fetchedAt: 0 },
        }
        : createModelCatalogSourceStates(),
    }));
  },

  // Phase 0: watch() is a no-op stub. Phase 1 will wire fs.watch on the
  // LM Studio folder and Ollama pull-progress IPC events.
  watchModelCatalog: () => () => {},
});
