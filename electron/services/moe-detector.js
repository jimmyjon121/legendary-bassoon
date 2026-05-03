function normalizeKey(key = '') {
  return String(key || '').toLowerCase();
}

function firstNumeric(modelInfo = {}, fragments = []) {
  const keys = Object.keys(modelInfo || {});
  for (const key of keys) {
    const lower = normalizeKey(key);
    if (!fragments.every((fragment) => lower.includes(fragment))) continue;
    const value = Number(modelInfo[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function inferFamilyFromName(modelName = '', family = '') {
  const lower = `${modelName} ${family}`.toLowerCase();
  if (lower.includes('gpt-oss') || lower.includes('gpt_oss')) return 'gpt-oss';
  if (lower.includes('mixtral')) return 'mixtral';
  if (lower.includes('deepseek') && /v\d|moe/.test(lower)) return 'deepseek-moe';
  if (lower.includes('qwen') && (lower.includes('moe') || /a\d+b/.test(lower))) return 'qwen-moe';
  if (lower.includes('dbrx')) return 'dbrx';
  if (lower.includes('arctic')) return 'arctic';
  return family || null;
}

function fallbackExperts(modelName = '', family = '') {
  const lower = `${modelName} ${family}`.toLowerCase();
  if (lower.includes('gpt-oss') && lower.includes('120')) return { totalExperts: 128, activeExperts: 4 };
  if (lower.includes('mixtral') && lower.includes('8x')) return { totalExperts: 8, activeExperts: 2 };
  if (lower.includes('qwen') && /a14b/.test(lower)) return { totalExperts: 64, activeExperts: 8 };
  if (lower.includes('deepseek') && lower.includes('v3')) return { totalExperts: 256, activeExperts: 8 };
  return { totalExperts: null, activeExperts: null };
}

function inspectMoE(showData = {}, modelName = '') {
  const modelInfo = showData?.model_info || {};
  const details = showData?.details || {};
  const family = inferFamilyFromName(modelName, details.family || '');
  const fallback = fallbackExperts(modelName, family || '');

  const totalExperts = (
    firstNumeric(modelInfo, ['expert', 'count']) ||
    firstNumeric(modelInfo, ['n_expert']) ||
    fallback.totalExperts
  );
  const activeExperts = (
    firstNumeric(modelInfo, ['expert', 'used']) ||
    firstNumeric(modelInfo, ['expert', 'active']) ||
    firstNumeric(modelInfo, ['n_expert_used']) ||
    fallback.activeExperts
  );
  const expertFeedForwardLength = firstNumeric(modelInfo, ['expert', 'feed', 'forward']);

  const nameLower = String(modelName || '').toLowerCase();
  const familyLower = String(family || '').toLowerCase();
  const nameSaysMoe = (
    nameLower.includes('gpt-oss') ||
    nameLower.includes('gpt_oss') ||
    nameLower.includes('mixtral') ||
    nameLower.includes('moe') ||
    nameLower.includes('dbrx') ||
    nameLower.includes('arctic') ||
    /qwen.*a\d+b/.test(nameLower)
  );
  const familySaysMoe = familyLower.includes('moe') || familyLower.includes('mixtral') || familyLower.includes('gpt-oss');
  const infoSaysMoe = Number(totalExperts || 0) > 1 || Number(activeExperts || 0) > 0;

  return {
    isMoE: Boolean(nameSaysMoe || familySaysMoe || infoSaysMoe),
    family,
    totalExperts: totalExperts || null,
    activeExperts: activeExperts || null,
    expertFeedForwardLength: expertFeedForwardLength || null,
    ggufKnown: infoSaysMoe,
  };
}

module.exports = {
  inspectMoE,
  inferFamilyFromName,
};
