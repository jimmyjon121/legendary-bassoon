const LlamaCppSparkBackend = require('./backends/llamacpp-spark-backend');
const { detectSparkProfile } = require('./spark-profile');
const { inspectMoE } = require('./moe-detector');

async function detectAndApplySparkProfile({ store } = {}) {
  const sparkProfile = await detectSparkProfile();
  if (sparkProfile?.isSpark && !store?.get?.('performanceProfileUserSet')) {
    store?.set?.('performanceProfile', 'spark');
    return { sparkProfile, performanceProfile: 'spark' };
  }
  return { sparkProfile, performanceProfile: null };
}

function registerSparkBackend({ backends, sparkProfile, store, primaryGpu }) {
  if (!sparkProfile?.isSpark || !backends) return false;
  const sparkEndpoint = store?.get?.('llamaCppSparkEndpoint') || 'http://127.0.0.1:11500';
  backends.set('llamacpp-spark', new LlamaCppSparkBackend({
    endpoint: sparkEndpoint,
    device: primaryGpu?.name || 'NVIDIA GB10 unified memory',
    priority: 0,
  }));
  return true;
}

async function trySelectSparkMoeBackend({
  sparkProfile,
  backends,
  payload,
  safeBackendHealth,
  buildDecision,
  rejectedCandidates,
  order,
} = {}) {
  const moeInfo = inspectMoE(payload?.modelInfo || {}, payload?.model || '');
  if (!sparkProfile?.isSpark || !moeInfo?.isMoE || !backends?.has?.('llamacpp-spark')) {
    return null;
  }

  const sparkBackend = backends.get('llamacpp-spark');
  const health = await safeBackendHealth(sparkBackend);
  if (health.available) {
    return {
      backend: sparkBackend,
      fallbackReason: null,
      decisionEvidence: buildDecision({
        selectedBackend: sparkBackend.id,
        fallbackReason: null,
        candidateOrder: ['llamacpp-spark', ...(order || [])],
        scored: [{ backendId: sparkBackend.id, score: 100, index: 0 }],
        rejected: rejectedCandidates,
        selectionSource: 'spark-moe',
        extra: { moe: moeInfo },
      }),
    };
  }

  rejectedCandidates.push({
    backendId: sparkBackend.id,
    reason: 'spark_moe_backend_unavailable',
    healthStatus: health?.status || 'unavailable',
    error: health?.error || null,
  });
  return null;
}

module.exports = {
  detectAndApplySparkProfile,
  registerSparkBackend,
  trySelectSparkMoeBackend,
};
