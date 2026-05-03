const { inspectMoE } = require('./moe-detector');
const { resolveSparkMoeProfile } = require('./families/spark-moe-profiles');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bytesToGiB(bytes) {
  return Number(bytes || 0) / (1024 ** 3);
}

function parseParamBillions(value = '') {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*b/i);
  return match ? Number(match[1]) : null;
}

function bytesPerParamForQuant(quant = '') {
  const q = String(quant || '').toLowerCase();
  if (q.includes('mxfp4') || q.includes('q4') || q.includes('iq4')) return 0.58;
  if (q.includes('q5') || q.includes('iq5')) return 0.72;
  if (q.includes('q6')) return 0.86;
  if (q.includes('q8')) return 1.06;
  if (q.includes('f16') || q.includes('bf16')) return 2.0;
  if (q.includes('f32')) return 4.0;
  return 0.75;
}

function kvBytesForType(kvType = 'q4_0') {
  const kv = String(kvType || '').toLowerCase();
  if (kv.includes('q4')) return 0.55;
  if (kv.includes('q5')) return 0.7;
  if (kv.includes('q8')) return 1.0;
  if (kv.includes('f16') || kv.includes('fp16') || kv.includes('bf16')) return 2.0;
  return 0.55;
}

function firstModelInfoNumber(modelInfo = {}, fragments = []) {
  for (const [key, value] of Object.entries(modelInfo || {})) {
    const lower = String(key || '').toLowerCase();
    if (!fragments.every((fragment) => lower.includes(fragment))) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function estimateKvGiB(showData = {}, options = {}) {
  const modelInfo = showData?.model_info || {};
  const layers = firstModelInfoNumber(modelInfo, ['block', 'count'])
    || firstModelInfoNumber(modelInfo, ['layer', 'count'])
    || 48;
  const heads = firstModelInfoNumber(modelInfo, ['attention', 'head', 'count'])
    || firstModelInfoNumber(modelInfo, ['head_count'])
    || 32;
  const headDim = firstModelInfoNumber(modelInfo, ['attention', 'head', 'dimension'])
    || firstModelInfoNumber(modelInfo, ['embedding', 'length'])
    || 128;
  const ctx = Math.max(256, Number(options.num_ctx || options.contextLength || 4096));
  const bytesPer = kvBytesForType(options.kv_cache_type || 'q4_0');
  const kvBytes = layers * heads * headDim * 2 * ctx * bytesPer;
  return kvBytes / (1024 ** 3);
}

function estimateWeightsGiB({ model = {}, showData = {}, quant = null } = {}) {
  if (Number.isFinite(Number(model.sizeBytes)) && Number(model.sizeBytes) > 0) {
    return bytesToGiB(Number(model.sizeBytes));
  }
  const details = showData?.details || {};
  const paramText = details.parameter_size || model.parameterSize || model.params || model.name || model.model || model.title || '';
  const paramsB = parseParamBillions(paramText) || parseParamBillions(model.name || model.model || model.title || '');
  if (!paramsB) return null;
  const bytesPer = bytesPerParamForQuant(quant || details.quantization_level || model.quantization || model.quantizationLevel);
  return (paramsB * 1e9 * bytesPer) / (1024 ** 3);
}

function estimateSparkRequirement(model = {}, options = {}) {
  const showData = options.showData || model.showData || {};
  const quant = options.quantization || model.quantization || model.quantizationLevel || showData?.details?.quantization_level || '';
  const modelName = model.name || model.model || model.title || options.modelName || '';
  const moe = options.moe || model.moe || inspectMoE(showData, modelName);
  const sparkProfile = resolveSparkMoeProfile(modelName, { level: options.profileLevel || 'stable' });
  const weightsGiB = estimateWeightsGiB({ model, showData, quant }) || Number(model.expectedRamGiB || model.requiredGiB || 0) || null;
  const effectiveOptions = {
    num_ctx: options.num_ctx || sparkProfile?.num_ctx || 4096,
    kv_cache_type: options.kv_cache_type || sparkProfile?.kv_cache_type || 'q4_0',
  };
  const kvGiB = estimateKvGiB(showData, effectiveOptions);
  const workingGiB = Math.max(2, Number(weightsGiB || 0) * 0.05);
  const moeOverheadGiB = moe?.isMoE ? Math.max(1.5, Number(weightsGiB || 0) * 0.03) : 0;
  const totalGiB = Number(weightsGiB || 0) > 0
    ? Number(weightsGiB || 0) + kvGiB + workingGiB + moeOverheadGiB
    : null;
  return {
    modelName,
    isMoE: Boolean(moe?.isMoE),
    moe,
    profile: sparkProfile || null,
    weightsGiB,
    kvGiB,
    workingGiB,
    moeOverheadGiB,
    totalGiB,
    options: effectiveOptions,
    quantization: quant || null,
  };
}

function buildFitVerdict(requirement, availableGiB, reserveRatio = 0.85) {
  const total = Number(requirement?.totalGiB || 0);
  const available = Number(availableGiB || 0);
  if (!Number.isFinite(total) || total <= 0) {
    return {
      label: 'unknown',
      canRunNow: null,
      message: 'No reliable Spark memory estimate is available yet.',
      guidance: 'Open details to inspect the model metadata.',
    };
  }
  if (!Number.isFinite(available) || available <= 0) {
    return {
      label: 'unknown',
      canRunNow: null,
      message: `Estimated Spark requirement: about ${total.toFixed(1)} GiB.`,
      guidance: 'DevForge could not read MemAvailable from this system.',
    };
  }
  const safeAvailable = available * reserveRatio;
  const margin = safeAvailable - total;
  if (margin < 0) {
    return {
      label: 'blocked',
      canRunNow: false,
      score: 15,
      message: `This model needs about ${total.toFixed(1)} GiB with Spark safety reserve. You currently have ${available.toFixed(1)} GiB available.`,
      guidance: 'Stop other models, close heavy apps, or reduce context before launching.',
      marginGiB: margin,
    };
  }
  return {
    label: margin >= 20 ? 'excellent' : margin >= 8 ? 'good' : 'tight',
    canRunNow: true,
    score: margin >= 20 ? 95 : margin >= 8 ? 80 : 60,
    message: `Estimated Spark requirement: ${total.toFixed(1)} GiB. Safety-adjusted headroom: ${margin.toFixed(1)} GiB.`,
    guidance: margin < 8 ? 'Use the stable profile and avoid loading another model.' : 'Safe to launch.',
    marginGiB: margin,
  };
}

module.exports = {
  bytesPerParamForQuant,
  estimateKvGiB,
  estimateSparkRequirement,
  buildFitVerdict,
};
