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

const DEFAULT_TTL_MS = 30_000;

const SOURCE_STATES = () => ({
  ollama: { status: 'idle', error: null, fetchedAt: 0 },
  llamanode: { status: 'idle', error: null, fetchedAt: 0 },
  lmstudio: { status: 'idle', error: null, fetchedAt: 0 },
  npu: { status: 'idle', error: null, fetchedAt: 0 },
});

function toEntry({ id, name, source, sizeBytes = null, meta = null }) {
  if (!id) return null;
  return {
    id: String(id),
    name: String(name || id),
    source,
    sizeBytes,
    meta: meta || null,
  };
}

function dedupeCatalog(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    // Prefer entries with richer metadata; earlier entries win unless later
    // ones add a sizeBytes or meta block the earlier entry lacked.
    const existing = map.get(entry.id);
    if (!existing) {
      map.set(entry.id, entry);
      continue;
    }
    const merged = {
      ...existing,
      sizeBytes: existing.sizeBytes ?? entry.sizeBytes ?? null,
      meta: existing.meta || entry.meta || null,
      // Keep an aggregated source list for UI filtering.
      sources: Array.from(new Set([...(existing.sources || [existing.source]), entry.source])),
    };
    map.set(entry.id, merged);
  }
  return map;
}

function entryHasAnySource(entry, sourceSet) {
  if (!entry || !sourceSet) return false;
  const sources = Array.isArray(entry.sources) && entry.sources.length > 0
    ? entry.sources
    : [entry.source];
  return sources.some((source) => sourceSet.has(source));
}

async function fetchOllama() {
  const api = window.electronAPI;
  if (!api?.refreshModels && !api?.listModels) return [];
  try {
    // Prefer the dedicated refresh path so we get canonical Ollama metadata.
    if (typeof api.refreshModels === 'function') {
      const res = await api.refreshModels();
      const list = Array.isArray(res?.models) ? res.models : Array.isArray(res) ? res : [];
      return list.map((m) => toEntry({
        id: m.name || m.id,
        name: m.name || m.id,
        source: 'ollama',
        sizeBytes: m.size ?? null,
        meta: m.details ? { details: m.details } : null,
      })).filter(Boolean);
    }
    const list = await api.listModels();
    return (Array.isArray(list) ? list : []).map((m) => toEntry({
      id: m.name || m.id,
      name: m.name || m.id,
      source: 'ollama',
      sizeBytes: m.size ?? null,
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`ollama: ${err?.message || err}`);
  }
}

async function fetchLlamanodeCatalog() {
  const api = window.electronAPI;
  if (typeof api?.listLocalGgufs !== 'function') return [];
  try {
    const res = await api.listLocalGgufs();
    const models = Array.isArray(res?.models) ? res.models : [];
    return models.map((m) => toEntry({
      id: m.id || `gguf:${m.path}`,
      name: m.name || m.path,
      source: 'llamanode',
      sizeBytes: m.sizeBytes ?? null,
      meta: { path: m.path, registeredAt: m.registeredAt, lastUsedAt: m.lastUsedAt },
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`llamanode: ${err?.message || err}`);
  }
}

async function fetchLmStudio() {
  const api = window.electronAPI;
  if (typeof api?.scanLMStudioModels !== 'function') return [];
  try {
    const res = await api.scanLMStudioModels();
    const models = Array.isArray(res?.models) ? res.models : [];
    return models.map((m) => toEntry({
      id: m.id ? `lmstudio:${m.path || m.id}` : `lmstudio:${m.path}`,
      name: m.name || m.filename || (m.path ? m.path.split(/[\\/]/).pop() : 'LM Studio model'),
      source: 'lmstudio',
      sizeBytes: m.size ?? null,
      meta: { path: m.path, filename: m.filename },
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`lmstudio: ${err?.message || err}`);
  }
}

async function fetchNpu() {
  const api = window.electronAPI;
  if (typeof api?.getNpuStatus !== 'function') return { entries: [], status: null };
  try {
    const status = await api.getNpuStatus({ force: false });
    const configured = status?.model || status?.modelPath;
    const entries = [];
    if (configured) {
      entries.push(toEntry({
        id: `npu:${configured}`,
        name: String(configured).split('/').pop().replace(/-ov$/, '').replace(/-fp16$/, ''),
        source: 'npu',
        meta: {
          fullId: configured,
          serverRunning: Boolean(status?.serverRunning),
          device: status?.device || 'NPU',
          precision: status?.precision || null,
        },
      }));
    }
    return { entries: entries.filter(Boolean), status };
  } catch (err) {
    throw new Error(`npu: ${err?.message || err}`);
  }
}

export const createModelCatalogSlice = (set, get) => ({
  // === State ===
  modelCatalog: new Map(),
  modelCatalogSources: SOURCE_STATES(),
  modelCatalogStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  modelCatalogLastHydratedAt: 0,
  modelCatalogLastError: null,
  modelCatalogHydrateInflight: null,
  npuStatus: null,

  // === Actions ===
  hydrateModelCatalog: async ({ force = false, ttlMs = DEFAULT_TTL_MS, sources = null } = {}) => {
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
        runFetch('ollama', fetchOllama, (entries) => results.push(...entries)),
        runFetch('llamanode', fetchLlamanodeCatalog, (entries) => results.push(...entries)),
        runFetch('lmstudio', fetchLmStudio, (entries) => results.push(...entries)),
        runFetch('npu', fetchNpu, ({ entries, status }) => {
          results.push(...entries);
          set({ npuStatus: status });
        }),
      ]);

      const catalog = dedupeCatalog(results);
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
        : SOURCE_STATES(),
    }));
  },

  // Phase 0: watch() is a no-op stub. Phase 1 will wire fs.watch on the
  // LM Studio folder and Ollama pull-progress IPC events.
  watchModelCatalog: () => () => {},
});
