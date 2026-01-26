/**
 * Intelligent Model Optimizer
 * 
 * Automatically detects optimal settings for each model based on:
 * - Model family (llama, mistral, qwen, deepseek, phi, etc.)
 * - Parameter size (7B, 13B, 70B)
 * - Quantization level (Q4, Q5, Q8, F16)
 * - Model purpose (code, chat, creative, instruct)
 * 
 * This mimics what power users manually configure in LM Studio.
 */

// Model family profiles with optimal defaults
const MODEL_FAMILIES = {
  // Code-focused models - lower temperature, precise output
  codellama: {
    type: 'code',
    temperature: 0.3,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 16384,
    stopTokens: ['</s>', '[/INST]', '```\n\n', '\n\n\n'],
  },
  deepseek: {
    type: 'code',
    temperature: 0.2,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.05,
    maxContext: 16384,
    stopTokens: ['<|endoftext|>', '<｜end▁of▁sentence｜>'],
  },
  'deepseek-coder': {
    type: 'code',
    temperature: 0.1,
    top_p: 0.95,
    top_k: 40,
    repeat_penalty: 1.0,
    maxContext: 16384,
    stopTokens: ['<|endoftext|>', '<｜end▁of▁sentence｜>'],
  },
  starcoder: {
    type: 'code',
    temperature: 0.2,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.0,
    maxContext: 8192,
    stopTokens: ['<|endoftext|>'],
  },
  codegemma: {
    type: 'code',
    temperature: 0.2,
    top_p: 0.95,
    top_k: 40,
    repeat_penalty: 1.0,
    maxContext: 8192,
    stopTokens: ['<end_of_turn>', '<eos>'],
  },
  qwen2coder: {
    type: 'code',
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    maxContext: 32768,
    stopTokens: ['<|endoftext|>', '<|im_end|>'],
  },
  
  // General chat models - balanced settings
  llama: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>', '[/INST]'],
  },
  'llama2': {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>', '[/INST]'],
  },
  'llama3': {
    type: 'chat',
    temperature: 0.6,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<|eot_id|>', '<|end_of_text|>'],
  },
  'llama3.1': {
    type: 'chat',
    temperature: 0.6,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 131072,
    stopTokens: ['<|eot_id|>', '<|end_of_text|>'],
  },
  'llama3.2': {
    type: 'chat',
    temperature: 0.6,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 131072,
    stopTokens: ['<|eot_id|>', '<|end_of_text|>'],
  },
  mistral: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 32768,
    stopTokens: ['</s>', '[/INST]'],
  },
  mixtral: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 32768,
    stopTokens: ['</s>', '[/INST]'],
  },
  qwen: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    repeat_penalty: 1.05,
    maxContext: 32768,
    stopTokens: ['<|endoftext|>', '<|im_end|>'],
  },
  qwen2: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    repeat_penalty: 1.05,
    maxContext: 131072,
    stopTokens: ['<|endoftext|>', '<|im_end|>'],
  },
  phi: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['<|endoftext|>', '<|end|>'],
  },
  'phi3': {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 131072,
    stopTokens: ['<|end|>', '<|endoftext|>'],
  },
  gemma: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<end_of_turn>', '<eos>'],
  },
  gemma2: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<end_of_turn>', '<eos>'],
  },
  yi: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['<|endoftext|>', '<|im_end|>'],
  },
  vicuna: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>', 'USER:', 'ASSISTANT:'],
  },
  solar: {
    type: 'chat',
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>', '### User', '### Assistant'],
  },
  
  // Creative/roleplay models - higher temperature, more variety
  nous: {
    type: 'creative',
    temperature: 0.85,
    top_p: 0.95,
    top_k: 60,
    repeat_penalty: 1.15,
    maxContext: 4096,
    stopTokens: ['</s>', '[/INST]'],
  },
  'hermes': {
    type: 'creative',
    temperature: 0.8,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<|im_end|>'],
  },
  openhermes: {
    type: 'creative',
    temperature: 0.8,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<|im_end|>'],
  },
  'dolphin': {
    type: 'creative',
    temperature: 0.8,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.1,
    maxContext: 16384,
    stopTokens: ['<|im_end|>'],
  },
  neural: {
    type: 'creative',
    temperature: 0.8,
    top_p: 0.95,
    top_k: 50,
    repeat_penalty: 1.15,
    maxContext: 4096,
    stopTokens: ['</s>'],
  },
  
  // Instruct/assistant models - focused, instruction-following
  zephyr: {
    type: 'instruct',
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['</s>', '<|user|>', '<|assistant|>'],
  },
  openchat: {
    type: 'instruct',
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 8192,
    stopTokens: ['<|end_of_turn|>'],
  },
  orca: {
    type: 'instruct',
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>'],
  },
  wizard: {
    type: 'instruct',
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    maxContext: 4096,
    stopTokens: ['</s>', 'USER:', 'ASSISTANT:'],
  },
  command: {
    type: 'instruct',
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    maxContext: 4096,
    stopTokens: ['<|END_OF_TURN_TOKEN|>'],
  },
};

// Quantization affects memory and quality
const QUANTIZATION_PROFILES = {
  // High quality, high memory
  'F32': { qualityMultiplier: 1.0, memoryMultiplier: 4.0, contextScale: 0.5 },
  'F16': { qualityMultiplier: 0.99, memoryMultiplier: 2.0, contextScale: 0.7 },
  'BF16': { qualityMultiplier: 0.99, memoryMultiplier: 2.0, contextScale: 0.7 },
  
  // Balanced
  'Q8_0': { qualityMultiplier: 0.95, memoryMultiplier: 1.0, contextScale: 1.0 },
  'Q8': { qualityMultiplier: 0.95, memoryMultiplier: 1.0, contextScale: 1.0 },
  
  // Good balance of quality and memory
  'Q6_K': { qualityMultiplier: 0.92, memoryMultiplier: 0.75, contextScale: 1.2 },
  'Q5_K_M': { qualityMultiplier: 0.90, memoryMultiplier: 0.65, contextScale: 1.3 },
  'Q5_K_S': { qualityMultiplier: 0.88, memoryMultiplier: 0.6, contextScale: 1.4 },
  'Q5_1': { qualityMultiplier: 0.89, memoryMultiplier: 0.65, contextScale: 1.3 },
  'Q5_0': { qualityMultiplier: 0.87, memoryMultiplier: 0.6, contextScale: 1.4 },
  
  // Memory efficient, some quality loss
  'Q4_K_M': { qualityMultiplier: 0.85, memoryMultiplier: 0.5, contextScale: 1.5 },
  'Q4_K_S': { qualityMultiplier: 0.82, memoryMultiplier: 0.45, contextScale: 1.6 },
  'Q4_1': { qualityMultiplier: 0.83, memoryMultiplier: 0.5, contextScale: 1.5 },
  'Q4_0': { qualityMultiplier: 0.80, memoryMultiplier: 0.45, contextScale: 1.6 },
  
  // Very memory efficient
  'Q3_K_M': { qualityMultiplier: 0.75, memoryMultiplier: 0.4, contextScale: 1.8 },
  'Q3_K_S': { qualityMultiplier: 0.72, memoryMultiplier: 0.35, contextScale: 2.0 },
  'Q2_K': { qualityMultiplier: 0.65, memoryMultiplier: 0.3, contextScale: 2.2 },
  
  // IQuants
  'IQ4_XS': { qualityMultiplier: 0.84, memoryMultiplier: 0.45, contextScale: 1.6 },
  'IQ3_M': { qualityMultiplier: 0.74, memoryMultiplier: 0.38, contextScale: 1.9 },
  'IQ3_S': { qualityMultiplier: 0.72, memoryMultiplier: 0.35, contextScale: 2.0 },
  'IQ2_M': { qualityMultiplier: 0.60, memoryMultiplier: 0.28, contextScale: 2.3 },
  'IQ2_S': { qualityMultiplier: 0.55, memoryMultiplier: 0.25, contextScale: 2.5 },
};

// Model size affects context and batch settings
const SIZE_PROFILES = {
  '0.5B': { contextDefault: 2048, batchSize: 512, gpuLayers: -1 },
  '1B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1 },
  '1.5B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1 },
  '2B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1 },
  '3B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1 },
  '4B': { contextDefault: 4096, batchSize: 256, gpuLayers: -1 },
  '7B': { contextDefault: 4096, batchSize: 256, gpuLayers: -1 },
  '8B': { contextDefault: 8192, batchSize: 256, gpuLayers: -1 },
  '9B': { contextDefault: 8192, batchSize: 256, gpuLayers: -1 },
  '13B': { contextDefault: 4096, batchSize: 128, gpuLayers: 35 },
  '14B': { contextDefault: 4096, batchSize: 128, gpuLayers: 35 },
  '20B': { contextDefault: 4096, batchSize: 64, gpuLayers: 30 },
  '30B': { contextDefault: 4096, batchSize: 64, gpuLayers: 25 },
  '32B': { contextDefault: 4096, batchSize: 64, gpuLayers: 25 },
  '34B': { contextDefault: 4096, batchSize: 64, gpuLayers: 25 },
  '70B': { contextDefault: 2048, batchSize: 32, gpuLayers: 20 },
  '72B': { contextDefault: 2048, batchSize: 32, gpuLayers: 20 },
  '405B': { contextDefault: 1024, batchSize: 16, gpuLayers: 10 },
};

/**
 * Parse model name to extract family, size, and quantization
 */
export function parseModelName(modelName) {
  if (!modelName) return { family: null, size: null, quantization: null };
  
  const name = modelName.toLowerCase();
  
  // Detect model family (check more specific patterns first)
  let family = null;
  const familyPatterns = [
    // Code models (check first - more specific)
    { pattern: /deepseek[-_]?coder/i, family: 'deepseek-coder' },
    { pattern: /qwen2[-_]?\.?5[-_]?coder/i, family: 'qwen2coder' },
    { pattern: /qwen[-_]?coder/i, family: 'qwen2coder' },
    { pattern: /code[-_]?llama/i, family: 'codellama' },
    { pattern: /codellama/i, family: 'codellama' },
    { pattern: /starcoder/i, family: 'starcoder' },
    { pattern: /code[-_]?gemma/i, family: 'codegemma' },
    
    // Versioned models (check before generic)
    { pattern: /llama[-_]?3\.2/i, family: 'llama3.2' },
    { pattern: /llama[-_]?3\.1/i, family: 'llama3.1' },
    { pattern: /llama[-_]?3/i, family: 'llama3' },
    { pattern: /llama[-_]?2/i, family: 'llama2' },
    { pattern: /phi[-_]?3/i, family: 'phi3' },
    { pattern: /gemma[-_]?2/i, family: 'gemma2' },
    { pattern: /qwen[-_]?2\.5/i, family: 'qwen2' },
    { pattern: /qwen[-_]?2/i, family: 'qwen2' },
    
    // Creative models
    { pattern: /open[-_]?hermes/i, family: 'openhermes' },
    { pattern: /hermes/i, family: 'hermes' },
    { pattern: /dolphin/i, family: 'dolphin' },
    { pattern: /nous/i, family: 'nous' },
    { pattern: /neural[-_]?chat/i, family: 'neural' },
    
    // Instruct models
    { pattern: /zephyr/i, family: 'zephyr' },
    { pattern: /open[-_]?chat/i, family: 'openchat' },
    { pattern: /orca/i, family: 'orca' },
    { pattern: /wizard/i, family: 'wizard' },
    { pattern: /command/i, family: 'command' },
    
    // Generic models (check last)
    { pattern: /llama/i, family: 'llama' },
    { pattern: /mistral/i, family: 'mistral' },
    { pattern: /mixtral/i, family: 'mixtral' },
    { pattern: /qwen/i, family: 'qwen' },
    { pattern: /deepseek/i, family: 'deepseek' },
    { pattern: /phi/i, family: 'phi' },
    { pattern: /gemma/i, family: 'gemma' },
    { pattern: /yi/i, family: 'yi' },
    { pattern: /vicuna/i, family: 'vicuna' },
    { pattern: /solar/i, family: 'solar' },
  ];
  
  for (const { pattern, family: f } of familyPatterns) {
    if (pattern.test(name)) {
      family = f;
      break;
    }
  }
  
  // Detect parameter size
  let size = null;
  const sizeMatch = name.match(/(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])/);
  if (sizeMatch) {
    const num = parseFloat(sizeMatch[1]);
    // Normalize to standard sizes
    if (num <= 0.6) size = '0.5B';
    else if (num <= 1.2) size = '1B';
    else if (num <= 1.8) size = '1.5B';
    else if (num <= 2.5) size = '2B';
    else if (num <= 3.5) size = '3B';
    else if (num <= 5) size = '4B';
    else if (num <= 7.5) size = '7B';
    else if (num <= 8.5) size = '8B';
    else if (num <= 10) size = '9B';
    else if (num <= 13.5) size = '13B';
    else if (num <= 16) size = '14B';
    else if (num <= 25) size = '20B';
    else if (num <= 31) size = '30B';
    else if (num <= 35) size = '34B';
    else if (num <= 73) size = '70B';
    else size = '405B';
  }
  
  // Detect quantization
  let quantization = null;
  const quantPatterns = [
    /[._-](F32|F16|BF16)/i,
    /[._-](Q8_0|Q8)/i,
    /[._-](Q6_K)/i,
    /[._-](Q5_K_[MSL]|Q5_[01])/i,
    /[._-](Q4_K_[MSL]|Q4_[01])/i,
    /[._-](Q3_K_[MSL])/i,
    /[._-](Q2_K)/i,
    /[._-](IQ4_XS|IQ3_[MS]|IQ2_[MS])/i,
  ];
  
  for (const pattern of quantPatterns) {
    const match = name.match(pattern);
    if (match) {
      quantization = match[1].toUpperCase();
      break;
    }
  }
  
  return { family, size, quantization };
}

/**
 * Get optimal settings for a model
 */
export function getOptimalSettings(modelName, workspaceType = 'casual') {
  const parsed = parseModelName(modelName);
  const { family, size, quantization } = parsed;
  
  // Start with defaults
  let settings = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    num_ctx: 4096,
    num_batch: 256,
    num_gpu: -1,
    stop: ['Human:', '\nHuman:', 'User:', '\nUser:'],
    // Metadata for UI/debugging
    _detected: parsed,
    _source: 'default',
  };
  
  // Apply family-specific settings
  if (family && MODEL_FAMILIES[family]) {
    const familyProfile = MODEL_FAMILIES[family];
    settings = {
      ...settings,
      temperature: familyProfile.temperature,
      top_p: familyProfile.top_p,
      top_k: familyProfile.top_k,
      repeat_penalty: familyProfile.repeat_penalty,
      num_ctx: Math.min(familyProfile.maxContext, 8192), // Start conservative
      stop: [...familyProfile.stopTokens, ...settings.stop],
      _source: `family:${family}`,
      _modelType: familyProfile.type,
    };
  }
  
  // Apply size-specific settings
  if (size && SIZE_PROFILES[size]) {
    const sizeProfile = SIZE_PROFILES[size];
    settings = {
      ...settings,
      num_ctx: Math.min(settings.num_ctx, sizeProfile.contextDefault),
      num_batch: sizeProfile.batchSize,
      num_gpu: sizeProfile.gpuLayers,
      _source: `${settings._source}+size:${size}`,
    };
  }
  
  // Apply quantization adjustments
  if (quantization && QUANTIZATION_PROFILES[quantization]) {
    const quantProfile = QUANTIZATION_PROFILES[quantization];
    // Lower quant = can use more context since model uses less memory
    const contextBoost = Math.floor(settings.num_ctx * quantProfile.contextScale);
    settings = {
      ...settings,
      num_ctx: Math.min(contextBoost, family ? MODEL_FAMILIES[family]?.maxContext || 8192 : 8192),
      _source: `${settings._source}+quant:${quantization}`,
    };
  }
  
  // Workspace-specific adjustments
  if (workspaceType === 'code') {
    // Lower temperature for code
    settings.temperature = Math.max(0.1, settings.temperature - 0.3);
    settings.top_p = Math.min(0.95, settings.top_p);
    settings._source += '+workspace:code';
  } else if (workspaceType === 'creative') {
    // Higher temperature for creative
    settings.temperature = Math.min(1.0, settings.temperature + 0.15);
    settings.top_k = Math.min(100, settings.top_k + 20);
    settings._source += '+workspace:creative';
  }
  
  // Remove duplicates from stop tokens
  settings.stop = [...new Set(settings.stop)];
  
  return settings;
}

/**
 * Estimate VRAM usage for a model
 */
export function estimateVRAMUsage(modelName, contextLength = 4096) {
  const parsed = parseModelName(modelName);
  const { size, quantization } = parsed;
  
  // Base VRAM per billion parameters (rough estimates)
  const baseVRAMPerB = {
    '0.5B': 0.5, '1B': 1, '1.5B': 1.5, '2B': 2, '3B': 3,
    '4B': 4, '7B': 7, '8B': 8, '9B': 9, '13B': 13,
    '14B': 14, '20B': 20, '30B': 30, '32B': 32, '34B': 34,
    '70B': 70, '72B': 72, '405B': 405,
  };
  
  const baseGB = baseVRAMPerB[size] || 7; // Default to 7B
  const quantMultiplier = QUANTIZATION_PROFILES[quantization]?.memoryMultiplier || 0.5;
  
  // Model weights VRAM
  const weightsVRAM = baseGB * quantMultiplier;
  
  // KV cache VRAM (rough: 2 bytes per token per layer)
  // Assuming ~32 layers for 7B, scales with size
  const layers = Math.round(baseGB * 4);
  const kvCacheGB = (contextLength * layers * 2 * 2) / (1024 * 1024 * 1024);
  
  return {
    weightsGB: weightsVRAM.toFixed(1),
    kvCacheGB: kvCacheGB.toFixed(1),
    totalGB: (weightsVRAM + kvCacheGB).toFixed(1),
    recommendedVRAM: Math.ceil(weightsVRAM + kvCacheGB + 1), // +1GB headroom
  };
}

/**
 * Get a human-readable description of the optimal settings
 */
export function describeSettings(modelName) {
  const settings = getOptimalSettings(modelName);
  const parsed = settings._detected;
  const vram = estimateVRAMUsage(modelName, settings.num_ctx);
  
  const lines = [];
  
  if (parsed.family) {
    const familyProfile = MODEL_FAMILIES[parsed.family];
    if (familyProfile) {
      const typeNames = {
        code: 'Code Generation',
        chat: 'General Chat',
        creative: 'Creative/Roleplay',
        instruct: 'Instruction Following',
      };
      lines.push(`Model type: ${typeNames[familyProfile.type] || familyProfile.type}`);
    }
  }
  
  if (parsed.size) {
    lines.push(`Parameter size: ${parsed.size}`);
  }
  
  if (parsed.quantization) {
    const quant = QUANTIZATION_PROFILES[parsed.quantization];
    const qualityPct = quant ? `${Math.round(quant.qualityMultiplier * 100)}%` : 'Unknown';
    lines.push(`Quantization: ${parsed.quantization} (${qualityPct} quality)`);
  }
  
  lines.push(`Optimal temperature: ${settings.temperature}`);
  lines.push(`Context length: ${settings.num_ctx.toLocaleString()} tokens`);
  lines.push(`Estimated VRAM: ${vram.totalGB} GB`);
  
  return {
    summary: lines.join('\n'),
    settings,
    vram,
    parsed,
  };
}

/**
 * Build optimized Ollama options for a model
 */
export function buildOptimizedOllamaOptions(modelName, workspaceType = 'casual', overrides = {}) {
  const settings = getOptimalSettings(modelName, workspaceType);
  
  return {
    temperature: overrides.temperature ?? settings.temperature,
    top_p: overrides.top_p ?? settings.top_p,
    top_k: overrides.top_k ?? settings.top_k,
    repeat_penalty: overrides.repeat_penalty ?? settings.repeat_penalty,
    num_ctx: overrides.num_ctx ?? settings.num_ctx,
    num_batch: overrides.num_batch ?? settings.num_batch,
    num_gpu: overrides.num_gpu ?? settings.num_gpu,
    stop: overrides.stop ?? settings.stop,
  };
}

export default {
  parseModelName,
  getOptimalSettings,
  estimateVRAMUsage,
  describeSettings,
  buildOptimizedOllamaOptions,
  MODEL_FAMILIES,
  QUANTIZATION_PROFILES,
  SIZE_PROFILES,
};
