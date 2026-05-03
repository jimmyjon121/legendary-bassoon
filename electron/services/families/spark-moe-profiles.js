const PROFILES = {
  'gpt-oss-120b': {
    match: [/gpt[-_]?oss.*120/i],
    family: 'gpt-oss',
    totalExperts: 128,
    activeExperts: 4,
    stable: { num_ctx: 4096, num_batch: 48, kv_cache_type: 'q4_0', num_predict: 768, minMemGiB: 70, recommendedMemGiB: 95 },
    recommended: { num_ctx: 8192, num_batch: 64, kv_cache_type: 'q4_0', num_predict: 1024, minMemGiB: 80, recommendedMemGiB: 105 },
    aggressive: { num_ctx: 12288, num_batch: 96, kv_cache_type: 'q4_0', num_predict: 1536, minMemGiB: 95, recommendedMemGiB: 118 },
  },
  'mixtral-8x7b': {
    match: [/mixtral.*8x7/i],
    family: 'mixtral',
    totalExperts: 8,
    activeExperts: 2,
    stable: { num_ctx: 8192, num_batch: 96, kv_cache_type: 'q8_0', num_predict: 1024, minMemGiB: 26, recommendedMemGiB: 36 },
    recommended: { num_ctx: 16384, num_batch: 128, kv_cache_type: 'q8_0', num_predict: 1536, minMemGiB: 30, recommendedMemGiB: 42 },
    aggressive: { num_ctx: 32768, num_batch: 160, kv_cache_type: 'q8_0', num_predict: 2048, minMemGiB: 38, recommendedMemGiB: 54 },
  },
  'mixtral-8x22b': {
    match: [/mixtral.*8x22/i],
    family: 'mixtral',
    totalExperts: 8,
    activeExperts: 2,
    stable: { num_ctx: 8192, num_batch: 64, kv_cache_type: 'q4_0', num_predict: 1024, minMemGiB: 80, recommendedMemGiB: 110 },
    recommended: { num_ctx: 16384, num_batch: 96, kv_cache_type: 'q4_0', num_predict: 1536, minMemGiB: 90, recommendedMemGiB: 120 },
    aggressive: { num_ctx: 24576, num_batch: 128, kv_cache_type: 'q4_0', num_predict: 2048, minMemGiB: 105, recommendedMemGiB: 128 },
  },
  'qwen2-57b-a14b': {
    match: [/qwen.*57b.*a14b/i, /qwen.*a14b/i],
    family: 'qwen-moe',
    totalExperts: 64,
    activeExperts: 8,
    stable: { num_ctx: 8192, num_batch: 96, kv_cache_type: 'q8_0', num_predict: 1024, minMemGiB: 40, recommendedMemGiB: 56 },
    recommended: { num_ctx: 16384, num_batch: 128, kv_cache_type: 'q8_0', num_predict: 1536, minMemGiB: 48, recommendedMemGiB: 64 },
    aggressive: { num_ctx: 32768, num_batch: 160, kv_cache_type: 'q4_0', num_predict: 2048, minMemGiB: 60, recommendedMemGiB: 82 },
  },
};

function resolveSparkMoeProfile(modelName = '', options = {}) {
  const level = ['stable', 'recommended', 'aggressive'].includes(options.level)
    ? options.level
    : 'recommended';
  const entry = Object.entries(PROFILES).find(([, profile]) => profile.match.some((pattern) => pattern.test(modelName)));
  if (!entry) return null;
  const [id, profile] = entry;
  return {
    id,
    family: profile.family,
    totalExperts: profile.totalExperts,
    activeExperts: profile.activeExperts,
    level,
    ...profile[level],
    stable: profile.stable,
    recommended: profile.recommended,
    aggressive: profile.aggressive,
  };
}

function listSparkMoeProfiles() {
  return Object.entries(PROFILES).map(([id, profile]) => ({
    id,
    family: profile.family,
    totalExperts: profile.totalExperts,
    activeExperts: profile.activeExperts,
    stable: profile.stable,
    recommended: profile.recommended,
    aggressive: profile.aggressive,
  }));
}

module.exports = {
  resolveSparkMoeProfile,
  listSparkMoeProfiles,
};
