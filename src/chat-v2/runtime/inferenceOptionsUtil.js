const NUMERIC_KEYS = new Set([
  'num_ctx', 'num_predict', 'num_batch', 'num_gpu', 'num_thread',
  'temperature', 'top_p', 'top_k', 'min_p',
  'repeat_penalty', 'frequency_penalty', 'presence_penalty',
]);

const BOOLEAN_KEYS = new Set(['flash_attn']);
const STRING_KEYS = new Set(['kv_cache_type']);

export function cleanInferenceOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || key.startsWith('_') || value == null) continue;
    if (NUMERIC_KEYS.has(key)) {
      const num = Number(value);
      if (Number.isFinite(num)) output[key] = num;
      continue;
    }
    if (BOOLEAN_KEYS.has(key)) {
      output[key] = Boolean(value);
      continue;
    }
    if (STRING_KEYS.has(key)) {
      const str = String(value || '').trim();
      if (str) output[key] = str;
    }
  }
  return output;
}

export function resolveEffectiveContextLength({ modelInfo = null, autoTuneResult = null, fallback = 8192 } = {}) {
  const candidates = [
    modelInfo?.effectiveContextLength,
    modelInfo?.rawContextLength,
    modelInfo?.contextLength,
    autoTuneResult?.contextLength,
    fallback,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }
  }

  return Math.floor(fallback);
}

export function clampInferenceOptionsToModel(options = {}, context = {}) {
  const cleaned = cleanInferenceOptions(options);
  const contextLength = resolveEffectiveContextLength(context);
  if (Number.isFinite(Number(cleaned.num_ctx)) && cleaned.num_ctx > 0) {
    cleaned.num_ctx = Math.min(Math.floor(cleaned.num_ctx), contextLength);
  } else if (contextLength > 0) {
    cleaned.num_ctx = contextLength;
  }
  return {
    options: cleaned,
    effectiveContextLength: contextLength,
  };
}
