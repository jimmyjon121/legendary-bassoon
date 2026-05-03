/**
 * Core model resolver boundary.
 *
 * The optimizer implementation still lives in `src/services/modelOptimizer.js`
 * for compatibility, but consumers should import through this module when
 * they need model family detection, defaults, or Ollama option shaping.
 */

export {
  MODEL_FAMILIES,
  QUANTIZATION_PROFILES,
  SIZE_PROFILES,
  buildOptimizedOllamaOptions,
  buildOptimizedOllamaOptionsWithInfo,
  describeSettings,
  estimateVRAMUsage,
  getOptimalSettings,
  isThinkingModel,
  parseModelName,
} from '../services/modelOptimizer';
