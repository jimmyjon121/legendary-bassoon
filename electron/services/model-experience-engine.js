/**
 * Model Experience Engine - Core Engine
 * 
 * Analyzes models and provides optimized inference parameters
 * to prevent hallucinations and ensure high-quality output.
 */

const path = require('path');
const fs = require('fs');

// Model family signatures for detection
const MODEL_SIGNATURES = {
  // Llama family
  llama: {
    patterns: ['llama', 'alpaca', 'vicuna', 'wizard', 'mythomax', 'nous-hermes'],
    defaults: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 4096,
    },
    antiHallucination: {
      temperature: 0.4,
      top_p: 0.8,
      top_k: 30,
      repeat_penalty: 1.15,
    }
  },
  
  // Mistral/Mixtral family
  mistral: {
    patterns: ['mistral', 'mixtral', 'dolphin', 'openhermes', 'hermes'],
    defaults: {
      temperature: 0.7,
      top_p: 0.95,
      top_k: 50,
      repeat_penalty: 1.05,
      num_ctx: 8192,
    },
    antiHallucination: {
      temperature: 0.3,
      top_p: 0.85,
      top_k: 25,
      repeat_penalty: 1.1,
    }
  },
  
  // Phi family (Microsoft)
  phi: {
    patterns: ['phi', 'phi2', 'phi-2', 'phi3', 'phi-3'],
    defaults: {
      temperature: 0.5,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 4096,
    },
    antiHallucination: {
      temperature: 0.2,
      top_p: 0.8,
      top_k: 20,
      repeat_penalty: 1.15,
    }
  },
  
  // Qwen family
  qwen: {
    patterns: ['qwen', 'qwen2'],
    defaults: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.05,
      num_ctx: 8192,
    },
    antiHallucination: {
      temperature: 0.3,
      top_p: 0.85,
      top_k: 25,
      repeat_penalty: 1.1,
    }
  },
  
  // Code models
  code: {
    patterns: ['codellama', 'code', 'starcoder', 'deepseek-coder', 'codegemma'],
    defaults: {
      temperature: 0.2,
      top_p: 0.95,
      top_k: 50,
      repeat_penalty: 1.0,
      num_ctx: 16384,
    },
    antiHallucination: {
      temperature: 0.1,
      top_p: 0.9,
      top_k: 20,
      repeat_penalty: 1.05,
    }
  },
  
  // Uncensored/NSFW models - need special handling
  uncensored: {
    patterns: ['uncensored', 'abliterated', 'nsfw', 'dolphin', 'wizard-vicuna-uncensored', 'mlewd', 'xwin'],
    defaults: {
      temperature: 0.5,
      top_p: 0.8,
      top_k: 30,
      repeat_penalty: 1.2,
      num_ctx: 4096,
    },
    antiHallucination: {
      temperature: 0.3,
      top_p: 0.7,
      top_k: 20,
      repeat_penalty: 1.25,
    }
  },
  
  // Gemma family
  gemma: {
    patterns: ['gemma', 'gemma2'],
    defaults: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 8192,
    },
    antiHallucination: {
      temperature: 0.3,
      top_p: 0.85,
      top_k: 25,
      repeat_penalty: 1.15,
    }
  },
  
  // Default/unknown models
  chat: {
    patterns: [],
    defaults: {
      temperature: 0.5,
      top_p: 0.85,
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 4096,
    },
    antiHallucination: {
      temperature: 0.3,
      top_p: 0.75,
      top_k: 25,
      repeat_penalty: 1.15,
    }
  }
};

// Primary strength detection
const STRENGTH_PATTERNS = {
  code: ['code', 'coder', 'starcoder', 'codellama', 'deepseek-coder'],
  creative: ['mythomax', 'creative', 'story', 'roleplay', 'rp'],
  reasoning: ['wizard', 'nous', 'hermes', 'orca', 'platypus'],
  chat: ['chat', 'instruct', 'assistant', 'vicuna', 'alpaca'],
  math: ['math', 'llemma', 'mathstral'],
};

// Capability scoring
const CAPABILITY_WEIGHTS = {
  code: { code: 1.0, creative: 0.4, chat: 0.6, reasoning: 0.7, math: 0.5 },
  creative: { code: 0.3, creative: 1.0, chat: 0.8, reasoning: 0.5, math: 0.3 },
  reasoning: { code: 0.6, creative: 0.6, chat: 0.8, reasoning: 1.0, math: 0.7 },
  chat: { code: 0.5, creative: 0.7, chat: 1.0, reasoning: 0.6, math: 0.4 },
  math: { code: 0.6, creative: 0.3, chat: 0.5, reasoning: 0.8, math: 1.0 },
};

/**
 * Model Experience Engine - Singleton instance
 */
class ModelExperienceEngine {
  constructor() {
    this.signatures = MODEL_SIGNATURES;
    this.currentProfile = null;
    this.antiHallucinationMode = true; // Default to safer settings
  }

  /**
   * Detect model family from filename/path
   */
  detectModelFamily(modelPath) {
    const name = modelPath.toLowerCase();
    
    // Check uncensored first (special handling)
    if (MODEL_SIGNATURES.uncensored.patterns.some(p => name.includes(p))) {
      return 'uncensored';
    }
    
    // Check code models
    if (MODEL_SIGNATURES.code.patterns.some(p => name.includes(p))) {
      return 'code';
    }
    
    // Check other families
    for (const [family, config] of Object.entries(MODEL_SIGNATURES)) {
      if (family === 'chat' || family === 'uncensored' || family === 'code') continue;
      if (config.patterns.some(p => name.includes(p))) {
        return family;
      }
    }
    
    return 'chat'; // Default fallback
  }

  /**
   * Detect primary strength from model name
   */
  detectPrimaryStrength(modelPath) {
    const name = modelPath.toLowerCase();
    
    for (const [strength, patterns] of Object.entries(STRENGTH_PATTERNS)) {
      if (patterns.some(p => name.includes(p))) {
        return strength;
      }
    }
    
    return 'chat';
  }

  /**
   * Get capability scores based on model family and strength
   */
  getCapabilities(family, primaryStrength) {
    const baseWeights = CAPABILITY_WEIGHTS[primaryStrength] || CAPABILITY_WEIGHTS.chat;
    
    // Adjust for family-specific traits
    const capabilities = { ...baseWeights };
    
    // Uncensored models: boost creative, reduce code confidence
    if (family === 'uncensored') {
      capabilities.creative = Math.min(1.0, capabilities.creative + 0.2);
      capabilities.code = Math.max(0.2, capabilities.code - 0.2);
    }
    
    // Code models: boost code and reasoning
    if (family === 'code') {
      capabilities.code = 1.0;
      capabilities.reasoning = Math.min(1.0, capabilities.reasoning + 0.2);
    }
    
    return capabilities;
  }

  /**
   * Get optimized inference parameters for a model
   */
  getInferenceParams(modelPath, options = {}) {
    const family = this.detectModelFamily(modelPath);
    const config = MODEL_SIGNATURES[family] || MODEL_SIGNATURES.chat;
    
    // Use anti-hallucination settings by default for better output quality
    const baseParams = this.antiHallucinationMode 
      ? { ...config.defaults, ...config.antiHallucination }
      : config.defaults;
    
    // Apply any user overrides
    return {
      ...baseParams,
      ...(options.overrides || {}),
    };
  }

  /**
   * Analyze a model and return full experience profile
   */
  analyzeModel(modelPath) {
    const filename = path.basename(modelPath);
    const family = this.detectModelFamily(modelPath);
    const primaryStrength = this.detectPrimaryStrength(modelPath);
    const capabilities = this.getCapabilities(family, primaryStrength);
    const inferenceParams = this.getInferenceParams(modelPath);
    
    // Detect quantization
    let quantization = 'unknown';
    const quantMatch = filename.match(/q(\d+)_?(\w)?/i);
    if (quantMatch) {
      quantization = `Q${quantMatch[1]}${quantMatch[2] || ''}`.toUpperCase();
    }
    
    // Detect parameter count
    let paramCount = null;
    const paramMatch = filename.match(/(\d+)b/i);
    if (paramMatch) {
      paramCount = `${paramMatch[1]}B`;
    }

    const profile = {
      model: {
        filename,
        path: modelPath,
        family,
        quantization,
        paramCount,
      },
      primaryStrength,
      capabilities,
      inference: inferenceParams,
      promptConfig: this.getPromptConfig(family, primaryStrength),
      uiConfig: this.getUIConfig(family, primaryStrength),
    };
    
    this.currentProfile = profile;
    return profile;
  }

  /**
   * Get prompt configuration for model family
   */
  getPromptConfig(family, primaryStrength) {
    const configs = {
      uncensored: {
        systemPrefix: 'You are a helpful AI assistant. Respond directly and helpfully to the user.',
        userPrefix: '',
        assistantPrefix: '',
        stopTokens: ['</s>', '<|end|>', '<|im_end|>'],
        showChainOfThought: false,
      },
      code: {
        systemPrefix: 'You are an expert programmer. Write clean, working code.',
        userPrefix: '',
        assistantPrefix: '',
        stopTokens: ['</s>', '<|end|>', '```\n\n'],
        showChainOfThought: true,
      },
      mistral: {
        systemPrefix: '',
        userPrefix: '[INST] ',
        assistantPrefix: ' [/INST]',
        stopTokens: ['</s>', '[INST]'],
        showChainOfThought: false,
      },
      llama: {
        systemPrefix: '',
        userPrefix: '',
        assistantPrefix: '',
        stopTokens: ['</s>', '<|end_of_text|>'],
        showChainOfThought: false,
      },
      default: {
        systemPrefix: '',
        userPrefix: '',
        assistantPrefix: '',
        stopTokens: ['</s>'],
        showChainOfThought: false,
      }
    };
    
    return configs[family] || configs.default;
  }

  /**
   * Get UI configuration hints
   */
  getUIConfig(family, primaryStrength) {
    return {
      showCodeActions: primaryStrength === 'code' || family === 'code',
      showCreativeActions: primaryStrength === 'creative',
      showReasoningIndicator: primaryStrength === 'reasoning',
      recommendedView: primaryStrength === 'code' ? 'code' : 'stream',
      enableVoice: true,
      showCapabilities: true,
    };
  }

  /**
   * Check if model is good for a specific task
   */
  isGoodFor(modelPath, task) {
    const family = this.detectModelFamily(modelPath);
    const primaryStrength = this.detectPrimaryStrength(modelPath);
    const capabilities = this.getCapabilities(family, primaryStrength);
    
    const score = capabilities[task] || 0.5;
    return score >= 0.6;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      initialized: true,
      antiHallucinationMode: this.antiHallucinationMode,
      currentProfile: this.currentProfile,
      supportedFamilies: Object.keys(MODEL_SIGNATURES),
    };
  }

  /**
   * Toggle anti-hallucination mode
   */
  setAntiHallucinationMode(enabled) {
    this.antiHallucinationMode = enabled;
  }
}

// Singleton instance
let engineInstance = null;

function getModelExperienceEngine() {
  if (!engineInstance) {
    engineInstance = new ModelExperienceEngine();
  }
  return engineInstance;
}

module.exports = {
  ModelExperienceEngine,
  getModelExperienceEngine,
  MODEL_SIGNATURES,
  STRENGTH_PATTERNS,
  CAPABILITY_WEIGHTS,
};

