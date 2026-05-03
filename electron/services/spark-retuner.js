/**
 * Spark runtime retuner.
 *
 * Phase C scaffold: decides whether a MoE recipe should move one expert group
 * toward GPU-side or CPU-side tensor placement based on live TPS and memory.
 * The llamacpp-spark backend consumes the recommendation on the next server
 * restart; we do not hot-rewrite a running llama.cpp context yet.
 */

function recommendExpertShift({ tokensPerSecond = 0, referenceTokensPerSecond = 0, memoryPressure = 0, currentGpuExperts = 0, minGpuExperts = 0, maxGpuExperts = 0 } = {}) {
  const tps = Number(tokensPerSecond || 0);
  const reference = Number(referenceTokensPerSecond || 0);
  const pressure = Number(memoryPressure || 0);
  const current = Number(currentGpuExperts || 0);

  if (pressure > 88 && current > minGpuExperts) {
    return {
      action: 'shift_to_cpu',
      nextGpuExperts: current - 1,
      reason: 'Unified memory pressure is high.',
    };
  }

  if (reference > 0 && tps > 0 && tps < reference * 0.8 && pressure < 75 && current < maxGpuExperts) {
    return {
      action: 'shift_to_gpu',
      nextGpuExperts: current + 1,
      reason: 'Throughput is below reference and memory has headroom.',
    };
  }

  return {
    action: 'hold',
    nextGpuExperts: current,
    reason: 'Current tensor placement is within guardrails.',
  };
}

module.exports = {
  recommendExpertShift,
};
