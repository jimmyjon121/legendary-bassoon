import { parseModelName } from '../../services/modelOptimizer';

export const SOURCE_LABELS = {
  ollama: 'Ollama',
  llamanode: 'Imported GGUF',
  lmstudio: 'LM Studio',
  npu: 'OpenVINO NPU',
  huggingface: 'HuggingFace',
  unknown: 'Unknown',
};

export const DEVICE_PIN_OPTIONS = [
  { id: '', label: 'Auto' },
  { id: 'ollama-cuda', label: 'Ollama CUDA' },
  { id: 'ollama-cpu', label: 'Ollama CPU' },
  { id: 'llamanode', label: 'llamanode' },
  { id: 'openvino-npu', label: 'OpenVINO NPU' },
  { id: 'openvino-gpu', label: 'OpenVINO GPU' },
  { id: 'openvino-hybrid', label: 'OpenVINO Hybrid' },
  { id: 'llamacpp-vulkan', label: 'llama.cpp Vulkan' },
];

export const SCORE_PRESETS = {
  recommended: { intent: 0.45, fit: 0.2, history: 0.15, speed: 0.15, recency: 0.05, battery: 1 },
  bestForWorkspace: { intent: 0.6, fit: 0.2, history: 0.2, speed: 0, recency: 0, battery: 0.5 },
  recentlyUsed: { intent: 0, fit: 0, history: 0, speed: 0, recency: 1, battery: 0 },
  fitsNow: { intent: 0, fit: 1, history: 0, speed: 0, recency: 0, battery: 0 },
  batteryFriendly: { intent: 0.15, fit: 0.25, history: 0.1, speed: 0.25, recency: 0.05, battery: 1 },
};

const CODE_HINTS = ['coder', 'code', 'starcoder', 'phind', 'wizardcoder', 'granite-code'];
const REASONING_HINTS = ['reason', 'r1', 'qwq', 'thinking', 'math'];
const CREATIVE_HINTS = ['dolphin', 'hermes', 'nous', 'mytho', 'roleplay', 'story', 'creative', 'uncensored', 'abliterated'];
const VISION_HINTS = ['vision', 'llava', 'bakllava', 'moondream', 'pixtral', 'vl'];
const EMBEDDING_HINTS = ['embed', 'embedding', 'bge', 'nomic'];
const MULTILINGUAL_HINTS = ['qwen', 'aya', 'command-r', 'mistral-nemo', 'glm'];

function basename(value = '') {
  const withoutPrefix = String(value || '')
    .replace(/^gguf:/i, '')
    .replace(/^lmstudio:/i, '')
    .replace(/^npu:/i, '');
  const parts = withoutPrefix.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || withoutPrefix;
}

function stripCreator(value = '') {
  const raw = String(value || '');
  if (!raw.includes('/')) return raw;
  const parts = raw.split('/').filter(Boolean);
  return parts[parts.length - 1] || raw;
}

export function normalizeRawModelName(value = '') {
  return stripCreator(basename(value))
    .replace(/\.gguf$/i, '')
    .replace(/-gguf$/i, '')
    .replace(/_gguf$/i, '')
    .replace(/:latest$/i, '')
    .trim();
}

function titleToken(token = '') {
  const lower = String(token || '').toLowerCase();
  const special = {
    ai: 'AI',
    api: 'API',
    bge: 'BGE',
    code: 'Code',
    coder: 'Coder',
    codellama: 'Code Llama',
    dpo: 'DPO',
    fp16: 'FP16',
    gguf: 'GGUF',
    gpu: 'GPU',
    hf: 'HF',
    int4: 'INT4',
    instruct: 'Instruct',
    iq: 'IQ',
    kv: 'KV',
    llama: 'Llama',
    llava: 'LLaVA',
    lm: 'LM',
    moe: 'MoE',
    npu: 'NPU',
    openvino: 'OpenVINO',
    qwen: 'Qwen',
  };
  if (special[lower]) return special[lower];
  if (/^\d+(?:\.\d+)?b$/i.test(token)) return token.toUpperCase();
  if (/^q\d/i.test(token)) return token.toUpperCase();
  if (/^[a-z]\d/i.test(token)) return token.toUpperCase();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : '';
}

export function humanizeModelName(value = '') {
  const normalized = normalizeRawModelName(value)
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.split(' ').filter(Boolean).map(titleToken).join(' ') || String(value || 'Model');
}

function removeVariantTokens(value = '') {
  return String(value || '')
    .replace(/[:._-](latest|main)$/i, '')
    .replace(/[:._-]?\d+(?:[._]\d+)?b(?![a-z])/gi, '')
    .replace(/[._-](instruct|chat|base|it|dpo|sft|reasoning|q\d[^._-]*|iq\d[^._-]*|f16|f32|bf16|fp16|int4|mxfp\d).*$/i, '')
    .replace(/[._-]+$/g, '')
    .trim();
}

function sourceFromValue(source = '') {
  return SOURCE_LABELS[source] ? source : 'unknown';
}

function extractTune(rawName = '') {
  const lower = rawName.toLowerCase();
  if (lower.includes('instruct') || /[-_:]it[-_.:]?/i.test(rawName)) return 'Instruct';
  if (lower.includes('chat')) return 'Chat';
  if (lower.includes('base')) return 'Base';
  if (lower.includes('dpo')) return 'DPO';
  if (lower.includes('sft')) return 'SFT';
  if (lower.includes('reason')) return 'Reasoning';
  return '';
}

function normalizeSize(size) {
  return size ? String(size).toUpperCase() : '';
}

function normalizeQuant(quant) {
  return quant ? String(quant).toUpperCase() : '';
}

function inferCapabilities(rawName, parsed) {
  const lower = `${rawName} ${parsed?.family || ''}`.toLowerCase();
  const caps = new Set();
  if (CODE_HINTS.some((hint) => lower.includes(hint))) caps.add('Code');
  if (REASONING_HINTS.some((hint) => lower.includes(hint))) caps.add('Reasoning');
  if (CREATIVE_HINTS.some((hint) => lower.includes(hint))) caps.add('Creative');
  if (VISION_HINTS.some((hint) => lower.includes(hint))) caps.add('Vision');
  if (EMBEDDING_HINTS.some((hint) => lower.includes(hint))) caps.add('Embedding');
  if (MULTILINGUAL_HINTS.some((hint) => lower.includes(hint))) caps.add('Multilingual');
  if (caps.size === 0 || !caps.has('Embedding')) caps.add('Chat');
  return Array.from(caps);
}

function buildDescription(capabilities, sourceLabel) {
  if (capabilities.includes('Code')) return `Code-focused local model from ${sourceLabel}.`;
  if (capabilities.includes('Reasoning')) return `Reasoning-oriented local model from ${sourceLabel}.`;
  if (capabilities.includes('Vision')) return `Vision-capable local model from ${sourceLabel}.`;
  if (capabilities.includes('Embedding')) return `Embedding/search model from ${sourceLabel}.`;
  if (capabilities.includes('Creative')) return `Creative or roleplay-friendly local model from ${sourceLabel}.`;
  return `General local chat model from ${sourceLabel}.`;
}

export function buildLibraryIndex(libraryRows = []) {
  const byName = new Map();
  const byPath = new Map();
  for (const row of Array.isArray(libraryRows) ? libraryRows : []) {
    if (!row) continue;
    if (row.name) byName.set(String(row.name).toLowerCase(), row);
    if (row.providerId) byName.set(String(row.providerId).toLowerCase(), row);
    if (row.path) byPath.set(String(row.path).toLowerCase(), row);
  }
  return { byName, byPath };
}

function findLibraryMeta(rawId, entry, libraryIndex) {
  const raw = String(rawId || '').toLowerCase();
  const path = String(entry?.meta?.path || entry?.path || '').toLowerCase();
  return libraryIndex.byName.get(raw)
    || libraryIndex.byName.get(String(entry?.name || '').toLowerCase())
    || (path ? libraryIndex.byPath.get(path) : null)
    || null;
}

export function normalizeSelectorModel(entry, options = {}) {
  const source = sourceFromValue(entry?.source || 'unknown');
  const rawId = String(entry?.id || entry?.name || '');
  const rawName = String(entry?.name || rawId || 'model');
  const parsed = parseModelName(rawName);
  const normalizedRaw = normalizeRawModelName(rawName || rawId);
  const baseRaw = rawName.includes(':')
    ? rawName.split(':')[0]
    : removeVariantTokens(normalizedRaw) || normalizedRaw;
  const meta = entry?.meta || {};
  const libraryMeta = findLibraryMeta(rawId, entry, options.libraryIndex || buildLibraryIndex([]));
  const parentModel = meta.parent_model || meta.base_model || meta.parentModel || meta.baseModel || null;
  const params = normalizeSize(meta.parameterSize || meta.params || parsed.size);
  const quant = normalizeQuant(meta.quantizationLevel || meta.quant || parsed.quantization);
  const tune = meta.tune || extractTune(rawName);
  const format = meta.format || (source === 'llamanode' || /\.gguf$/i.test(rawName) ? 'GGUF' : source === 'npu' ? 'OpenVINO' : 'Ollama');
  const sourceLabel = SOURCE_LABELS[source] || SOURCE_LABELS.unknown;
  const familyKey = String(meta.familyKey || baseRaw || parsed.family || normalizedRaw)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '') || rawId.toLowerCase();
  const familyName = meta.familyName || humanizeModelName(baseRaw || parsed.family || normalizedRaw);
  const variantParts = [params, tune, quant, format, sourceLabel].filter(Boolean);
  const variantLabel = variantParts.length ? variantParts.join(' · ') : sourceLabel;
  const variantKey = [params || 'unknown-size', tune || 'default', quant || 'unknown-quant', format || 'runtime', source]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const capabilities = Array.isArray(meta.capabilities) && meta.capabilities.length
    ? meta.capabilities
    : inferCapabilities(rawName, parsed);
  const displayName = libraryMeta?.alias
    || meta.displayName
    || meta.details?.displayName
    || familyName
    || humanizeModelName(rawName)
    || rawName;
  const contextLength = Number(meta.contextLength || meta.details?.context_length || meta.details?.contextLength || 0) || null;
  const description = meta.description || meta.details?.description || buildDescription(capabilities, sourceLabel);
  const caveats = [];
  if (params && parseFloat(params) >= 14) caveats.push('Large model; first token may be slower.');
  if (source === 'npu') caveats.push('Runs through OpenVINO runtime.');
  if (source === 'lmstudio') caveats.push('Will register as a local GGUF before use.');

  return {
    id: rawId,
    rawName: rawName || rawId,
    rawId,
    displayName,
    alias: libraryMeta?.alias || null,
    familyKey,
    familyName,
    baseModel: baseRaw || null,
    parentModel,
    variantKey,
    variantLabel,
    source,
    sourceLabel,
    format,
    params,
    tune,
    quant,
    contextLength,
    capabilities,
    description,
    caveats,
    sizeBytes: entry?.sizeBytes ?? entry?.size ?? null,
    path: entry?.path || meta.path || null,
    meta,
    library: libraryMeta,
    parsed,
  };
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown size';
  const gb = value / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = value / (1024 ** 2);
  return `${Math.max(1, Math.round(mb))} MB`;
}

export function estimateFit(model, contextTokens = 4096, freeVramMB = 0, totalVramMB = 0) {
  const sizeGb = Number(model?.sizeBytes || 0) / (1024 ** 3);
  const params = parseFloat(String(model?.params || '').replace(/[^0-9.]/g, ''));
  const ctx = Math.max(1024, Number(contextTokens || model?.contextLength || 4096));
  const kvGb = Number.isFinite(params) && params > 0 ? (params * ctx) / 120000 : 0;
  const projectedGb = Math.max(0, sizeGb + kvGb);
  const availableGb = Number(freeVramMB || 0) > 0
    ? Number(freeVramMB) / 1024
    : Number(totalVramMB || 0) / 1024;
  if (!availableGb || !projectedGb) {
    return { score: 0.5, label: 'Fit unknown', projectedGb, availableGb, status: 'unknown' };
  }
  if (projectedGb <= availableGb * 0.75) {
    return { score: 1, label: 'Fits comfortably', projectedGb, availableGb, status: 'comfortable' };
  }
  if (projectedGb <= availableGb) {
    return { score: 0.7, label: 'Tight fit', projectedGb, availableGb, status: 'tight' };
  }
  if (sizeGb <= availableGb) {
    return { score: 0.35, label: 'May offload', projectedGb, availableGb, status: 'offload' };
  }
  return { score: 0, label: 'Over VRAM', projectedGb, availableGb, status: 'blocked' };
}

function recencyScore(timestamp) {
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  if (!Number.isFinite(time) || time <= 0) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86400000);
  return Math.max(0, 1 - (ageDays / 30));
}

function intentScore(model, workspace = 'casual') {
  const caps = new Set((model?.capabilities || []).map((cap) => String(cap).toLowerCase()));
  if (workspace === 'code') return caps.has('code') ? 1 : caps.has('reasoning') ? 0.65 : 0.35;
  if (workspace === 'research') return caps.has('reasoning') || caps.has('code') ? 1 : caps.has('chat') ? 0.55 : 0.3;
  if (workspace === 'nsfw') return caps.has('creative') ? 1 : caps.has('chat') ? 0.55 : 0.35;
  return caps.has('chat') ? 0.8 : 0.5;
}

function historyScore(outcomes) {
  const success = Number(outcomes?.successCount || 0);
  const failed = Number(outcomes?.failureCount || 0);
  const total = success + failed;
  if (total <= 0) return 0.5;
  return Math.max(0, Math.min(1, success / total));
}

function speedScore(outcomes) {
  const tps = Number(outcomes?.avgTokensPerSecond || outcomes?.tokensPerSecond || 0);
  const ttft = Number(outcomes?.avgFirstTokenMs || outcomes?.firstTokenMs || 0);
  const tpsScore = tps > 0 ? Math.min(1, tps / 80) : 0.5;
  const ttftScore = ttft > 0 ? 1 - Math.min(1, ttft / 2500) : 0.5;
  return (tpsScore * 0.7) + (ttftScore * 0.3);
}

export function scoreModel(model, options = {}) {
  const preset = SCORE_PRESETS[options.preset || 'recommended'] || SCORE_PRESETS.recommended;
  const insights = options.insights?.[model.id] || {};
  const outcomes = insights.outcomeSummary || insights.lastKnownGood || {};
  const fit = model.fit || estimateFit(model, options.contextTokens, options.freeVramMB, options.totalVramMB);
  const recency = recencyScore(model.library?.lastUsed || model.meta?.lastUsedAt || outcomes.lastSuccessAt || outcomes.createdAt);
  const params = parseFloat(String(model.params || '').replace(/[^0-9.]/g, ''));
  const batteryPenalty = options.onBattery && Number.isFinite(params) && params >= 14 ? 0.2 : 0;
  const raw =
    (intentScore(model, options.workspace) * preset.intent)
    + (fit.score * preset.fit)
    + (historyScore(outcomes) * preset.history)
    + (speedScore(outcomes) * preset.speed)
    + (recency * preset.recency)
    - (batteryPenalty * (preset.battery || 0));
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

export function groupModels(models = []) {
  const map = new Map();
  for (const model of models) {
    const key = model.familyKey || model.id;
    const existing = map.get(key) || {
      key,
      familyName: model.familyName || model.displayName,
      parentModel: model.parentModel,
      description: model.description,
      capabilities: new Set(),
      variants: [],
      bestScore: 0,
    };
    for (const cap of model.capabilities || []) existing.capabilities.add(cap);
    existing.variants.push(model);
    existing.bestScore = Math.max(existing.bestScore, Number(model.score || 0));
    map.set(key, existing);
  }
  return Array.from(map.values()).map((group) => ({
    ...group,
    capabilities: Array.from(group.capabilities),
    variants: group.variants.sort((a, b) => (b.score || 0) - (a.score || 0)),
  })).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
}

export function buildSmartGroups(models = []) {
  const installed = models.filter((model) => ['ollama', 'llamanode', 'lmstudio', 'npu'].includes(model.source));
  const byScore = [...models].sort((a, b) => (b.score || 0) - (a.score || 0));
  const groups = [
    { id: 'recommended', title: 'Suggested now', models: byScore.slice(0, 10) },
    { id: 'installed', title: 'Installed catalogue', models: installed.slice(0, 10) },
    { id: 'fits', title: 'Fits comfortably now', models: models.filter((model) => model.fit?.status === 'comfortable').slice(0, 10) },
    { id: 'code', title: 'Code and agentic work', models: models.filter((model) => model.capabilities?.includes('Code')).slice(0, 10) },
    { id: 'npu', title: 'NPU / OpenVINO', models: models.filter((model) => model.source === 'npu').slice(0, 10) },
    { id: 'big', title: 'Big models', models: models.filter((model) => parseFloat(String(model.params || '').replace(/[^0-9.]/g, '')) >= 14).slice(0, 10) },
  ];
  return groups.filter((group) => group.models.length > 0).slice(0, 6);
}

export function hasEnoughSuccessfulOutcomes(insights = {}) {
  const count = Object.values(insights || {}).reduce((total, insight) => (
    total + Number(insight?.outcomeSummary?.successCount || 0)
  ), 0);
  return count >= 3;
}
