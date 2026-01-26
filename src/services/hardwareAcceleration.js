/**
 * Hardware Acceleration Service (renderer)
 *
 * Thin wrapper around Electron IPC for hardware detection, stats, and
 * backend recommendations. All calls are optional and gracefully
 * degrade when running in a plain browser or when hardware services
 * are unavailable.
 */

function getApi() {
  if (typeof window === 'undefined') return null;
  return window.electronAPI || null;
}

export async function getHardwareProfile() {
  const api = getApi();
  if (!api?.detectHardware) {
    return { error: 'Hardware detection not available in this environment' };
  }
  try {
    const info = await api.detectHardware();
    return info || { error: 'No hardware info returned' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('getHardwareProfile failed:', error);
    return { error: error.message || String(error) };
  }
}

export async function getHardwareStats() {
  const api = getApi();
  if (!api?.getHardwareStats) {
    return { error: 'Hardware stats not available', cpu: { usage: 0 }, memory: { usagePercent: 0 } };
  }
  try {
    const stats = await api.getHardwareStats();
    return stats || { error: 'No stats returned' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('getHardwareStats failed:', error);
    return { error: error.message || String(error) };
  }
}

export async function getBackendOptions() {
  const api = getApi();
  if (!api?.getBackends) {
    return [];
  }
  try {
    const backends = await api.getBackends();
    return Array.isArray(backends) ? backends : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('getBackendOptions failed:', error);
    return [];
  }
}

export async function getBackendRecommendation(modelParams) {
  const api = getApi();
  if (!api?.getRecommendation) {
    return [];
  }
  try {
    const recs = await api.getRecommendation(modelParams || {});
    return Array.isArray(recs) ? recs : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('getBackendRecommendation failed:', error);
    return [];
  }
}

export async function setPreferredBackend(backendId) {
  const api = getApi();
  if (!api?.setBackend) {
    return { error: 'Backend selection not available' };
  }
  try {
    const result = await api.setBackend(backendId);
    return result || {};
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('setPreferredBackend failed:', error);
    return { error: error.message || String(error) };
  }
}


