/**
 * Model Experience Autopilot
 *
 * Main-process resolver for local-first model defaults, task intent, advanced
 * controls, and backend preference hints. It deliberately returns a plan plus
 * trace metadata; only effectiveOptions should be sent to model backends.
 */

const ALLOWED_BACKENDS = new Set([
  'ollama-cuda',
  'ollama-cpu',
  'llamanode',
  'openvino-npu',
  'openvino-gpu',
  'openvino-hybrid',
  'llamacpp-vulkan',
]);

const ALLOWED_TASK_INTENTS = new Set([
  'auto',
  'chat',
  'code',
  'reasoning',
  'creative',
  'research',
]);

const ALLOWED_ADVANCED_KEYS = new Set([
  'temperature',
  'top_p',
  'top_k',
  'repeat_penalty',
  'num_predict',
  'num_ctx',
  'num_batch',
  'num_gpu',
  'num_thread',
  'kv_cache_type',
  'flash_attn',
  'softBackendPreference',
]);

const TASK_DEFAULTS = {
  chat: {
    temperature: 0.6,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.08,
    num_ctx: 8192,
    num_predict: 1024,
    num_batch: 160,
    num_gpu: -1,
    flash_attn: true,
    kv_cache_type: 'q8_0',
  },
  code: {
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 16384,
    num_predict: 1536,
    num_batch: 128,
    num_gpu: -1,
    flash_attn: true,
    kv_cache_type: 'q8_0',
  },
  reasoning: {
    temperature: 0.55,
    top_p: 0.95,
    top_k: 40,
    repeat_penalty: 1.0,
    num_ctx: 16384,
    num_predict: 2048,
    num_batch: 128,
    num_gpu: -1,
    flash_attn: true,
    kv_cache_type: 'q8_0',
  },
  creative: {
    temperature: 0.85,
    top_p: 0.95,
    top_k: 60,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 1536,
    num_batch: 160,
    num_gpu: -1,
    flash_attn: true,
    kv_cache_type: 'q8_0',
  },
  research: {
    temperature: 0.35,
    top_p: 0.82,
    top_k: 30,
    repeat_penalty: 1.12,
    num_ctx: 16384,
    num_predict: 1536,
    num_batch: 128,
    num_gpu: -1,
    flash_attn: true,
    kv_cache_type: 'q8_0',
  },
};

const NUMERIC_LIMITS = {
  temperature: { min: 0, max: 2, fallback: 0.6 },
  top_p: { min: 0, max: 1, fallback: 0.9 },
  top_k: { min: 1, max: 2000, fallback: 40, integer: true },
  repeat_penalty: { min: 0.8, max: 2, fallback: 1.08 },
  num_predict: { min: 16, max: 8192, fallback: 1024, integer: true },
  num_ctx: { min: 256, max: 262144, fallback: 8192, integer: true },
  num_batch: { min: 16, max: 2048, fallback: 128, integer: true },
  num_gpu: { min: -1, max: 999, fallback: -1, integer: true },
  num_thread: { min: 1, max: 256, fallback: 8, integer: true },
};

const STRING_LIMITS = {
  kv_cache_type: new Set(['q8_0', 'q4_0', 'q4_1', 'f16', 'fp16', 'q5_0', 'q5_1']),
};

function clampNumber(value, limits) {
  const numeric = Number(value);
  const fallback = limits?.fallback ?? 0;
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(limits.max, Math.max(limits.min, numeric));
  return limits.integer ? Math.round(clamped) : Number(clamped.toFixed(4));
}

function normalizeTaskIntent(value = 'auto') {
  const normalized = String(value || 'auto').trim().toLowerCase();
  return ALLOWED_TASK_INTENTS.has(normalized) ? normalized : 'auto';
}

function normalizeBackend(value = '') {
  const normalized = String(value || '').trim();
  return ALLOWED_BACKENDS.has(normalized) ? normalized : null;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeAdvancedOptions(input = {}) {
  const raw = parseJsonObject(input);
  const output = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_ADVANCED_KEYS.has(key) || value === undefined || value === null || value === '') {
      continue;
    }

    if (NUMERIC_LIMITS[key]) {
      output[key] = clampNumber(value, NUMERIC_LIMITS[key]);
      continue;
    }

    if (key === 'flash_attn') {
      output.flash_attn = Boolean(value);
      continue;
    }

    if (key === 'kv_cache_type') {
      const normalized = String(value || '').trim().toLowerCase();
      if (STRING_LIMITS.kv_cache_type.has(normalized)) {
        output.kv_cache_type = normalized;
      }
      continue;
    }

    if (key === 'softBackendPreference') {
      const backend = normalizeBackend(value);
      if (backend) output.softBackendPreference = backend;
    }
  }

  return output;
}

function inferFamily(modelName = '', modelInfo = null, profile = null) {
  const fromProfile = String(profile?.model?.family || profile?.family || '').trim().toLowerCase();
  if (fromProfile) return fromProfile;

  const fromInfo = String(modelInfo?.family || modelInfo?.modelFamily || '').trim().toLowerCase();
  if (fromInfo) return fromInfo;

  const lower = String(modelName || '').toLowerCase();
  if (lower.startsWith('npu:')) return 'openvino';
  if (lower.startsWith('gguf:') || lower.includes('.gguf')) return 'gguf';
  if (lower.includes('deepseek-coder')) return 'deepseek-coder';
  if (lower.includes('deepseek-r1')) return 'deepseek-r1';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('llama')) return 'llama';
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
  if (lower.includes('gemma')) return 'gemma';
  if (lower.includes('phi')) return 'phi';
  if (lower.includes('starcoder')) return 'starcoder';
  if (lower.includes('code')) return 'code';
  return 'chat';
}

function parseParamBillions(value = '') {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferParamBillions(modelName = '', modelInfo = null, profile = null) {
  const candidates = [
    modelInfo?.parameterSize,
    modelInfo?.parameter_size,
    modelInfo?.paramCount,
    profile?.model?.paramCount,
    modelName,
  ];
  for (const candidate of candidates) {
    const parsed = parseParamBillions(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function inferQuantization(modelName = '', modelInfo = null, profile = null) {
  const candidates = [
    modelInfo?.quantizationLevel,
    modelInfo?.quantization,
    profile?.model?.quantization,
    modelName,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!text) continue;
    const explicit = text.match(/\b(Q[2-8](?:_[A-Z0-9]+){0,2}|IQ[1-4]_[A-Z0-9]+|F16|BF16|FP16|FP8|Q8)\b/i);
    if (explicit) return explicit[1].toUpperCase();
  }
  return 'unknown';
}

function resolveModelContextLimit(modelName = '', modelInfo = null, profile = null) {
  const candidates = [
    modelInfo?.effectiveContextLength,
    modelInfo?.rawContextLength,
    modelInfo?.contextLength,
    modelInfo?.context_length,
    profile?.inference?.num_ctx,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  }

  const lower = String(modelName || '').toLowerCase();
  if (lower.includes('llama3.1') || lower.includes('llama3.2') || lower.includes('qwen2.5')) return 131072;
  if (lower.includes('deepseek-r1') || lower.includes('qwq')) return 131072;
  if (lower.includes('mistral') || lower.includes('mixtral')) return 32768;
  if (lower.includes('deepseek-coder') || lower.includes('starcoder')) return 16384;
  return 8192;
}

function inferTaskIntent({ requested = 'auto', workspace = 'casual', prompt = '', family = 'chat', controls = {} } = {}) {
  const explicit = normalizeTaskIntent(requested);
  if (explicit !== 'auto') return explicit;

  const workspaceType = String(workspace || '').trim().toLowerCase();
  if (workspaceType === 'code') return 'code';
  if (workspaceType === 'research' || controls.webSearchEnabled === true) return 'research';
  if (workspaceType === 'creative') return 'creative';

  const lowerFamily = String(family || '').toLowerCase();
  if (lowerFamily.includes('coder') || lowerFamily.includes('code') || lowerFamily.includes('starcoder')) return 'code';
  if (lowerFamily.includes('r1') || lowerFamily.includes('reason') || lowerFamily.includes('qwq')) return 'reasoning';

  const text = String(prompt || '').trim();
  if (text) {
    if (/```|traceback|exception|compile|refactor|function|class|typescript|javascript|python|rust|sql|api/i.test(text)) {
      return 'code';
    }
    if (/\b(research|cite|source|verify|evidence|latest|current|today|compare sources)\b/i.test(text)) {
      return 'research';
    }
    if (/\b(reason|prove|derive|think through|step by step|math|logic)\b/i.test(text)) {
      return 'reasoning';
    }
    if (/\b(story|brainstorm|creative|rewrite|tone|character|scene)\b/i.test(text)) {
      return 'creative';
    }
  }

  return 'chat';
}

function applyProfileHints(options, profile, trace) {
  const inference = profile?.inference && typeof profile.inference === 'object' ? profile.inference : null;
  if (!inference) return options;
  const next = { ...options };
  for (const key of ['temperature', 'top_p', 'top_k', 'repeat_penalty', 'num_ctx', 'num_predict', 'num_batch', 'num_gpu']) {
    if (inference[key] === undefined || inference[key] === null || !NUMERIC_LIMITS[key]) continue;
    next[key] = clampNumber(inference[key], NUMERIC_LIMITS[key]);
  }
  if (inference.flash_attn !== undefined) next.flash_attn = Boolean(inference.flash_attn);
  if (inference.kv_cache_type) {
    const kv = String(inference.kv_cache_type).trim().toLowerCase();
    if (STRING_LIMITS.kv_cache_type.has(kv)) next.kv_cache_type = kv;
  }
  trace.push('profile');
  return next;
}

function applyModelScale(options, paramBillions, quantization, trace) {
  const next = { ...options };
  const size = Number(paramBillions);
  if (Number.isFinite(size) && size >= 30) {
    next.num_ctx = Math.min(Number(next.num_ctx) || 4096, 4096);
    next.num_batch = Math.min(Number(next.num_batch) || 64, 64);
    next.num_predict = Math.min(Number(next.num_predict) || 1024, 1536);
    trace.push('large-model-guardrail');
  } else if (Number.isFinite(size) && size >= 13) {
    next.num_batch = Math.min(Number(next.num_batch) || 128, 128);
    trace.push('mid-model-guardrail');
  }

  const quant = String(quantization || '').toUpperCase();
  if (/^(Q2|IQ1|IQ2)/.test(quant)) {
    next.temperature = Math.min(Number(next.temperature) || 0.6, 0.55);
    next.top_p = Math.min(Number(next.top_p) || 0.9, 0.88);
    trace.push('low-bit-quant-guardrail');
  }
  return next;
}

function applyHardwareGuardrails(options, { runtimeState = null, performanceProfile = 'balanced', autoTuneResult = null } = {}, trace) {
  const next = { ...options };
  const profile = String(performanceProfile || runtimeState?.profile || 'balanced').toLowerCase();

  if (autoTuneResult && typeof autoTuneResult === 'object') {
    if (Number.isFinite(Number(autoTuneResult.contextLength)) && autoTuneResult.contextLength > 0) {
      next.num_ctx = Math.min(Number(next.num_ctx) || autoTuneResult.contextLength, Number(autoTuneResult.contextLength));
    }
    if (Number.isFinite(Number(autoTuneResult.batchSize)) && autoTuneResult.batchSize > 0) {
      next.num_batch = Math.min(Number(next.num_batch) || autoTuneResult.batchSize, Number(autoTuneResult.batchSize));
    }
    if (autoTuneResult.gpuLayers === 'all' || autoTuneResult.gpuLayers === 'most') {
      next.num_gpu = -1;
    } else if (Number.isFinite(Number(autoTuneResult.gpuLayers))) {
      next.num_gpu = Math.round(Number(autoTuneResult.gpuLayers));
    }
    if (autoTuneResult.kvCachePrecision) next.kv_cache_type = String(autoTuneResult.kvCachePrecision).toLowerCase();
    if (autoTuneResult.flashAttention) next.flash_attn = true;
    trace.push('auto-tune');
  }

  if (profile === 'efficiency' || profile === 'laptop') {
    next.num_ctx = Math.min(Number(next.num_ctx) || 4096, profile === 'laptop' ? 8192 : 12288);
    next.num_predict = Math.min(Number(next.num_predict) || 768, profile === 'laptop' ? 768 : 1024);
    next.num_batch = Math.min(Number(next.num_batch) || 96, 128);
    trace.push(`${profile}-profile-guardrail`);
  }

  const memory = runtimeState?.deviceUtilization?.memory || runtimeState?.memory || null;
  const availableGb = Number(memory?.availableGB ?? memory?.available ?? 0);
  const usagePercent = Number(memory?.usagePercent ?? 0);
  if ((Number.isFinite(availableGb) && availableGb > 0 && availableGb < 4) || usagePercent > 90) {
    next.num_ctx = Math.min(Number(next.num_ctx) || 4096, 4096);
    next.num_batch = Math.min(Number(next.num_batch) || 64, 96);
    next.kv_cache_type = 'q4_0';
    trace.push('memory-pressure-guardrail');
  }

  return next;
}

function applyPreset(options, preset = null, trace, warnings) {
  if (!preset || typeof preset !== 'object') return { options, taskIntent: 'auto', forceBackend: null, systemPrompt: '' };
  let next = { ...options };
  if (Number.isFinite(Number(preset.temperature))) next.temperature = clampNumber(preset.temperature, NUMERIC_LIMITS.temperature);
  if (Number.isFinite(Number(preset.top_p))) next.top_p = clampNumber(preset.top_p, NUMERIC_LIMITS.top_p);
  if (Number.isFinite(Number(preset.top_k))) next.top_k = clampNumber(preset.top_k, NUMERIC_LIMITS.top_k);
  if (Number.isFinite(Number(preset.context_length)) && Number(preset.context_length) > 0) {
    next.num_ctx = clampNumber(preset.context_length, NUMERIC_LIMITS.num_ctx);
  }

  const advanced = sanitizeAdvancedOptions(preset.advanced_options || {});
  const { softBackendPreference, ...advancedOptions } = advanced;
  next = { ...next, ...advancedOptions };

  const forceBackend = normalizeBackend(preset.device_pin);
  const taskIntent = normalizeTaskIntent(preset.task_intent || 'auto');
  const systemPrompt = typeof preset.system_prompt === 'string' ? preset.system_prompt.trim().slice(0, 8000) : '';
  trace.push('stored-preset');
  if (softBackendPreference && !forceBackend) {
    warnings.push('Preset soft backend preference is advisory and may fall back.');
  }
  return { options: next, taskIntent, forceBackend, systemPrompt, softBackendPreference };
}

function applySession(options, session = {}, trace) {
  let next = { ...options };
  const tuningMode = String(session?.tuningMode || 'auto').trim().toLowerCase() === 'advanced'
    ? 'advanced'
    : 'auto';

  if (Number.isFinite(Number(session?.contextLengthTokens)) && Number(session.contextLengthTokens) > 0) {
    next.num_ctx = clampNumber(session.contextLengthTokens, NUMERIC_LIMITS.num_ctx);
    trace.push('session-context');
  }

  const forceBackend = normalizeBackend(session?.backendOverride);
  const sessionTaskIntent = normalizeTaskIntent(session?.taskIntent || 'auto');
  const advanced = tuningMode === 'advanced'
    ? sanitizeAdvancedOptions(session?.advancedOverrides || {})
    : {};
  const softBackendPreference = advanced.softBackendPreference || null;
  delete advanced.softBackendPreference;
  if (Object.keys(advanced).length > 0) {
    next = { ...next, ...advanced };
    trace.push('session-advanced');
  }
  if (forceBackend) trace.push('session-force-backend');

  return {
    options: next,
    forceBackend,
    taskIntent: sessionTaskIntent,
    softBackendPreference,
    tuningMode,
  };
}

function normalizeLastKnownGood(input = null) {
  if (!input || typeof input !== 'object') return null;
  const backend = normalizeBackend(input.backend);
  const options = parseJsonObject(input.options);
  const context = Number(input.context ?? options.num_ctx);
  const batch = Number(input.batch ?? options.num_batch);
  const numPredict = Number(input.numPredict ?? input.num_predict ?? options.num_predict);
  const kvCacheType = String(input.kvCacheType || input.kv_cache_type || options.kv_cache_type || '').trim().toLowerCase();
  return {
    backend,
    context: Number.isFinite(context) && context > 0 ? Math.floor(context) : null,
    batch: Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : null,
    numPredict: Number.isFinite(numPredict) && numPredict > 0 ? Math.floor(numPredict) : null,
    kvCacheType: STRING_LIMITS.kv_cache_type.has(kvCacheType) ? kvCacheType : null,
    createdAt: input.createdAt || input.created_at || null,
  };
}

function hasPresetOption(preset = null, key = '') {
  if (!preset || typeof preset !== 'object') return false;
  if (key === 'num_ctx' && Number.isFinite(Number(preset.context_length)) && Number(preset.context_length) > 0) return true;
  const advanced = parseJsonObject(preset.advanced_options || {});
  return Object.prototype.hasOwnProperty.call(advanced, key);
}

function hasSessionOption(session = {}, key = '') {
  if (key === 'num_ctx' && Number.isFinite(Number(session?.contextLengthTokens)) && Number(session.contextLengthTokens) > 0) return true;
  if (String(session?.tuningMode || 'auto').trim().toLowerCase() !== 'advanced') return false;
  const advanced = parseJsonObject(session?.advancedOverrides || {});
  return Object.prototype.hasOwnProperty.call(advanced, key);
}

function applyLastKnownGoodHints(options, lastKnownGood = null, { session = {}, preset = null } = {}, trace, warnings) {
  const hint = normalizeLastKnownGood(lastKnownGood);
  if (!hint) return { options, hint: null };
  const next = { ...options };
  let applied = false;

  if (hint.context && !hasSessionOption(session, 'num_ctx') && !hasPresetOption(preset, 'num_ctx')) {
    next.num_ctx = Math.min(Number(next.num_ctx) || hint.context, hint.context);
    applied = true;
  }

  if (hint.batch && !hasSessionOption(session, 'num_batch') && !hasPresetOption(preset, 'num_batch')) {
    next.num_batch = Math.min(Number(next.num_batch) || hint.batch, hint.batch);
    applied = true;
  }

  if (hint.numPredict && !hasSessionOption(session, 'num_predict') && !hasPresetOption(preset, 'num_predict')) {
    next.num_predict = Math.min(Number(next.num_predict) || hint.numPredict, hint.numPredict);
    applied = true;
  }

  if (hint.kvCacheType && !hasSessionOption(session, 'kv_cache_type') && !hasPresetOption(preset, 'kv_cache_type')) {
    next.kv_cache_type = hint.kvCacheType;
    applied = true;
  }

  if (applied) {
    trace.push('last-good-soft-hint');
    warnings.push('Last-known-good settings were used as advisory stability hints.');
  }

  return { options: next, hint };
}

function clampEffectiveOptions(options, contextLimit, trace) {
  const next = {};
  for (const [key, value] of Object.entries(options || {})) {
    if (NUMERIC_LIMITS[key]) {
      next[key] = clampNumber(value, NUMERIC_LIMITS[key]);
    } else if (key === 'flash_attn') {
      next.flash_attn = Boolean(value);
    } else if (key === 'kv_cache_type') {
      const kv = String(value || '').trim().toLowerCase();
      if (STRING_LIMITS.kv_cache_type.has(kv)) next.kv_cache_type = kv;
    }
  }

  const limit = Number(contextLimit);
  if (Number.isFinite(limit) && limit > 0) {
    const requested = Number(next.num_ctx);
    if (Number.isFinite(requested) && requested > limit) {
      next.num_ctx = Math.floor(limit);
      trace.push('context-clamped-to-model');
    } else if (!Number.isFinite(requested) || requested <= 0) {
      next.num_ctx = Math.floor(limit);
      trace.push('context-filled-from-model');
    }
  }

  return next;
}

function chooseSoftBackend({ explicitBackend, modelName = '', family = '', paramBillions = null, preferred = null } = {}) {
  if (explicitBackend) return null;
  const requested = normalizeBackend(preferred);
  if (requested) return requested;

  const lower = String(modelName || '').toLowerCase();
  if (lower.startsWith('gguf:') || lower.includes('.gguf') || String(family).toLowerCase() === 'gguf') {
    return 'llamanode';
  }
  if (lower.startsWith('npu:') || String(family).toLowerCase() === 'openvino') {
    return 'openvino-npu';
  }
  const size = Number(paramBillions);
  if (Number.isFinite(size) && size <= 3) return 'ollama-cuda';
  if (Number.isFinite(size) && size >= 30) return 'ollama-cuda';
  return 'ollama-cuda';
}

function buildPlanSummary(plan) {
  return {
    taskIntent: plan.taskIntent,
    tuningMode: plan.tuningMode,
    modelFamily: plan.profile?.family || 'chat',
    context: plan.effectiveOptions?.num_ctx || null,
    softBackendPreference: plan.softBackendPreference || null,
    explicitBackendPin: plan.explicitBackendPin || null,
    warningCount: Array.isArray(plan.warnings) ? plan.warnings.length : 0,
  };
}

function resolveModelExperiencePlan(payload = {}) {
  const warnings = [];
  const reasons = [];
  const overrideTrace = [];
  const model = String(payload?.model || '').trim();
  const workspace = String(payload?.workspace || 'casual').trim() || 'casual';
  const controls = payload?.controls && typeof payload.controls === 'object' ? payload.controls : {};
  const session = payload?.session && typeof payload.session === 'object' ? payload.session : {};
  const preset = payload?.preset && typeof payload.preset === 'object' ? payload.preset : null;
  const profileInput = payload?.profile && typeof payload.profile === 'object' ? payload.profile : null;
  const modelInfo = payload?.modelInfo && typeof payload.modelInfo === 'object' ? payload.modelInfo : null;
  const autoTuneResult = payload?.autoTuneResult && typeof payload.autoTuneResult === 'object' ? payload.autoTuneResult : null;
  const runtimeState = payload?.runtimeState && typeof payload.runtimeState === 'object' ? payload.runtimeState : null;
  const lastKnownGood = payload?.lastKnownGood && typeof payload.lastKnownGood === 'object' ? payload.lastKnownGood : null;
  const performanceProfile = String(payload?.performanceProfile || runtimeState?.profile || 'balanced').trim() || 'balanced';

  if (!model) {
    return {
      success: false,
      error: 'Model is required',
      profile: null,
      plan: null,
      warnings: ['Model is required'],
      reasons: ['missing-model'],
    };
  }

  const family = inferFamily(model, modelInfo, profileInput);
  const paramBillions = inferParamBillions(model, modelInfo, profileInput);
  const quantization = inferQuantization(model, modelInfo, profileInput);
  const contextLimit = resolveModelContextLimit(model, modelInfo, profileInput);
  const explicitTaskFromPreset = preset ? normalizeTaskIntent(preset.task_intent || 'auto') : 'auto';
  const explicitTaskFromSession = normalizeTaskIntent(session?.taskIntent || 'auto');
  const requestedTaskIntent = explicitTaskFromSession !== 'auto'
    ? explicitTaskFromSession
    : explicitTaskFromPreset;
  const taskIntent = inferTaskIntent({
    requested: requestedTaskIntent,
    workspace,
    prompt: payload?.prompt || '',
    family,
    controls,
  });

  reasons.push(`task:${taskIntent}`);
  if (controls?.webSearchEnabled === true) reasons.push('web-search-enabled');
  if (controls?.thinkLonger === true) reasons.push('think-longer');

  let effectiveOptions = {
    ...TASK_DEFAULTS.chat,
    ...(TASK_DEFAULTS[taskIntent] || TASK_DEFAULTS.chat),
  };
  overrideTrace.push('base-defaults');

  effectiveOptions = applyProfileHints(effectiveOptions, profileInput, overrideTrace);
  effectiveOptions = applyModelScale(effectiveOptions, paramBillions, quantization, overrideTrace);
  effectiveOptions = applyHardwareGuardrails(effectiveOptions, {
    runtimeState,
    performanceProfile,
    autoTuneResult,
  }, overrideTrace);

  const presetResult = applyPreset(effectiveOptions, preset, overrideTrace, warnings);
  effectiveOptions = presetResult.options;

  const sessionResult = applySession(effectiveOptions, session, overrideTrace);
  effectiveOptions = sessionResult.options;

  const lastGoodResult = applyLastKnownGoodHints(effectiveOptions, lastKnownGood, { session, preset }, overrideTrace, warnings);
  effectiveOptions = lastGoodResult.options;

  if (controls?.thinkLonger === true) {
    effectiveOptions.num_predict = Math.min(8192, Math.max(Number(effectiveOptions.num_predict) || 1024, 2048));
    effectiveOptions.num_ctx = Math.min(contextLimit, Math.max(Number(effectiveOptions.num_ctx) || 8192, 16384));
    reasons.push('think-longer-expanded-output');
  }

  effectiveOptions = clampEffectiveOptions(effectiveOptions, contextLimit, overrideTrace);

  const explicitBackendPin = sessionResult.forceBackend || presetResult.forceBackend || null;
  const softBackendPreference = chooseSoftBackend({
    explicitBackend: explicitBackendPin,
    modelName: model,
    family,
    paramBillions,
    preferred: sessionResult.softBackendPreference || presetResult.softBackendPreference || lastGoodResult.hint?.backend,
  });
  if (!explicitBackendPin && lastGoodResult.hint?.backend && softBackendPreference === lastGoodResult.hint.backend) {
    overrideTrace.push('last-good-backend-soft-hint');
  }

  const profile = {
    model,
    family,
    paramBillions,
    quantization,
    contextLimit,
    workspace,
    primaryStrength: taskIntent,
  };

  const plan = {
    id: `mexp-${Date.now().toString(36)}`,
    model,
    workspace,
    taskIntent,
    tuningMode: sessionResult.tuningMode || 'auto',
    profile,
    effectiveOptions,
    systemPrompt: presetResult.systemPrompt || '',
    softBackendPreference,
    explicitBackendPin,
    lastGoodHint: lastGoodResult.hint
      ? {
        backend: lastGoodResult.hint.backend,
        context: lastGoodResult.hint.context,
        batch: lastGoodResult.hint.batch,
        kvCacheType: lastGoodResult.hint.kvCacheType,
        numPredict: lastGoodResult.hint.numPredict,
        createdAt: lastGoodResult.hint.createdAt,
      }
      : null,
    warnings,
    reasons,
    overrideTrace,
    clampReasons: overrideTrace.filter((item) => item.includes('clamp') || item.includes('guardrail')),
    source: 'model-experience-autopilot',
    createdAt: Date.now(),
  };

  plan.summary = buildPlanSummary(plan);

  return {
    success: true,
    profile,
    plan,
    warnings,
    reasons,
  };
}

module.exports = {
  ALLOWED_ADVANCED_KEYS,
  ALLOWED_BACKENDS,
  ALLOWED_TASK_INTENTS,
  normalizeBackend,
  normalizeTaskIntent,
  resolveModelExperiencePlan,
  sanitizeAdvancedOptions,
};
