/**
 * Renderer-side Spark adapter helpers.
 *
 * Spark UI components should route IPC calls and Spark-specific heuristics
 * through this module instead of embedding those details in large panels.
 */

export async function callSparkHub(method, ...args) {
  const api = window?.electronAPI;
  if (!api?.[method]) throw new Error(`Missing electronAPI.${method}. Add the Spark Model Hub preload wiring.`);
  return api[method](...args);
}

export function isSparkMoeCandidateName(value = '') {
  const lower = String(value || '').toLowerCase();
  return lower.includes('gpt-oss') || lower.includes('mixtral') || lower.includes('moe') || /qwen.*a\d+b/.test(lower);
}
