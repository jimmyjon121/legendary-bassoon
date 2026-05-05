import {
  cloneProfile,
  DOLPHIN_MISTRAL_24B_PROFILE,
  GEMMA_PROFILE,
  GPT_OSS_PROFILE,
  QWEN3_CODER_PROFILE,
  type DetectionTraceEntry,
  type ModelProfile,
  type ParallelToolCalls,
  type QualityTier,
  type ThinkingStyle,
} from '../modelProfiles';

export interface OllamaShowMetadata {
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}

export interface RuntimeBenchmarkResult {
  digest: string;
  tool_call_reliability: number;
  parallel_tool_calls: ParallelToolCalls;
  tool_quality_tier: QualityTier;
  coding_quality_tier: QualityTier;
  eval_tps_estimate: number;
  cold_start_ms: number;
}

export interface BenchmarkCache {
  getByDigest(digest: string): Promise<RuntimeBenchmarkResult | null>;
  saveByDigest(result: RuntimeBenchmarkResult): Promise<void>;
}

export interface DetectModelProfileInput {
  modelName: string;
  metadata?: OllamaShowMetadata | null;
  runBenchmark?: boolean;
  benchmarkCache?: BenchmarkCache;
  benchmark?: (profile: ModelProfile) => Promise<RuntimeBenchmarkResult>;
}

export async function detectModelProfile(input: DetectModelProfileInput): Promise<ModelProfile> {
  const profile = seedProfileFromName(input.modelName);
  applyMetadata(profile, input.metadata || null);
  applyGemmaToolGate(profile, input.modelName, input.metadata || null);

  const digest = profile.digest;
  if (digest && input.benchmarkCache) {
    const cached = await input.benchmarkCache.getByDigest(digest);
    if (cached) {
      applyBenchmarkResult(profile, cached, 'Loaded cached benchmark result by digest.');
      return profile;
    }
  }

  if (input.runBenchmark && input.benchmark && input.benchmarkCache) {
    const benchmark = await input.benchmark(profile);
    applyBenchmarkResult(profile, benchmark, 'Runtime microbenchmark overwrote prior profile confidence.');
    await input.benchmarkCache.saveByDigest(benchmark);
  }

  return profile;
}

export function seedProfileFromName(modelName: string): ModelProfile {
  const normalized = modelName.toLowerCase();
  if (/gpt[-_ ]?oss/.test(normalized)) return traceNameSeed(cloneProfile(GPT_OSS_PROFILE), modelName);
  if (/qwen3.*coder|qwen.*coder/.test(normalized)) return traceNameSeed(cloneProfile(QWEN3_CODER_PROFILE), modelName);
  if (/gemma\s*3|gemma3|gemma\s*4|gemma4/.test(normalized)) return traceNameSeed(cloneProfile(GEMMA_PROFILE), modelName);
  if (/dolphin.*mistral|venice.*mistral|mistral.*24b/.test(normalized)) {
    return traceNameSeed(cloneProfile(DOLPHIN_MISTRAL_24B_PROFILE), modelName);
  }
  const fallback = cloneProfile(GEMMA_PROFILE);
  fallback.id = modelName;
  fallback.digest = `prior:${modelName}`;
  fallback.detection_trace.push({
    source: 'name-regex',
    field: 'id',
    value: modelName,
    reason: 'No target-specific regex matched; using conservative JSON-schema fallback profile.',
  });
  return fallback;
}

function applyMetadata(profile: ModelProfile, metadata: OllamaShowMetadata | null): void {
  if (!metadata) return;
  const trace = (field: string, value: DetectionTraceEntry['value'], reason: string) => {
    profile.detection_trace.push({ source: 'metadata', field, value, reason });
  };

  if (metadata.digest) {
    profile.digest = metadata.digest;
    trace('digest', metadata.digest, '/api/show digest identifies benchmark cache key.');
  }
  if (metadata.details?.family) {
    profile.family = metadata.details.family;
    trace('family', profile.family, '/api/show details.family overrides name prior.');
  }
  if (metadata.details?.parameter_size) {
    profile.parameter_size = metadata.details.parameter_size;
    trace('parameter_size', profile.parameter_size, '/api/show details.parameter_size overrides name prior.');
  }
  if (metadata.details?.quantization_level) {
    profile.quantization = metadata.details.quantization_level;
    trace('quantization', profile.quantization, '/api/show details.quantization_level overrides name prior.');
  }
  if (Array.isArray(metadata.capabilities)) {
    profile.capabilities = [...metadata.capabilities];
    trace('capabilities', profile.capabilities, '/api/show capabilities override name prior.');
    if (metadata.capabilities.includes('tools')) {
      profile.supports_native_tools = true;
      profile.tool_format = profile.id.startsWith('gemma') ? 'native-json' : profile.tool_format;
      trace('supports_native_tools', true, '/api/show capabilities includes tools.');
    }
  }

  const detectedFamily = String(metadata.details?.family ?? '').toLowerCase();
  if (detectedFamily.includes('gemma4') || detectedFamily.includes('gemma 4')) {
    const style: ThinkingStyle = 'strip-between-turns';
    profile.thinking_style = style;
    trace('thinking_style', style, 'Gemma 4 strips <think> between turns but preserves within a single tool-call turn.');
  } else if (Array.isArray(metadata.capabilities) && metadata.capabilities.includes('thinking')) {
    const style: ThinkingStyle = 'adaptive';
    profile.thinking_style = style;
    trace('thinking_style', style, '/api/show capabilities includes thinking; model supports adaptive reasoning mode.');
  }

  const contextLength = extractContextLength(metadata.model_info || {});
  if (contextLength) {
    profile.context_window = Math.max(32768, contextLength);
    profile.context_window_max = Math.max(profile.context_window_max, contextLength);
    profile.optimal_options.num_ctx = Math.max(32768, Math.min(profile.optimal_options.num_ctx, profile.context_window_max));
    trace('context_window', profile.context_window, '/api/show model_info context length overrides name prior.');
  }
}

function applyGemmaToolGate(profile: ModelProfile, modelName: string, metadata: OllamaShowMetadata | null): void {
  const isGemma3 = /gemma\s*3|gemma3/i.test(modelName);
  if (!isGemma3) return;
  const hasTools = Boolean(metadata?.capabilities?.includes('tools'));
  if (hasTools) return;
  profile.supports_native_tools = false;
  profile.tool_format = 'json-schema-fallback';
  profile.detection_trace.push({
    source: 'metadata',
    field: 'tool_format',
    value: 'json-schema-fallback',
    reason: 'Gemma3 name matched, but /api/show capabilities did not include tools; native function calling is disabled.',
  });
}

function applyBenchmarkResult(profile: ModelProfile, benchmark: RuntimeBenchmarkResult, reason: string): void {
  profile.digest = benchmark.digest;
  profile.tool_call_reliability = benchmark.tool_call_reliability;
  profile.parallel_tool_calls = benchmark.parallel_tool_calls;
  profile.tool_quality_tier = benchmark.tool_quality_tier;
  profile.coding_quality_tier = benchmark.coding_quality_tier;
  profile.eval_tps_estimate = benchmark.eval_tps_estimate;
  profile.cold_start_ms = benchmark.cold_start_ms;
  for (const [field, value] of Object.entries(benchmark)) {
    profile.detection_trace.push({ source: 'bench', field, value: value as DetectionTraceEntry['value'], reason });
  }
}

function traceNameSeed(profile: ModelProfile, modelName: string): ModelProfile {
  profile.detection_trace.push({
    source: 'name-regex',
    field: 'id',
    value: profile.id,
    reason: `Model name "${modelName}" matched ${profile.id} prior.`,
  });
  return profile;
}

function extractContextLength(modelInfo: Record<string, unknown>): number | null {
  const candidates = [
    'context_length',
    'llama.context_length',
    'qwen3.context_length',
    'gemma3.context_length',
    'mistral.context_length',
  ];
  for (const key of candidates) {
    const value = modelInfo[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}
