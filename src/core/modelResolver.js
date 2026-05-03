import modelOptimizer from '../services/modelOptimizer';

/**
 * Core model resolver boundary.
 *
 * The optimizer implementation still lives in `src/services/modelOptimizer.js`
 * for compatibility, but consumers should import through this module when
 * they need model family detection, defaults, or Ollama option shaping.
 */

export {
  MODEL_FAMILIES,
  buildOptimizedOllamaOptions,
  buildOptimizedOllamaOptionsWithInfo,
  describeSettings,
  estimateVRAMUsage,
  getOptimalSettings,
  isThinkingModel,
  parseModelName,
} from '../services/modelOptimizer';

export const QUANTIZATION_PROFILES = modelOptimizer.QUANTIZATION_PROFILES;
export const SIZE_PROFILES = modelOptimizer.SIZE_PROFILES;
