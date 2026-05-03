/**
 * Model load progress reporter.
 *
 * Wraps a normal Ollama warmup with detailed, observable lifecycle events so
 * the UI can show a real progress bar instead of an indeterminate spinner.
 *
 * Stages (each gets `progress` updates inside):
 *   1. preparing           (0 - 10%)   - resolve metadata from /api/show
 *   2. loading-weights     (10 - 88%)  - poll /api/ps until model appears
 *   3. verifying-first-tok (88 - 99%)  - run a 1-token streaming request
 *   4. ready               (100%)
 *
 * Notes:
 * - Ollama itself does not expose a numeric load progress, so progress for
 *   `loading-weights` is computed as `min(88, elapsed / estimate * 88)` and
 *   immediately jumps to 88% as soon as `/api/ps` reports the model loaded.
 * - All progress is emitted via `onEvent` so the IPC layer can stream it
 *   to the renderer over a per-call channel.
 */

const DEFAULT_ESTIMATE = {
  // Rough load throughput estimates (ms per GiB of weights):
  cudaMsPerGiB: 1600,
  cpuMsPerGiB: 4500,
  minimumMs: 1500,
  maximumMs: 240000,
};
const { estimateSparkRequirement, buildFitVerdict } = require('./spark-memory-estimator');
const { detectSparkProfile } = require('./spark-profile');

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickModelSizeBytes(showData) {
  if (!showData || typeof showData !== 'object') return 0;
  const candidates = [
    showData.size,
    showData.details?.parameter_size_bytes,
    showData.model_info?.['general.file_size_bytes'],
    showData.model_info?.['general.size_bytes'],
  ];
  for (const value of candidates) {
    const n = safeNumber(value, 0);
    if (n > 0) return n;
  }
  // Fallback: estimate from "13B" / "30B" parameter strings.
  const paramText = String(showData.details?.parameter_size || '').toLowerCase();
  const match = /([\d.]+)\s*b/.exec(paramText);
  if (match) {
    const billions = Number(match[1]);
    if (Number.isFinite(billions) && billions > 0) {
      // Generic FP16 ~ 2 bytes per param; Q8 ~ 1.1 bytes; Q4 ~ 0.6 bytes.
      const quant = String(showData.details?.quantization_level || '').toLowerCase();
      const bytesPerParam = quant.includes('q4') ? 0.6 : quant.includes('q5') ? 0.8 : quant.includes('q8') ? 1.1 : 2.0;
      return billions * 1e9 * bytesPerParam;
    }
  }
  return 0;
}

function estimateTotalMs({ sizeBytes, useCuda }) {
  const giB = sizeBytes / (1024 ** 3);
  const perGiB = useCuda ? DEFAULT_ESTIMATE.cudaMsPerGiB : DEFAULT_ESTIMATE.cpuMsPerGiB;
  const raw = giB > 0 ? giB * perGiB : DEFAULT_ESTIMATE.minimumMs;
  return Math.min(Math.max(raw, DEFAULT_ESTIMATE.minimumMs), DEFAULT_ESTIMATE.maximumMs);
}

function normalizeName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/:latest$/i, '');
}

async function fetchShow(endpoint, makeRequest, model) {
  try {
    const res = await makeRequest(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: model },
      timeout: 10000,
    });
    return res?.data || null;
  } catch (_) {
    return null;
  }
}

async function isModelLoaded(endpoint, makeRequest, model) {
  try {
    const res = await makeRequest(`${endpoint}/api/ps`, { timeout: 4000 });
    const list = Array.isArray(res?.data?.models) ? res.data.models : [];
    const target = normalizeName(model);
    return list.some((entry) => normalizeName(entry?.name || entry?.model || '') === target);
  } catch (_) {
    return false;
  }
}

/**
 * Run a warmup pass and emit progress events.
 *
 * @param {object} args
 * @param {string} args.endpoint        Base Ollama endpoint, e.g. http://127.0.0.1:11434
 * @param {Function} args.makeRequest   Bound HTTP helper (existing makeRequest from main).
 * @param {string} args.model           Ollama model name.
 * @param {boolean} [args.useCuda=true] Whether the active backend uses GPU.
 * @param {Function} args.onEvent       Receives `{ type, ... }` progress messages.
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<object>}
 */
async function warmupWithProgress({ endpoint, makeRequest, model, useCuda = true, onEvent, signal }) {
  if (typeof onEvent !== 'function') {
    onEvent = () => {};
  }
  const startedAt = Date.now();
  const aborted = () => signal?.aborted === true;
  const emit = (event) => {
    try {
      onEvent({ ...event, model, startedAt, elapsedMs: Date.now() - startedAt });
    } catch (_) { /* renderer may have detached */ }
  };

  emit({ type: 'start', stage: 'preparing', progress: 0, message: 'Preparing runtime...' });

  // 1) Probe metadata so we can estimate.
  const showData = await fetchShow(endpoint, makeRequest, model);
  if (aborted()) return { success: false, cancelled: true };

  const sizeBytes = pickModelSizeBytes(showData);
  const estimateMs = estimateTotalMs({ sizeBytes, useCuda });
  const sizeGiB = sizeBytes / (1024 ** 3);
  const family = showData?.details?.family || null;
  const quantization = showData?.details?.quantization_level || null;
  const sparkProfile = await detectSparkProfile().catch(() => ({ isSpark: false }));
  let requirement = estimateSparkRequirement({
    name: model,
    showData,
    quantization,
  }, {
    showData,
    modelName: model,
    profileLevel: 'recommended',
  });
  let downshifted = false;
  if (
    sparkProfile?.isSpark &&
    requirement?.profile?.recommendedMemGiB &&
    Number(sparkProfile.memAvailableGiB || 0) < Number(requirement.profile.recommendedMemGiB)
  ) {
    requirement = estimateSparkRequirement({
      name: model,
      showData,
      quantization,
    }, {
      showData,
      modelName: model,
      profileLevel: 'stable',
    });
    downshifted = true;
  }
  const fit = buildFitVerdict(requirement, sparkProfile?.memAvailableGiB);
  if (sparkProfile?.isSpark && fit.canRunNow === false) {
    emit({
      type: 'error',
      stage: 'preparing',
      progress: 10,
      message: fit.message,
      guidance: fit.guidance,
      memoryRequirement: requirement,
      memoryVerdict: fit,
      sparkProfile,
      sizeBytes,
      sizeGiB,
      family,
      quantization,
      moe: requirement.moe,
    });
    return { success: false, error: fit.message, memoryRequirement: requirement, memoryVerdict: fit };
  }

  emit({
    type: 'progress',
    stage: 'preparing',
    progress: 10,
    message: sizeGiB > 0 ? `Resolved metadata (${sizeGiB.toFixed(1)} GiB)` : 'Resolved metadata',
    sizeBytes,
    sizeGiB,
    family,
    quantization,
    estimateMs,
    memoryRequirement: requirement,
    memoryVerdict: fit,
    sparkProfile,
    moe: requirement.moe,
    downshifted,
  });

  // 2) Kick off the actual warmup as a streaming generate so we can detect
  //    "model loaded, generating first token" as the boundary between phases.
  const warmupPromise = (async () => {
    try {
      const res = await makeRequest(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          model,
          prompt: 'Hi',
          stream: false,
          keep_alive: '10m',
          options: {
            num_gpu: useCuda ? -1 : 0,
            num_predict: 1,
            num_ctx: requirement?.isMoE && sparkProfile?.isSpark ? Math.min(requirement.options?.num_ctx || 4096, 4096) : 512,
            num_batch: requirement?.isMoE && sparkProfile?.isSpark ? 64 : undefined,
            kv_cache_type: requirement?.isMoE && sparkProfile?.isSpark ? 'q4_0' : undefined,
            flash_attn: true,
          },
        },
        timeout: Math.max(estimateMs * 2, 120000),
      });
      return res?.data || null;
    } catch (error) {
      throw new Error(error?.message || 'Warmup request failed');
    }
  })();

  // 3) Poll /api/ps until the model shows up loaded, while reporting progress.
  let weightsLoaded = false;
  let pollCount = 0;
  while (!weightsLoaded && !aborted()) {
    pollCount += 1;
    const elapsed = Date.now() - startedAt;
    const pct = Math.min(88, 10 + (elapsed / estimateMs) * 78);
    emit({
      type: 'progress',
      stage: 'loading-weights',
      progress: Number(pct.toFixed(1)),
      message: sizeGiB > 0
        ? `Loading ${sizeGiB.toFixed(1)} GiB into ${useCuda ? 'GPU' : 'CPU'} memory...`
        : `Loading model into ${useCuda ? 'GPU' : 'CPU'} memory...`,
      etaMs: Math.max(0, Math.round(estimateMs - elapsed)),
      sizeBytes,
      sizeGiB,
      memoryRequirement: requirement,
      memoryVerdict: fit,
      sparkProfile,
      moe: requirement.moe,
    });

    weightsLoaded = await isModelLoaded(endpoint, makeRequest, model);
    if (weightsLoaded) break;

    if (elapsed > estimateMs * 4) {
      // Stop fake-incrementing if the model is taking dramatically longer.
      break;
    }

    // Race the warmup promise so we leave the polling loop quickly when it
    // resolves on faster runtimes (e.g. tiny models that load instantly).
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 600)),
      warmupPromise.then(() => null).catch(() => null),
    ]);

    if (await isModelLoaded(endpoint, makeRequest, model)) {
      weightsLoaded = true;
    }
  }

  if (aborted()) {
    emit({ type: 'cancelled', stage: 'loading-weights', progress: 0, message: 'Cancelled.' });
    return { success: false, cancelled: true };
  }

  emit({
    type: 'progress',
    stage: 'verifying-first-token',
    progress: 92,
    message: 'Verifying first token...',
    sizeBytes,
    sizeGiB,
    memoryRequirement: requirement,
    memoryVerdict: fit,
    sparkProfile,
    moe: requirement.moe,
  });

  // 4) Ensure the warmup HTTP request finishes (it produces 1 token).
  let warmResult = null;
  try {
    warmResult = await warmupPromise;
  } catch (error) {
    emit({
      type: 'error',
      stage: 'verifying-first-token',
      progress: 99,
      message: error.message || 'Warmup failed',
    });
    return { success: false, error: error.message || 'Warmup failed' };
  }

  emit({
    type: 'progress',
    stage: 'ready',
    progress: 100,
    message: 'Ready.',
    sizeBytes,
    sizeGiB,
    memoryRequirement: requirement,
    memoryVerdict: fit,
    sparkProfile,
    moe: requirement.moe,
  });
  emit({
    type: 'done',
    stage: 'ready',
    progress: 100,
    message: 'Ready.',
    sizeBytes,
    sizeGiB,
    memoryRequirement: requirement,
    memoryVerdict: fit,
    sparkProfile,
    moe: requirement.moe,
  });

  return {
    success: true,
    model,
    sizeBytes,
    sizeGiB,
    family,
    quantization,
    estimateMs,
    elapsedMs: Date.now() - startedAt,
    response: warmResult,
  };
}

module.exports = {
  warmupWithProgress,
  pickModelSizeBytes,
  estimateTotalMs,
};
