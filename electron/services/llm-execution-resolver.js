const MODEL_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_LIST_CACHE_TTL_MS = 15 * 1000;
const crypto = require('crypto');
const { inspectMoE } = require('./moe-detector');
const { getCachedSparkProfile } = require('./spark-profile');

const CASUAL_BASELINE_FALLBACKS = [
  'llama3.2:3b',
  'goekdenizguelmez/JOSIE:4b',
  'local-mistral-7b-instruct-v0.2.q5_0:latest',
];

const modelMetadataCache = new Map();
const modelListCache = new Map();

function createInferenceTraceId(prefix = 'inf') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeModelLookupKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/:latest$/i, '')
    .replace(/\.gguf$/i, '')
    .replace(/^local-/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isRawPromptTemplate(template) {
  if (!template || typeof template !== 'string') return false;
  const normalized = template.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return (
    normalized === '{{ .Prompt }}' ||
    normalized === '{{.Prompt}}' ||
    (normalized.includes('{{ .Prompt') && !normalized.includes('.Messages'))
  );
}

function inferTemplateMode(template, modelName = '', family = '') {
  if (isRawPromptTemplate(template)) return 'raw_prompt';
  if (typeof template === 'string' && template.includes('.Messages')) return 'native_chat';

  const lower = `${modelName} ${family}`.toLowerCase();
  if (
    lower.includes('wizard-vicuna') ||
    lower.includes('vicuna') ||
    lower.includes('alpaca')
  ) {
    return 'raw_prompt';
  }

  return 'native_chat';
}

function inferContextLengthFromName(modelName = '', family = '') {
  const lower = `${modelName} ${family}`.toLowerCase();
  if (!lower) return 8192;
  if (
    lower.includes('wizard-vicuna') ||
    lower.includes('vicuna') ||
    lower.includes('alpaca')
  ) {
    return 2048;
  }
  if (lower.includes('llama3.2')) return 8192;
  if (lower.includes('mistral')) return 8192;
  if (lower.includes('mixtral')) return 32768;
  if (lower.includes('qwen2.5') || lower.includes('qwen3')) return 131072;
  if (lower.includes('gemma')) return 8192;
  return 8192;
}

function extractContextLength(showData = {}) {
  const modelInfo = showData?.model_info || {};
  for (const key of Object.keys(modelInfo)) {
    const lower = key.toLowerCase();
    if (!lower.includes('context') && !lower.includes('position')) continue;
    const value = Number(modelInfo[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const parameters = String(showData?.parameters || '');
  const match = parameters.match(/num_ctx\s+(\d+)/i);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function normalizeChatMessages(messages = []) {
  const normalized = [];
  for (const msg of messages) {
    const role = msg?.role === 'assistant' ? 'assistant' : (msg?.role === 'user' ? 'user' : null);
    const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
    if (!role || !content) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      normalized.push({ role, content });
    }
  }

  while (normalized.length > 0 && normalized[0].role === 'assistant') {
    normalized.shift();
  }

  return normalized;
}

function isSimpleGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const value = text.trim().toLowerCase();
  if (!value || value.length > 80) return false;
  return /^(hi|hello|hey|yo|sup)( there| again)?[!.? ]*$|^(how are you|good morning|good afternoon|good evening|what's up|whats up)[!.? ]*$/i
    .test(value);
}

function isLikelyCodeRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const codeSignals = [
    /```/,
    /`[^`]+`/,
    /\b(error|exception|stack trace|traceback|bug|debug|refactor|compile|build|test|lint|runtime|syntax)\b/i,
    /\b(function|class|method|variable|array|object|sql|regex|api|endpoint|typescript|javascript|python|java|c\+\+|c#|rust|go)\b/i,
    /[{}()[\];]/,
  ];
  return codeSignals.some((pattern) => pattern.test(raw));
}

function buildRawModelHistory(messages = []) {
  const normalized = normalizeChatMessages(messages);
  if (normalized.length === 0) return [];

  let lastUserIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex < 0) return normalized.slice(-1);

  const latestUserText = normalized[lastUserIndex]?.content || '';
  if (isSimpleGreeting(latestUserText)) {
    return [normalized[lastUserIndex]];
  }

  const result = [];
  const previous = normalized[lastUserIndex - 1];
  if (previous && previous.role === 'assistant') {
    const previousText = previous.content || '';
    const previousLooksNoisy =
      previousText.length > 1200 ||
      /we have a user|according to the policy|<\|start\|>|<\|message\|>|assistant:|user:/i.test(previousText);

    if (!previousLooksNoisy) {
      result.push(previous);
    }
  }
  result.push(normalized[lastUserIndex]);
  return result;
}

function buildGenerateFallbackPrompt(systemPrompt, chatMessages = []) {
  const parts = [];
  const sys = String(systemPrompt || '').trim();
  if (sys) parts.push(`System: ${sys}`);

  for (const msg of chatMessages) {
    const role = msg.role === 'assistant' ? 'Assistant' : 'User';
    const content = String(msg.content || '').trim();
    if (!content) continue;
    parts.push(`${role}: ${content}`);
  }

  parts.push('Assistant:');
  return parts.join('\n\n');
}

function buildGptOssHarmonyPrompt(systemPrompt, chatMessages = []) {
  const parts = [];
  const sys = String(systemPrompt || '').trim();
  const today = new Date().toISOString().slice(0, 10);
  parts.push([
    '<|start|>system<|message|>You are ChatGPT, a large language model trained by OpenAI.',
    'Knowledge cutoff: 2024-06',
    `Current date: ${today}`,
    '',
    'Reasoning: medium',
    '',
    '# Valid channels: analysis, commentary, final. Channel must be included for every message.',
    '<|end|>',
  ].join('\n'));

  if (sys) {
    parts.push(`<|start|>developer<|message|># Instructions\n\n${sys}<|end|>`);
  }

  for (const msg of chatMessages) {
    const content = String(msg.content || '').trim();
    if (!content) continue;
    if (msg.role === 'assistant') {
      parts.push(`<|start|>assistant<|channel|>final<|message|>${content}<|end|>`);
    } else {
      parts.push(`<|start|>user<|message|>${content}<|end|>`);
    }
  }

  parts.push('<|start|>assistant<|channel|>final<|message|>');
  return parts.join('');
}

function extractLastUserImages(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      return msg.images;
    }
  }
  return null;
}

function clampExecutionOptions(baseOptions = {}, metadata = {}) {
  const options = { ...(baseOptions || {}) };
  const contextLimit = Number(metadata?.effectiveContextLength || metadata?.rawContextLength || 0);
  const fallbackLimit = inferContextLengthFromName(metadata?.model || '', metadata?.family || '');
  const effectiveContextLength = Number.isFinite(contextLimit) && contextLimit > 0
    ? contextLimit
    : fallbackLimit;
  const sparkProfile = getCachedSparkProfile();
  const envSaysSpark = /spark|gb10|grace/i.test(String(process.env.DEVFORGE_SPARK_PROFILE || ''));
  const isSpark = Boolean(sparkProfile?.isSpark || envSaysSpark);
  const moe = metadata?.moe || inspectMoE(metadata?._showData || metadata || {}, metadata?.model || '');
  const isSparkMoe = Boolean(isSpark && moe?.isMoE);
  const safeContextCeiling = isSparkMoe
    ? 4096
    : (isSpark
      ? Math.min(effectiveContextLength || fallbackLimit || 8192, fallbackLimit || 8192, 8192)
      : effectiveContextLength);

  const requestedCtx = Number(options.num_ctx);
  if (Number.isFinite(requestedCtx) && requestedCtx > 0) {
    options.num_ctx = Math.max(256, Math.min(Math.floor(requestedCtx), safeContextCeiling));
  } else if (safeContextCeiling > 0) {
    options.num_ctx = safeContextCeiling;
  }

  const requestedPredict = Number(options.num_predict);
  if (Number.isFinite(requestedPredict) && requestedPredict > 0) {
    options.num_predict = Math.max(16, Math.floor(requestedPredict));
  }

  if (isSparkMoe) {
    options.num_ctx = Math.min(Number(options.num_ctx || 4096), 4096);
    options.num_batch = Math.min(Number(options.num_batch || 64), 64);
    options.num_predict = Math.min(Number(options.num_predict || 1024), 1024);
    options.kv_cache_type = 'q4_0';
    options.num_gpu = -1;
    options.flash_attn = options.flash_attn !== false;
  }

  return {
    effectiveContextLength,
    moe,
    spark: isSpark,
    options,
  };
}

function isLikelyGptOssModel(modelName, family = '') {
  const modelLower = String(modelName || '').toLowerCase();
  const familyLower = String(family || '').toLowerCase();
  return (
    modelLower.includes('gpt-oss') ||
    modelLower.includes('gpt_oss') ||
    modelLower.includes('gptoss') ||
    familyLower === 'gpt-oss' ||
    familyLower.includes('gpt_oss') ||
    familyLower.includes('gptoss')
  );
}

function normalizeFamily(value = '', modelName = '') {
  const family = String(value || '').trim().toLowerCase();
  const lower = `${modelName || ''} ${family}`.toLowerCase();
  if (lower.includes('gpt-oss') || lower.includes('gptoss')) return 'gpt-oss';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('gemma4') || lower.includes('gemma 4')) return 'gemma4';
  if (lower.includes('gemma3') || lower.includes('gemma 3')) return 'gemma3';
  if (lower.includes('gemma')) return 'gemma';
  if (lower.includes('devstral')) return 'devstral';
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
  if (lower.includes('dolphin') || lower.includes('venice')) return 'dolphin-mistral';
  if (family) return family;
  return 'unknown';
}

function capabilityList(metadata = {}) {
  const caps = [
    ...(Array.isArray(metadata?.capabilities) ? metadata.capabilities : []),
    ...(Array.isArray(metadata?._raw?.capabilities) ? metadata._raw.capabilities : []),
  ];
  return caps.map((cap) => String(cap || '').toLowerCase()).filter(Boolean);
}

function hasToolCapability(metadata = {}) {
  const caps = capabilityList(metadata);
  return caps.some((cap) => (
    cap === 'tools' ||
    cap === 'tool' ||
    cap === 'tool-calling' ||
    cap === 'function-calling' ||
    cap === 'function_calling'
  ));
}

function resolveModelCapabilityMatrix({
  model,
  metadata = {},
  hasToolsRequested = false,
  forceCompatMode = false,
} = {}) {
  const family = normalizeFamily(metadata?.family, model);
  const templateMode = metadata?.templateMode || inferTemplateMode(metadata?.template, model, family);
  const supportsNativeChat = templateMode === 'native_chat';
  const lower = `${model || ''} ${family}`.toLowerCase();
  const rawTemplate = templateMode === 'raw_prompt';
  const isGptOss = isLikelyGptOssModel(model, family);
  const isGemma3 = lower.includes('gemma3') || lower.includes('gemma 3') || family === 'gemma3';
  const isGemma4 = lower.includes('gemma4') || lower.includes('gemma 4') || family === 'gemma4';
  const isQwen = lower.includes('qwen');
  const isDolphin = lower.includes('dolphin') || lower.includes('venice');
  const isMistral = lower.includes('mistral') || lower.includes('devstral') || lower.includes('mixtral');
  const metadataHasTools = hasToolCapability(metadata);
  const warnings = Array.isArray(metadata?.warnings) ? [...metadata.warnings] : [];
  const reasons = [];

  let supportsNativeTools = false;
  let preferredToolMode = 'disabled';
  let capabilityConfidence = 'metadata';
  let thinkingPolicy = 'none';

  if (isGptOss) {
    supportsNativeTools = true;
    preferredToolMode = 'native';
    thinkingPolicy = 'preserve';
    reasons.push('gpt-oss-native-tools');
  } else if (isGemma3) {
    supportsNativeTools = metadataHasTools;
    preferredToolMode = metadataHasTools ? 'native' : 'text-json';
    thinkingPolicy = 'none';
    if (!metadataHasTools) {
      warnings.push('Gemma3 metadata does not advertise tools; native tools disabled.');
      reasons.push('gemma3-tools-metadata-gate');
    }
  } else if (isGemma4) {
    supportsNativeTools = metadataHasTools;
    preferredToolMode = metadataHasTools ? 'native' : 'text-json';
    thinkingPolicy = 'strip-between-turns';
    reasons.push(metadataHasTools ? 'gemma4-tools-metadata' : 'gemma4-text-tool-fallback');
  } else if (isQwen) {
    supportsNativeTools = metadataHasTools;
    preferredToolMode = metadataHasTools ? 'native' : 'text-json';
    thinkingPolicy = 'preserve';
    reasons.push(metadataHasTools ? 'qwen-metadata-tools' : 'qwen-text-json-fallback');
  } else if (isDolphin) {
    supportsNativeTools = metadataHasTools && supportsNativeChat;
    preferredToolMode = supportsNativeTools ? 'native' : 'react-text';
    thinkingPolicy = 'none';
    reasons.push(supportsNativeTools ? 'dolphin-metadata-tools' : 'dolphin-react-text-fallback');
  } else if (isMistral) {
    supportsNativeTools = supportsNativeChat && metadataHasTools;
    preferredToolMode = supportsNativeTools ? 'native' : 'react-text';
    thinkingPolicy = 'none';
    reasons.push(supportsNativeTools ? 'mistral-metadata-tools' : 'mistral-react-text-fallback');
  } else {
    supportsNativeTools = metadataHasTools && supportsNativeChat;
    preferredToolMode = supportsNativeTools ? 'native' : 'text-json';
    thinkingPolicy = 'none';
    reasons.push(supportsNativeTools ? 'metadata-tools' : 'unknown-text-tool-fallback');
  }

  let preferredEndpoint = supportsNativeChat ? '/api/chat' : '/api/generate';
  let fallbackReason = null;
  const compatRequired = forceCompatMode || rawTemplate || (isGptOss && !hasToolsRequested);

  if (hasToolsRequested && supportsNativeTools && !forceCompatMode) {
    preferredEndpoint = '/api/chat';
  } else if (compatRequired) {
    preferredEndpoint = '/api/generate';
  }

  if (hasToolsRequested && preferredEndpoint !== '/api/chat') {
    fallbackReason = 'compat_blocked_native_tools';
    if (preferredToolMode === 'native') preferredToolMode = isDolphin ? 'react-text' : 'text-json';
  } else if (hasToolsRequested && !supportsNativeTools) {
    fallbackReason = 'native_tools_unavailable';
  }

  return {
    family,
    templateMode,
    supportsNativeChat,
    supportsNativeTools,
    preferredEndpoint,
    preferredToolMode,
    thinkingPolicy,
    capabilityConfidence,
    reasons,
    warnings,
    fallbackReason,
  };
}

function buildExecutionContract({
  traceId,
  runId,
  requestedModel,
  resolvedModel,
  endpointMode,
  executionMode,
  effectiveContextLength,
  effectiveOptions,
  backendId = null,
  reasons = [],
  metadata = {},
  capability = {},
  toolsRequested = false,
  toolsAttached = false,
  compatBlockedTools = false,
  fallbackReason = null,
} = {}) {
  const family = capability.family || normalizeFamily(metadata?.family, resolvedModel || requestedModel);
  return {
    traceId: traceId || createInferenceTraceId(),
    runId: runId || null,
    requestedModel: requestedModel || null,
    resolvedModel: resolvedModel || requestedModel || null,
    effectiveModel: resolvedModel || requestedModel || null,
    provider: 'ollama',
    family,
    templateMode: capability.templateMode || metadata?.templateMode || 'native_chat',
    endpointMode,
    executionMode,
    toolMode: capability.preferredToolMode || (toolsAttached ? 'native' : 'disabled'),
    toolsRequested: Boolean(toolsRequested),
    toolsAttached: Boolean(toolsAttached),
    compatBlockedTools: Boolean(compatBlockedTools),
    thinkingPolicy: capability.thinkingPolicy || 'none',
    metadataSource: metadata?._raw?.error ? 'heuristic' : 'metadata',
    capabilityConfidence: capability.capabilityConfidence || 'heuristic',
    effectiveContextLength,
    effectiveOptions,
    backendId,
    reasons: [...(Array.isArray(reasons) ? reasons : []), ...(Array.isArray(capability.reasons) ? capability.reasons : [])],
    warnings: Array.isArray(capability.warnings) ? capability.warnings : [],
    fallbackReason: fallbackReason || capability.fallbackReason || null,
  };
}

function buildGenericCompatRequest(modelName, systemPrompt, messages, baseOptions = {}, stream = true, format = null) {
  const normalizedMessages = normalizeChatMessages(messages);
  const options = {
    ...baseOptions,
    repeat_penalty: Math.max(1.1, Number(baseOptions.repeat_penalty || 1.05)),
    frequency_penalty: Number.isFinite(Number(baseOptions.frequency_penalty)) ? Number(baseOptions.frequency_penalty) : 0.05,
    presence_penalty: Number.isFinite(Number(baseOptions.presence_penalty)) ? Number(baseOptions.presence_penalty) : 0.05,
    stop: Array.from(new Set([
      ...(Array.isArray(baseOptions.stop) ? baseOptions.stop : []),
      'Human:', 'human:', 'User:', 'user:',
      '\nHuman:', '\nUser:', '\n\nHuman:', '\n\nUser:',
    ])),
  };

  const requestBody = {
    model: modelName,
    prompt: buildGenerateFallbackPrompt(systemPrompt, normalizedMessages),
    stream,
    options,
  };

  if (format) {
    requestBody.format = format;
  }

  const images = extractLastUserImages(messages);
  if (Array.isArray(images) && images.length > 0) {
    requestBody.images = images;
  }

  return {
    apiPath: '/api/generate',
    requestBody,
    responseMode: 'generate',
    reason: 'generic-chat-compat',
  };
}

function buildGenerateCompatRequest(modelName, systemPrompt, messages, baseOptions = {}, stream = true, metadata = null, format = null) {
  const meta = metadata || {};
  const isRawTemplate = meta.templateMode === 'raw_prompt' || isRawPromptTemplate(meta.template);
  const isGptOss = isLikelyGptOssModel(modelName, meta.family);
  if (!isRawTemplate && !isGptOss) return null;

  const normalizedMessages = normalizeChatMessages(messages);
  const latestUser = [...normalizedMessages].reverse().find((msg) => msg.role === 'user')?.content || '';
  const history = isGptOss ? buildRawModelHistory(normalizedMessages) : normalizedMessages;
  const greetingLike = isSimpleGreeting(latestUser);
  const codeLike = isLikelyCodeRequest(latestUser);

  const compatSystemPrompt = isGptOss
    ? (codeLike
      ? 'You are a precise coding assistant. Give direct, practical answers with runnable code when asked.'
      : 'You are a helpful assistant. Reply naturally and directly in a concise way.')
    : (systemPrompt || '');

  const effectiveContext = Number(meta?.effectiveContextLength || baseOptions?.num_ctx || 0) || 16384;
  const cappedCtx = isGptOss ? Math.min(effectiveContext, 8192) : effectiveContext;
  const cappedPredict = greetingLike ? 96 : (isGptOss ? 384 : 768);

  const options = isGptOss
    ? {
      ...baseOptions,
      num_ctx: Number.isFinite(Number(baseOptions.num_ctx)) ? Math.min(Number(baseOptions.num_ctx), cappedCtx) : cappedCtx,
      num_predict: Number.isFinite(Number(baseOptions.num_predict)) ? Math.min(Number(baseOptions.num_predict), cappedPredict) : cappedPredict,
      temperature: 1.0,
      top_k: 40,
      top_p: 1.0,
      min_p: 0.0,
      repeat_penalty: 1.0,
    }
    : {
      ...baseOptions,
      repeat_penalty: Math.max(1.1, Number(baseOptions.repeat_penalty || 1.05)),
      num_ctx: Number.isFinite(Number(baseOptions.num_ctx)) ? Math.min(Number(baseOptions.num_ctx), cappedCtx) : cappedCtx,
      num_predict: Number.isFinite(Number(baseOptions.num_predict)) ? Math.min(Number(baseOptions.num_predict), cappedPredict) : cappedPredict,
      temperature: greetingLike
        ? Math.min(Math.max(Number(baseOptions.temperature ?? 0.2), 0.2), 0.35)
        : Number(baseOptions.temperature ?? 0.2),
    };

  if (isGptOss) {
    delete options.frequency_penalty;
    delete options.presence_penalty;
    const stops = Array.isArray(baseOptions.stop) ? baseOptions.stop : [];
    options.stop = Array.from(new Set([
      ...stops,
      '<|return|>',
      '<|end|>',
      '<|start|>',
    ]));
  } else {
    const stops = Array.isArray(baseOptions.stop) ? baseOptions.stop : [];
    options.stop = Array.from(new Set([
      ...stops,
      'Human:', 'human:', 'User:', 'user:',
      '\nHuman:', '\nUser:', '\n\nHuman:', '\n\nUser:',
    ]));
  }

  const prompt = isGptOss
    ? buildGptOssHarmonyPrompt(compatSystemPrompt, history)
    : buildGenerateFallbackPrompt(compatSystemPrompt, history);

  const requestBody = {
    model: modelName,
    prompt,
    stream,
    ...(isGptOss ? { raw: true } : {}),
    options,
  };

  if (format) {
    requestBody.format = format;
  }

  const visionImages = extractLastUserImages(messages);
  if (Array.isArray(visionImages) && visionImages.length > 0) {
    requestBody.images = visionImages;
  }

  return {
    apiPath: '/api/generate',
    requestBody,
    responseMode: 'generate',
    reason: isGptOss ? 'gpt-oss-harmony-compat' : 'raw-template-compat',
  };
}

function evaluateBaselineStatus(modelName, metadata = {}) {
  const reasons = [];
  const lower = String(modelName || '').toLowerCase();
  if (metadata.templateMode === 'raw_prompt') {
    reasons.push('raw_template_mode');
  }
  if (Number(metadata.effectiveContextLength || 0) > 0 && Number(metadata.effectiveContextLength) <= 2048) {
    reasons.push('legacy_context_window');
  }
  if (lower.includes('vicuna') || lower.includes('alpaca') || lower.includes('wizard')) {
    reasons.push('legacy_chat_baseline');
  }

  let baselineStatus = 'healthy';
  if (reasons.length >= 2) baselineStatus = 'unstable';
  else if (reasons.length === 1) baselineStatus = 'caution';

  return {
    baselineStatus,
    baselineReasons: reasons,
    warnings: reasons.map((reason) => {
      if (reason === 'raw_template_mode') return 'This model uses a raw prompt template and is not a reliable native chat baseline.';
      if (reason === 'legacy_context_window') return 'This model has a short context window and may truncate or degrade on normal conversations.';
      if (reason === 'legacy_chat_baseline') return 'This is a legacy chat baseline and may need compatibility mode or fallback routing.';
      return reason;
    }),
  };
}

async function listInstalledModels(endpoint, makeRequest) {
  const cacheKey = String(endpoint || '').trim();
  const now = Date.now();
  const cached = modelListCache.get(cacheKey);
  if (cached && now - cached.ts < MODEL_LIST_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const response = await makeRequest(`${endpoint}/api/tags`, { timeout: 12000 });
    const models = Array.isArray(response?.data?.models)
      ? response.data.models.map((model) => String(model?.name || '').trim()).filter(Boolean)
      : [];
    modelListCache.set(cacheKey, { ts: now, models });
    return models;
  } catch {
    modelListCache.set(cacheKey, { ts: now, models: [] });
    return [];
  }
}

async function getNormalizedModelInfo(endpoint, makeRequest, modelName, options = {}) {
  const normalizedName = String(modelName || '').trim();
  if (!normalizedName) {
    return { success: false, error: 'Model is required' };
  }

  const cacheKey = `${String(endpoint || '').trim()}::${normalizedName.toLowerCase()}`;
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = modelMetadataCache.get(cacheKey);
    if (cached && now - cached.ts < MODEL_METADATA_CACHE_TTL_MS) {
      return cached.value;
    }
  }

  try {
    const response = await makeRequest(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: normalizedName },
      timeout: 12000,
    });

    const data = response?.data || {};
    const details = data.details || {};
    const template = data.template || null;
    const family = details.family || null;
    const capabilities = Array.isArray(data.capabilities)
      ? data.capabilities
      : (Array.isArray(details.capabilities) ? details.capabilities : []);
    const rawContextLength = extractContextLength(data) || inferContextLengthFromName(normalizedName, family);
    const templateMode = inferTemplateMode(template, normalizedName, family);
    const supportsNativeChat = templateMode === 'native_chat';
    const effectiveContextLength = rawContextLength;
    const baseline = evaluateBaselineStatus(normalizedName, {
      templateMode,
      effectiveContextLength,
    });

    const value = {
      success: true,
      model: normalizedName,
      family,
      parameterSize: details.parameter_size || null,
      quantizationLevel: details.quantization_level || null,
      contextLength: effectiveContextLength,
      rawContextLength,
      effectiveContextLength,
      format: details.format || null,
      parentModel: details.parent_model || null,
      capabilities,
      template,
      templateMode,
      supportsNativeChat,
      baselineStatus: baseline.baselineStatus,
      baselineReasons: baseline.baselineReasons,
      warnings: baseline.warnings,
      _raw: { families: details.families, format: details.format, capabilities },
      _showData: data,
    };

    modelMetadataCache.set(cacheKey, { ts: now, value });
    return value;
  } catch (error) {
    const templateMode = inferTemplateMode(null, normalizedName, null);
    const effectiveContextLength = inferContextLengthFromName(normalizedName, null);
    const baseline = evaluateBaselineStatus(normalizedName, {
      templateMode,
      effectiveContextLength,
    });
    const fallbackValue = {
      success: true,
      model: normalizedName,
      family: null,
      parameterSize: null,
      quantizationLevel: null,
      contextLength: effectiveContextLength,
      rawContextLength: effectiveContextLength,
      effectiveContextLength,
      format: null,
      parentModel: null,
      template: null,
      templateMode,
      supportsNativeChat: templateMode === 'native_chat',
      baselineStatus: baseline.baselineStatus,
      baselineReasons: baseline.baselineReasons,
      warnings: baseline.warnings,
      _raw: { error: error.message },
    };
    modelMetadataCache.set(cacheKey, { ts: now, value: fallbackValue });
    return fallbackValue;
  }
}

function buildNativeChatRequest(modelName, systemPrompt, messages, baseOptions = {}, stream = true, format = null) {
  const requestMessages = [];
  if (systemPrompt) {
    requestMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || '').toLowerCase();
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;

    const entry = { role, content: msg.content != null ? String(msg.content) : '' };
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      entry.images = msg.images;
    }
    if (role === 'tool') {
      if (typeof msg.tool_call_id !== 'string' || !msg.tool_call_id.trim()) continue;
      entry.tool_call_id = msg.tool_call_id.trim();
      if (typeof msg.name === 'string' && msg.name.trim()) {
        entry.name = msg.name.trim();
      }
    }
    if (role === 'assistant') {
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        entry.tool_calls = msg.tool_calls;
      }
      if (typeof msg.name === 'string' && msg.name.trim()) {
        entry.name = msg.name.trim();
      }
    }
    requestMessages.push(entry);
  }

  const requestBody = {
    model: modelName,
    messages: requestMessages,
    stream,
    options: {
      ...baseOptions,
      repeat_penalty: Number.isFinite(Number(baseOptions.repeat_penalty)) ? Number(baseOptions.repeat_penalty) : 1.05,
      frequency_penalty: Number.isFinite(Number(baseOptions.frequency_penalty)) ? Number(baseOptions.frequency_penalty) : 0.05,
      presence_penalty: Number.isFinite(Number(baseOptions.presence_penalty)) ? Number(baseOptions.presence_penalty) : 0.05,
    },
  };

  if (format) {
    requestBody.format = format;
  }

  return {
    apiPath: '/api/chat',
    requestBody,
    responseMode: 'chat',
  };
}

async function resolveCasualFallbackModel(endpoint, makeRequest, requestedModel) {
  const installed = await listInstalledModels(endpoint, makeRequest);
  if (!Array.isArray(installed) || installed.length === 0) return null;

  const exactMap = new Map(installed.map((name) => [String(name || '').toLowerCase(), name]));
  const keyedMap = new Map(installed.map((name) => [normalizeModelLookupKey(name), name]));
  const requestedKey = normalizeModelLookupKey(requestedModel);

  for (const candidate of CASUAL_BASELINE_FALLBACKS) {
    const exact = exactMap.get(String(candidate).toLowerCase());
    if (exact && normalizeModelLookupKey(exact) !== requestedKey) {
      return exact;
    }
    const keyed = keyedMap.get(normalizeModelLookupKey(candidate));
    if (keyed && normalizeModelLookupKey(keyed) !== requestedKey) {
      return keyed;
    }
  }

  return null;
}

async function buildExecutionPlan({ endpoint, makeRequest, payload, stream = false }) {
  const requestedModel = String(payload?.model || '').trim();
  if (!requestedModel) {
    throw new Error('Model is required');
  }
  const traceId = String(payload?.traceId || '').trim() || createInferenceTraceId();
  const runId = String(payload?.runId || '').trim() || null;

  const workspace = String(payload?.workspace || '').trim().toLowerCase() || 'casual';
  const workloadType = String(payload?.workloadType || '').trim().toLowerCase() || 'chat';
  const requestedInfo = await getNormalizedModelInfo(endpoint, makeRequest, requestedModel);
  if (requestedInfo && typeof requestedInfo === 'object') {
    requestedInfo.moe = inspectMoE(requestedInfo?._showData || requestedInfo || {}, requestedModel);
  }

  let effectiveModel = requestedModel;
  let metadata = requestedInfo;
  const reasons = [];
  const hasMessages = Array.isArray(payload?.messages) && payload.messages.length > 0;
  const hasToolsRequested = Array.isArray(payload?.tools) && payload.tools.length > 0;
  const privateWorkspace = workspace === 'nsfw' || workspace === 'private';
  const explicitFallback = payload?.forceModelFallback === true;
  const requestedIsGptOss = isLikelyGptOssModel(requestedModel, metadata?.family);
  const allowCasualFallback =
    workspace === 'casual' &&
    !privateWorkspace &&
    workloadType === 'chat' &&
    hasMessages &&
    (!requestedIsGptOss || explicitFallback);

  if (allowCasualFallback) {
    const shouldFallback =
      explicitFallback ||
      metadata?.baselineStatus === 'unstable';

    if (shouldFallback) {
      const fallbackModel = await resolveCasualFallbackModel(endpoint, makeRequest, requestedModel);
      if (fallbackModel) {
        effectiveModel = fallbackModel;
        metadata = await getNormalizedModelInfo(endpoint, makeRequest, fallbackModel);
        if (metadata && typeof metadata === 'object') {
          metadata.moe = inspectMoE(metadata?._showData || metadata || {}, fallbackModel);
        }
        reasons.push(explicitFallback ? 'forced-casual-baseline-fallback' : 'casual-baseline-fallback');
      } else {
        reasons.push('casual-fallback-unavailable');
      }
    }
  }

  const clamped = clampExecutionOptions(payload?.options || {}, {
    ...metadata,
    model: effectiveModel,
  });
  const capability = resolveModelCapabilityMatrix({
    model: effectiveModel,
    metadata,
    hasToolsRequested,
    forceCompatMode: payload?.forceCompatMode === true,
  });
  const effectiveIsGptOss = isLikelyGptOssModel(effectiveModel, capability.family || metadata?.family);

  let requestDescriptor = null;
  let wantsCompatMode = false;
  let executionMode = reasons.some((reason) => reason.includes('fallback'))
    ? 'fallback_model'
    : 'direct';

  if (hasMessages) {
    const forceCompat = payload?.forceCompatMode === true;
    // GPT-OSS historically needed /api/generate compat for plain chat, but
    // native tool loops require /api/chat. Do not force compat when tools are present.
    const gptOssCompatWithoutTools = effectiveIsGptOss && !hasToolsRequested;
    const noNativeChat = capability.preferredEndpoint !== '/api/chat';
    wantsCompatMode = forceCompat || noNativeChat || gptOssCompatWithoutTools;
    if (wantsCompatMode && hasToolsRequested) {
      reasons.push('tools_incompatible_with_compat_mode');
    }
    if (wantsCompatMode) {
      requestDescriptor = buildGenerateCompatRequest(
        effectiveModel,
        payload?.system || '',
        payload?.messages || [],
        clamped.options,
        stream,
        metadata,
        payload?.format || null
      ) || buildGenericCompatRequest(
        effectiveModel,
        payload?.system || '',
        payload?.messages || [],
        clamped.options,
        stream,
        payload?.format || null
      );
      if (executionMode !== 'fallback_model') {
        executionMode = 'compat';
      }
      reasons.push(requestDescriptor.reason);
    } else {
      requestDescriptor = buildNativeChatRequest(
        effectiveModel,
        payload?.system || '',
        payload?.messages || [],
        clamped.options,
        stream,
        payload?.format || null
      );
      if (hasToolsRequested && capability.preferredToolMode === 'native') {
        requestDescriptor.requestBody.tools = payload.tools;
        if (payload.think !== undefined) {
          requestDescriptor.requestBody.think = payload.think;
        }
      }
    }
  } else {
    const requestBody = {
      model: effectiveModel,
      prompt: payload?.prompt || '',
      system: payload?.system || '',
      stream,
      options: clamped.options,
    };
    if (payload?.format) {
      requestBody.format = payload.format;
    }
    if (Array.isArray(payload?.images) && payload.images.length > 0) {
      requestBody.images = payload.images;
    }
    requestDescriptor = {
      apiPath: '/api/generate',
      requestBody,
      responseMode: 'generate',
    };
  }

  const toolsAttached =
    Boolean(
      hasToolsRequested
      && requestDescriptor
      && requestDescriptor.apiPath === '/api/chat'
      && Array.isArray(requestDescriptor.requestBody?.tools)
      && requestDescriptor.requestBody.tools.length > 0,
    );
  const compatBlockedTools = Boolean(hasToolsRequested && wantsCompatMode);
  const fallbackReason = compatBlockedTools
    ? 'compat_blocked_native_tools'
    : (hasToolsRequested && !toolsAttached ? capability.fallbackReason || 'native_tools_unavailable' : capability.fallbackReason);
  const executionContract = buildExecutionContract({
    traceId,
    runId,
    requestedModel,
    resolvedModel: effectiveModel,
    endpointMode: requestDescriptor.apiPath,
    executionMode,
    effectiveContextLength: clamped.effectiveContextLength,
    effectiveOptions: clamped.options,
    backendId: null,
    reasons,
    metadata,
    capability,
    toolsRequested: hasToolsRequested,
    toolsAttached,
    compatBlockedTools,
    fallbackReason,
  });

  return {
    traceId,
    runId,
    requestedModel,
    resolvedModel: effectiveModel,
    effectiveModel,
    provider: executionContract.provider,
    family: executionContract.family,
    templateMode: executionContract.templateMode,
    endpointMode: requestDescriptor.apiPath,
    executionMode,
    toolMode: executionContract.toolMode,
    thinkingPolicy: executionContract.thinkingPolicy,
    metadataSource: executionContract.metadataSource,
    capabilityConfidence: executionContract.capabilityConfidence,
    effectiveContextLength: clamped.effectiveContextLength,
    effectiveOptions: clamped.options,
    backendId: null,
    reasons: executionContract.reasons,
    warnings: executionContract.warnings,
    fallbackReason: executionContract.fallbackReason,
    metadata,
    capability,
    executionContract,
    requestBody: requestDescriptor.requestBody,
    responseMode: requestDescriptor.responseMode,
    toolsRequested: hasToolsRequested,
    toolsAttached,
    compatBlockedTools,
  };
}

module.exports = {
  CASUAL_BASELINE_FALLBACKS,
  buildExecutionPlan,
  buildExecutionContract,
  clampExecutionOptions,
  createInferenceTraceId,
  getNormalizedModelInfo,
  inferTemplateMode,
  isRawPromptTemplate,
  resolveModelCapabilityMatrix,
};
