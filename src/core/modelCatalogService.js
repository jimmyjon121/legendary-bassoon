import { MODEL_CATALOG_SOURCES } from './types';

export const MODEL_CATALOG_TTL_MS = 30_000;

export function createModelCatalogSourceStates() {
  return {
    [MODEL_CATALOG_SOURCES.OLLAMA]: { status: 'idle', error: null, fetchedAt: 0 },
    [MODEL_CATALOG_SOURCES.LLAMANODE]: { status: 'idle', error: null, fetchedAt: 0 },
    [MODEL_CATALOG_SOURCES.LM_STUDIO]: { status: 'idle', error: null, fetchedAt: 0 },
    [MODEL_CATALOG_SOURCES.NPU]: { status: 'idle', error: null, fetchedAt: 0 },
  };
}

export function toModelCatalogEntry({ id, name, source, sizeBytes = null, meta = null }) {
  if (!id) return null;
  return {
    id: String(id),
    name: String(name || id),
    source,
    sizeBytes,
    meta: meta || null,
  };
}

export function dedupeModelCatalog(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    const existing = map.get(entry.id);
    if (!existing) {
      map.set(entry.id, entry);
      continue;
    }
    map.set(entry.id, {
      ...existing,
      sizeBytes: existing.sizeBytes ?? entry.sizeBytes ?? null,
      meta: existing.meta || entry.meta || null,
      sources: Array.from(new Set([...(existing.sources || [existing.source]), entry.source])),
    });
  }
  return map;
}

export function catalogEntryHasAnySource(entry, sourceSet) {
  if (!entry || !sourceSet) return false;
  const sources = Array.isArray(entry.sources) && entry.sources.length > 0
    ? entry.sources
    : [entry.source];
  return sources.some((source) => sourceSet.has(source));
}

export async function fetchModelCatalogSource(source, api = window.electronAPI) {
  switch (source) {
    case MODEL_CATALOG_SOURCES.OLLAMA:
      return fetchOllamaModels(api);
    case MODEL_CATALOG_SOURCES.LLAMANODE:
      return fetchLlamanodeModels(api);
    case MODEL_CATALOG_SOURCES.LM_STUDIO:
      return fetchLmStudioModels(api);
    case MODEL_CATALOG_SOURCES.NPU:
      return fetchNpuModels(api);
    default:
      return [];
  }
}

async function fetchOllamaModels(api) {
  if (!api?.refreshModels && !api?.listModels) return [];
  try {
    if (typeof api.refreshModels === 'function') {
      const res = await api.refreshModels();
      const list = Array.isArray(res?.models) ? res.models : Array.isArray(res) ? res : [];
      return list.map((m) => toModelCatalogEntry({
        id: m.name || m.id,
        name: m.name || m.id,
        source: MODEL_CATALOG_SOURCES.OLLAMA,
        sizeBytes: m.size ?? null,
        meta: m.details ? { details: m.details } : null,
      })).filter(Boolean);
    }
    const list = await api.listModels();
    return (Array.isArray(list) ? list : []).map((m) => toModelCatalogEntry({
      id: m.name || m.id,
      name: m.name || m.id,
      source: MODEL_CATALOG_SOURCES.OLLAMA,
      sizeBytes: m.size ?? null,
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`ollama: ${err?.message || err}`);
  }
}

async function fetchLlamanodeModels(api) {
  if (typeof api?.listLocalGgufs !== 'function') return [];
  try {
    const res = await api.listLocalGgufs();
    const models = Array.isArray(res?.models) ? res.models : [];
    return models.map((m) => toModelCatalogEntry({
      id: m.id || `gguf:${m.path}`,
      name: m.name || m.path,
      source: MODEL_CATALOG_SOURCES.LLAMANODE,
      sizeBytes: m.sizeBytes ?? null,
      meta: { path: m.path, registeredAt: m.registeredAt, lastUsedAt: m.lastUsedAt },
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`llamanode: ${err?.message || err}`);
  }
}

async function fetchLmStudioModels(api) {
  if (typeof api?.scanLMStudioModels !== 'function') return [];
  try {
    const res = await api.scanLMStudioModels();
    const models = Array.isArray(res?.models) ? res.models : [];
    return models.map((m) => toModelCatalogEntry({
      id: m.id ? `lmstudio:${m.path || m.id}` : `lmstudio:${m.path}`,
      name: m.name || m.filename || (m.path ? m.path.split(/[\\/]/).pop() : 'LM Studio model'),
      source: MODEL_CATALOG_SOURCES.LM_STUDIO,
      sizeBytes: m.size ?? null,
      meta: { path: m.path, filename: m.filename },
    })).filter(Boolean);
  } catch (err) {
    throw new Error(`lmstudio: ${err?.message || err}`);
  }
}

async function fetchNpuModels(api) {
  if (typeof api?.getNpuStatus !== 'function') return { entries: [], status: null };
  try {
    const status = await api.getNpuStatus({ force: false });
    const configured = status?.model || status?.modelPath;
    const entries = [];
    if (configured) {
      entries.push(toModelCatalogEntry({
        id: `npu:${configured}`,
        name: String(configured).split('/').pop().replace(/-ov$/, '').replace(/-fp16$/, ''),
        source: MODEL_CATALOG_SOURCES.NPU,
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
