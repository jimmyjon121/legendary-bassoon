export type ToolFormat =
  | 'native-json'
  | 'hermes'
  | 'qwen3-xml'
  | 'mistral'
  | 'json-schema-fallback'
  | 'react-text';

export type ParallelToolCalls = 'reliable' | 'flaky' | 'serial-only';
export type EditFormat = 'whole' | 'diff' | 'udiff' | 'diff-fenced' | 'patch';
export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high' | 'auto';
export type QualityTier = 'excellent' | 'strong' | 'usable' | 'experimental' | 'unsupported';
export type DetectionSource = 'name-regex' | 'metadata' | 'bench';

export interface DetectionTraceEntry {
  source: DetectionSource;
  field: string;
  value: string | number | boolean | string[] | null;
  reason: string;
}

export interface ModelOptimalOptions {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
  presence_penalty: number;
  num_ctx: number;
  num_predict: number;
  keep_alive: number | '-1' | string;
  stop: string[];
}

export interface ModelProfile {
  id: string;
  digest: string;
  family: string;
  parameter_size: string;
  quantization: string;
  capabilities: string[];
  supports_native_tools: boolean;
  supports_thinking: boolean;
  supports_json_schema: boolean;
  tool_format: ToolFormat;
  parallel_tool_calls: ParallelToolCalls;
  optimal_options: ModelOptimalOptions;
  context_window: number;
  context_window_max: number;
  edit_format: EditFormat;
  agent_loop_style: string;
  reasoning_default: ReasoningLevel;
  reasoning_levels?: {
    default: Exclude<ReasoningLevel, 'auto'>;
    tool_turns: Exclude<ReasoningLevel, 'auto'>;
    hard_tasks: Exclude<ReasoningLevel, 'auto'>;
  };
  system_prompt_template: string;
  tool_call_reliability: number;
  tool_quality_tier: QualityTier;
  coding_quality_tier: QualityTier;
  eval_tps_estimate: number;
  cold_start_ms: number;
  known_strengths: string[];
  known_weaknesses: string[];
  detection_trace: DetectionTraceEntry[];
}

export function getCompactionThreshold(profile: Pick<ModelProfile, 'context_window'>): number {
  return Math.floor(profile.context_window * 0.85);
}

export const GPT_OSS_PROFILE: ModelProfile = {
  id: 'gpt-oss',
  digest: 'prior:gpt-oss',
  family: 'gpt-oss',
  parameter_size: '20b',
  quantization: 'unknown',
  capabilities: ['coding', 'tool-calling', 'json', 'reasoning', 'long-context'],
  supports_native_tools: true,
  supports_thinking: true,
  supports_json_schema: true,
  tool_format: 'native-json',
  parallel_tool_calls: 'serial-only',
  optimal_options: {
    temperature: 1.0,
    top_p: 1.0,
    top_k: 0,
    min_p: 0,
    repeat_penalty: 1.0,
    presence_penalty: 0,
    num_ctx: 32768,
    num_predict: 4096,
    keep_alive: '24h',
    stop: [],
  },
  context_window: 32768,
  context_window_max: 131072,
  edit_format: 'diff',
  agent_loop_style: 'native-tools',
  reasoning_default: 'auto',
  reasoning_levels: {
    default: 'medium',
    tool_turns: 'low',
    hard_tasks: 'high',
  },
  system_prompt_template: 'coding-agent-native-tools-v2',
  tool_call_reliability: 0.78,
  tool_quality_tier: 'usable',
  coding_quality_tier: 'strong',
  eval_tps_estimate: 28,
  cold_start_ms: 18000,
  known_strengths: ['native Ollama tool_calls', 'large edits with SEARCH/REPLACE', 'reasoning-gated refactors'],
  known_weaknesses: ['priors must be replaced by digest benchmark', 'parallel calls start conservative until measured'],
  detection_trace: [
    {
      source: 'name-regex',
      field: 'tool_format',
      value: 'native-json',
      reason: 'GPT-OSS harmony channels are parsed by Ollama into native tool_calls.',
    },
    {
      source: 'name-regex',
      field: 'edit_format',
      value: 'diff',
      reason: 'GPT-OSS handles SEARCH/REPLACE reliably; patch is reserved for GPT-4.1-class profiles.',
    },
  ],
};

export const QWEN3_CODER_PROFILE: ModelProfile = {
  id: 'qwen3-coder',
  digest: 'prior:qwen3-coder',
  family: 'qwen3',
  parameter_size: '30b-a3b',
  quantization: 'unknown',
  capabilities: ['coding', 'xml-tools', 'thinking', 'long-context'],
  supports_native_tools: false,
  supports_thinking: true,
  supports_json_schema: true,
  tool_format: 'qwen3-xml',
  parallel_tool_calls: 'serial-only',
  optimal_options: {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1.0,
    presence_penalty: 1.5,
    num_ctx: 32768,
    num_predict: 4096,
    keep_alive: '24h',
    stop: [],
  },
  context_window: 32768,
  context_window_max: 262144,
  edit_format: 'diff',
  agent_loop_style: 'xml-tools',
  reasoning_default: 'medium',
  system_prompt_template: 'coding-agent-qwen3-xml-v2',
  tool_call_reliability: 0.66,
  tool_quality_tier: 'usable',
  coding_quality_tier: 'strong',
  eval_tps_estimate: 18,
  cold_start_ms: 26000,
  known_strengths: ['repository-scale coding', 'explicit thinking mode', 'SEARCH/REPLACE edits'],
  known_weaknesses: ['native JSON tools are not assumed', 'unified diffs break too often for local runtime default'],
  detection_trace: [
    {
      source: 'name-regex',
      field: 'edit_format',
      value: 'diff',
      reason: 'Local Qwen3-Coder defaults to SEARCH/REPLACE rather than unified diff.',
    },
  ],
};

export const GEMMA_PROFILE: ModelProfile = {
  id: 'gemma-3-4',
  digest: 'prior:gemma',
  family: 'gemma',
  parameter_size: '27b',
  quantization: 'unknown',
  capabilities: ['chat', 'coding', 'json'],
  supports_native_tools: false,
  supports_thinking: false,
  supports_json_schema: true,
  tool_format: 'json-schema-fallback',
  parallel_tool_calls: 'serial-only',
  optimal_options: {
    temperature: 0.2,
    top_p: 0.95,
    top_k: 64,
    min_p: 0,
    repeat_penalty: 1.0,
    presence_penalty: 0,
    num_ctx: 32768,
    num_predict: 4096,
    keep_alive: '24h',
    stop: [],
  },
  context_window: 32768,
  context_window_max: 131072,
  edit_format: 'diff',
  agent_loop_style: 'json-schema-fallback',
  reasoning_default: 'none',
  system_prompt_template: 'coding-agent-json-schema-fallback-v2',
  tool_call_reliability: 0.44,
  tool_quality_tier: 'experimental',
  coding_quality_tier: 'usable',
  eval_tps_estimate: 22,
  cold_start_ms: 22000,
  known_strengths: ['low-temperature code explanation', 'structured JSON fallback when prompted'],
  known_weaknesses: ['plain gemma3 lacks native function calling unless metadata proves tools capability'],
  detection_trace: [
    {
      source: 'name-regex',
      field: 'tool_format',
      value: 'json-schema-fallback',
      reason: 'Gemma native tool support is metadata-gated; plain gemma3 is not trusted by name.',
    },
  ],
};

export const DOLPHIN_MISTRAL_24B_PROFILE: ModelProfile = {
  id: 'venice-dolphin-mistral-24b',
  digest: 'prior:venice-dolphin-mistral-24b',
  family: 'mistral',
  parameter_size: '24b',
  quantization: 'unknown',
  capabilities: ['coding', 'react-text-tools', 'low-temperature-edits'],
  supports_native_tools: false,
  supports_thinking: false,
  supports_json_schema: false,
  tool_format: 'react-text',
  parallel_tool_calls: 'serial-only',
  optimal_options: {
    temperature: 0.08,
    top_p: 0.9,
    top_k: 40,
    min_p: 0,
    repeat_penalty: 1.05,
    presence_penalty: 0,
    num_ctx: 32768,
    num_predict: 4096,
    keep_alive: '24h',
    stop: [],
  },
  context_window: 32768,
  context_window_max: 65536,
  edit_format: 'whole',
  agent_loop_style: 'react-text',
  reasoning_default: 'none',
  system_prompt_template: 'coding-agent-react-text-v2',
  tool_call_reliability: 0.42,
  tool_quality_tier: 'experimental',
  coding_quality_tier: 'usable',
  eval_tps_estimate: 16,
  cold_start_ms: 28000,
  known_strengths: ['low-temperature whole-file coding', 'clear prose around edits'],
  known_weaknesses: ['tool calling requires ReAct text parsing', 'temperature should stay in the 0.05-0.1 range'],
  detection_trace: [
    {
      source: 'name-regex',
      field: 'coding_quality_tier',
      value: 'usable',
      reason: 'Coding quality is separate from experimental ReAct tool-call reliability.',
    },
  ],
};

export const TARGET_MODEL_PROFILES: Record<string, ModelProfile> = {
  [GPT_OSS_PROFILE.id]: GPT_OSS_PROFILE,
  [QWEN3_CODER_PROFILE.id]: QWEN3_CODER_PROFILE,
  [GEMMA_PROFILE.id]: GEMMA_PROFILE,
  [DOLPHIN_MISTRAL_24B_PROFILE.id]: DOLPHIN_MISTRAL_24B_PROFILE,
};

export function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    capabilities: [...profile.capabilities],
    optimal_options: { ...profile.optimal_options, stop: [...profile.optimal_options.stop] },
    reasoning_levels: profile.reasoning_levels ? { ...profile.reasoning_levels } : undefined,
    known_strengths: [...profile.known_strengths],
    known_weaknesses: [...profile.known_weaknesses],
    detection_trace: profile.detection_trace.map((entry) => ({ ...entry })),
  };
}
