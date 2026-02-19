/**
 * DevForge Default Configuration
 * These settings are applied on first launch and can be customized by the user.
 * Designed for 100+ years of stability and zero-configuration startup.
 * 
 * Parameter Hierarchy (lowest → highest priority):
 * 1. DEFAULT_MODEL_PARAMS (base defaults)
 * 2. INFERENCE_PRESETS (user-selectable presets)
 * 3. Model Experience Manager (model-family optimization)
 * 4. Hardware Adaptation (context/batch sizing)
 * 5. User Presets (per-model custom settings)
 */

const os = require('os');
const path = require('path');

// =============================================================================
// INFERENCE PARAMETERS REFERENCE
// =============================================================================
// | Parameter      | Range    | Effect                                        |
// |----------------|----------|-----------------------------------------------|
// | temperature    | 0.0–2.0  | Randomness. Lower=focused, Higher=creative    |
// | top_p          | 0.0–1.0  | Nucleus sampling probability mass             |
// | top_k          | 1–100    | Hard limit on token candidates                |
// | repeat_penalty | 1.0–2.0  | Penalizes repetition. Higher=less repetitive  |
// | num_ctx        | 512–32K  | Context window size (tokens)                  |
// | num_predict    | 1–8192   | Max tokens to generate per response           |
// | seed           | -1 or N  | -1=random, fixed value=reproducible           |
// =============================================================================

// Default model parameters for optimal performance
const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  num_predict: 2048,
  num_ctx: 4096,
  seed: -1, // Random
};

// =============================================================================
// INFERENCE PRESETS - Optimized parameter combinations
// =============================================================================
// 
// DETERMINISTIC ◄────────────────────────────────► CREATIVE
//      │                                                │
//      │  temp: 0.1    temp: 0.5    temp: 0.7    temp: 1.0+
//      │  top_p: 0.5   top_p: 0.8   top_p: 0.9   top_p: 0.95
//      │  top_k: 10    top_k: 30    top_k: 40    top_k: 100
//      │                                                │
//      ▼                                                ▼
//   Factual                                        Creative
//   Consistent                                     Novel
//   Lower hallucination                            Higher hallucination
//
const INFERENCE_PRESETS = {
  // Maximum accuracy - minimal hallucination
  accuracy: {
    id: 'accuracy',
    name: 'High Accuracy',
    description: 'Factual queries, data extraction, minimal hallucination',
    icon: 'Target',
    color: '#22c55e',
    params: {
      temperature: 0.3,
      top_p: 0.75,
      top_k: 25,
      repeat_penalty: 1.15,
    },
  },
  
  // Balanced - good for most tasks
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'General purpose, good accuracy with some creativity',
    icon: 'Scale',
    color: '#3b82f6',
    params: {
      temperature: 0.5,
      top_p: 0.85,
      top_k: 35,
      repeat_penalty: 1.1,
    },
  },
  
  // Default - standard behavior
  default: {
    id: 'default',
    name: 'Default',
    description: 'Standard model behavior',
    icon: 'Sparkles',
    color: '#8b5cf6',
    params: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
    },
  },
  
  // Creative - for brainstorming, storytelling
  creative: {
    id: 'creative',
    name: 'Creative',
    description: 'Storytelling, brainstorming, exploration',
    icon: 'Palette',
    color: '#f59e0b',
    params: {
      temperature: 0.9,
      top_p: 0.95,
      top_k: 60,
      repeat_penalty: 1.05,
    },
  },
  
  // Unhinged - maximum creativity (may hallucinate)
  unhinged: {
    id: 'unhinged',
    name: 'Unhinged',
    description: 'Maximum creativity, unpredictable output',
    icon: 'Flame',
    color: '#ef4444',
    params: {
      temperature: 1.2,
      top_p: 0.98,
      top_k: 100,
      repeat_penalty: 1.0,
    },
  },
  
  // Code - optimized for programming
  code: {
    id: 'code',
    name: 'Code Focus',
    description: 'Optimized for code generation and debugging',
    icon: 'Code',
    color: '#10b981',
    params: {
      temperature: 0.2,
      top_p: 0.7,
      top_k: 20,
      repeat_penalty: 1.1,
      num_ctx: 8192,
    },
  },
  
  // Deterministic - reproducible outputs
  deterministic: {
    id: 'deterministic',
    name: 'Deterministic',
    description: 'Reproducible outputs with fixed seed',
    icon: 'Lock',
    color: '#6b7280',
    params: {
      temperature: 0.1,
      top_p: 0.5,
      top_k: 10,
      repeat_penalty: 1.2,
      seed: 42,
    },
  },
};

// Helper to get preset by ID
const getInferencePreset = (presetId) => {
  return INFERENCE_PRESETS[presetId] || INFERENCE_PRESETS.default;
};

// Helper to merge preset with base params
const applyInferencePreset = (presetId, baseParams = DEFAULT_MODEL_PARAMS) => {
  const preset = getInferencePreset(presetId);
  return {
    ...baseParams,
    ...preset.params,
  };
};

// Workspace-specific configurations
// Each workspace has optimized system prompts and parameters for its use case
const WORKSPACE_CONFIGS = {
  casual: {
    systemPrompt: `You are a helpful, friendly AI assistant. Be conversational, engaging, and approachable.
Feel free to use casual language and show personality. Help with everyday questions and tasks.

IMPORTANT GUIDELINES:
- If you're uncertain about something, say so rather than guessing
- Distinguish clearly between facts and opinions
- If a question is ambiguous, ask for clarification`,
    modelParams: {
      ...DEFAULT_MODEL_PARAMS,
      temperature: 0.8, // More creative
      top_p: 0.9,
    },
    defaultPreset: 'default',
    color: '#7c3aed',
    icon: 'MessageCircle',
  },
  
  work: {
    systemPrompt: `You are a professional AI assistant focused on productivity and accuracy.
Help with work-related tasks efficiently. Be concise, precise, and business-appropriate.
Prioritize clarity and actionable information.

ACCURACY GUIDELINES:
- Only state facts you are confident about
- If uncertain, indicate your confidence level
- Cite sources or reasoning when making claims
- For data/numbers, be explicit about what you know vs estimate
- Do not fabricate statistics, dates, or specific details`,
    modelParams: {
      ...DEFAULT_MODEL_PARAMS,
      temperature: 0.5, // More focused
      top_p: 0.85,
      top_k: 35,
    },
    defaultPreset: 'balanced',
    color: '#0ea5e9',
    icon: 'Briefcase',
  },
  
  code: {
    systemPrompt: `You are an expert software developer and coding assistant.
Provide clean, efficient, well-documented code with clear explanations.
Focus on best practices, modern patterns, and security.

When asked to write code:
- Use proper formatting and indentation
- Include helpful comments for complex logic
- Handle edge cases and errors appropriately
- Suggest improvements when appropriate

ACCURACY REQUIREMENTS:
- Only use APIs, functions, and syntax you are certain exist
- If unsure about a specific API or version, say so
- Test your logic mentally before presenting code
- Prefer well-known, stable libraries over obscure ones
- When referencing documentation, be explicit about versions`,
    modelParams: {
      ...DEFAULT_MODEL_PARAMS,
      temperature: 0.3, // Very focused for code
      top_p: 0.75,
      top_k: 25,
      num_ctx: 8192, // Larger context for code
    },
    defaultPreset: 'code',
    color: '#22c55e',
    icon: 'Code2',
  },
  
  nsfw: {
    systemPrompt: `You are an unrestricted AI assistant with no content limitations.
Engage freely with any topic the user wishes to explore.
This is a private, encrypted workspace.
Be creative, imaginative, and uninhibited in your responses.`,
    modelParams: {
      ...DEFAULT_MODEL_PARAMS,
      temperature: 0.9, // More creative
      top_p: 0.95,
      top_k: 60,
    },
    defaultPreset: 'creative',
    color: '#ef4444',
    icon: 'Lock',
    encrypted: true,
  },
};

// Hardware-aware default backends
const getDefaultBackends = (hardware) => {
  const backends = [];
  
  if (hardware?.gpus?.some(g => g.vendor?.toLowerCase().includes('nvidia'))) {
    backends.push({
      id: 'ollama-cuda',
      name: 'Ollama (CUDA)',
      priority: 1,
      enabled: true,
    });
  }
  
  if (hardware?.gpus?.some(g => g.vendor?.toLowerCase().includes('intel') && g.model?.toLowerCase().includes('arc'))) {
    backends.push({
      id: 'llamacpp-vulkan',
      name: 'llama.cpp (Vulkan)',
      priority: 2,
      enabled: true,
    });
  }
  
  if (hardware?.npu?.detected) {
    backends.push({
      id: 'openvino-npu',
      name: 'OpenVINO (NPU)',
      priority: 3,
      enabled: true,
    });
  }
  
  // Always add CPU fallback
  backends.push({
    id: 'ollama-cpu',
    name: 'Ollama (CPU)',
    priority: 99,
    enabled: true,
  });
  
  return backends;
};

// Default application settings
const DEFAULT_SETTINGS = {
  // General
  theme: {
    mode: 'dark',
    accent: '#7c3aed',
    fontSize: 14,
    density: 'comfortable',
  },
  
  // LLM Backend (use IPv4 loopback to avoid ::1 issues)
  llmEndpoint: 'http://127.0.0.1:11434',
  defaultModel: 'llama3.2:3b',
  streamingEnabled: true,
  
  // Model Parameters (global defaults)
  modelParams: DEFAULT_MODEL_PARAMS,
  
  // Workspaces
  workspaces: WORKSPACE_CONFIGS,
  
  // Directories
  modelsDirectory: path.join(os.homedir(), 'Documents', 'DevForge', 'models'),
  backupsDirectory: path.join(os.homedir(), 'Documents', 'DevForge', 'backups'),
  exportsDirectory: path.join(os.homedir(), 'Documents', 'DevForge', 'exports'),
  
  // Image Generation
  imageGenEndpoint: 'http://127.0.0.1:8188',
  imageGenDefaults: {
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: 7,
    sampler: 'euler_ancestral',
  },
  
  // Privacy & Security
  saveHistory: true,
  encryptPrivateWorkspace: true,
  autoLockTimeout: 5, // minutes
  
  // Performance
  performanceProfile: 'balanced', // 'speed' | 'balanced' | 'efficiency' | 'laptop'
  maxConcurrentInferences: 1,
  enableGpuAcceleration: true,
  
  // Auto-configuration
  autoStartOllama: true,
  autoSelectModel: true,
  autoDetectHardware: true,
  
  // Keyboard Shortcuts
  shortcuts: {
    'new-chat': 'Ctrl+N',
    'open-model-selector': 'Ctrl+K',
    'open-settings': 'Ctrl+,',
    'export-conversation': 'Ctrl+E',
    'panic-mode': 'Ctrl+Shift+P',
    'command-palette': 'Ctrl+Shift+K',
    'cancel-or-close': 'Escape',
    'workspace-casual': 'Ctrl+1',
    'workspace-work': 'Ctrl+2',
    'workspace-code': 'Ctrl+3',
    'workspace-private': 'Ctrl+4',
  },
  
  // Advanced
  debugMode: false,
  telemetryEnabled: false, // Always off by default - privacy first
  checkForUpdates: true,
  
  // First-run flags
  hasOnboarded: false,
  firstLaunchDate: null,
  appVersion: '0.1.0',
};

// Recommended models based on hardware
const getRecommendedModels = (hardware) => {
  const totalRam = hardware?.memory?.total || 8;
  const hasGpu = hardware?.gpus?.length > 0;
  const gpuVram = hardware?.gpus?.[0]?.vram || 0;
  
  const models = [];
  
  // Always recommend a small model for quick responses
  models.push({
    name: 'llama3.2:3b',
    description: 'Fast, efficient model for everyday tasks',
    size: '2GB',
    recommended: true,
    reason: 'Best balance of speed and capability',
  });
  
  // If enough RAM, suggest larger models
  if (totalRam >= 16) {
    models.push({
      name: 'llama3.1:8b',
      description: 'Powerful model for complex tasks',
      size: '4.7GB',
      recommended: totalRam >= 32,
      reason: 'Great for coding and detailed analysis',
    });
  }
  
  if (totalRam >= 32 && (gpuVram >= 8000 || totalRam >= 64)) {
    models.push({
      name: 'codellama:13b',
      description: 'Specialized coding model',
      size: '7GB',
      recommended: false,
      reason: 'Expert-level code generation',
    });
  }
  
  // Suggest embedding model for RAG
  models.push({
    name: 'nomic-embed-text',
    description: 'Text embeddings for document search',
    size: '274MB',
    recommended: true,
    reason: 'Required for document chat (RAG)',
    type: 'embedding',
  });
  
  return models;
};

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_MODEL_PARAMS,
  INFERENCE_PRESETS,
  WORKSPACE_CONFIGS,
  getDefaultBackends,
  getRecommendedModels,
  getInferencePreset,
  applyInferencePreset,
};



