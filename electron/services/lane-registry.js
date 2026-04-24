/**
 * Lane Registry
 *
 * Phase 1 of the Tiered Utilization workstream. Single source of truth
 * for "which device handles which kind of workload." The orchestrator
 * consults this BEFORE its scoring function runs so simple routing
 * (embeddings → NPU, image gen → Intel Arc) short-circuits the
 * scoring path cleanly.
 *
 * Contract:
 *   getLaneCandidates(workloadType, context) → { candidates, reason }
 *     - workloadType: string (embedding | classifier | intent | autocomplete |
 *       image-generation | speech | chat-short | chat-main | ...)
 *     - context: { onBattery, modelSize, profile, hardware, availableBackends }
 *     - returns: ordered array of backend IDs to try, plus a short reason
 *       string used for telemetry/debugging. Empty array means "fall through
 *       to the orchestrator's scoring path unchanged".
 *
 * Design notes:
 *   - We never invent backends. If a listed backend isn't registered with
 *     the orchestrator, it's filtered out — the caller only sees backends
 *     that actually exist on this hardware.
 *   - chat-main stays RTX-first on AC, but falls back to NPU when on
 *     battery for small models. Power-aware routing is the whole point.
 *   - chat-short (≤300 tokens expected) routes to NPU when model is ≤3B
 *     AND we're on battery — saves ~15-20W vs waking the RTX.
 *   - Unknown workloadType returns [] so the orchestrator's existing
 *     scoring keeps working. This keeps the registry opt-in per-workload.
 */

const BASE_LANES = {
  embedding: {
    onAc: ['openvino-npu', 'openvino-gpu', 'openvino-hybrid', 'ollama-cuda', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'openvino-gpu', 'ollama-cpu'],
    reason: 'embeddings prefer NPU — low-power, steady throughput, no GPU contention',
  },
  classifier: {
    onAc: ['openvino-npu', 'openvino-gpu', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'ollama-cpu'],
    reason: 'small classifier workload fits NPU budget perfectly',
  },
  intent: {
    onAc: ['openvino-npu', 'openvino-gpu', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'ollama-cpu'],
    reason: 'intent detection is tiny — NPU handles without waking discrete GPU',
  },
  autocomplete: {
    onAc: ['openvino-npu', 'llamanode', 'ollama-cuda', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'ollama-cpu'],
    reason: 'autocomplete wants sub-100ms latency; warm NPU model wins',
  },
  'image-generation': {
    onAc: ['openvino-gpu', 'ollama-cuda', 'ollama-cpu'],
    onBattery: ['openvino-gpu', 'ollama-cpu'],
    reason: 'Intel Arc iGPU handles SDXL/Flux without stealing from chat GPU',
  },
  speech: {
    onAc: ['openvino-gpu', 'openvino-npu', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'ollama-cpu'],
    reason: 'Whisper on Intel GPU / NPU is plenty fast without NVIDIA',
  },
  'chat-short': {
    // Only routes to NPU when model is small AND we're on battery, which
    // is enforced below in filterByContext. On AC, fall through to normal
    // chat-main scoring so short replies still use the fastest path.
    onAc: [],
    onBattery: ['openvino-npu', 'ollama-cuda', 'ollama-cpu'],
    reason: 'battery-saving short reply on NPU when model fits',
  },
  'chat-main': {
    onAc: ['ollama-cuda', 'llamanode', 'openvino-hybrid', 'openvino-npu', 'ollama-cpu'],
    onBattery: ['openvino-npu', 'ollama-cuda', 'llamanode', 'ollama-cpu'],
    reason: 'chat-main prefers RTX CUDA on AC; falls back to NPU on battery',
  },
};

// Maps the orchestrator's existing lane IDs (lane_embedding, lane_agent,
// etc.) to our workload-centric keys so callers that only know the old
// lane name still get registry routing.
const LANE_ALIAS_TO_WORKLOAD = {
  lane_embedding: 'embedding',
  lane_agent: 'chat-main',
  lane_interactive: 'chat-main',
  lane_maintenance: 'classifier',
};

function normalizeWorkload(workloadType, laneHint) {
  const raw = String(workloadType || '').trim().toLowerCase();
  if (raw && BASE_LANES[raw]) return raw;
  if (raw.includes('embed') || raw.includes('rag')) return 'embedding';
  if (raw.includes('image')) return 'image-generation';
  if (raw.includes('speech') || raw.includes('audio')) return 'speech';
  if (raw.includes('intent')) return 'intent';
  if (raw.includes('classify') || raw.includes('classifier')) return 'classifier';
  if (raw.includes('autocomplete') || raw.includes('complete')) return 'autocomplete';
  if (raw.includes('short')) return 'chat-short';
  if (raw.includes('chat') || raw.includes('interactive') || raw.includes('agent')) return 'chat-main';
  if (laneHint && LANE_ALIAS_TO_WORKLOAD[laneHint]) return LANE_ALIAS_TO_WORKLOAD[laneHint];
  return null;
}

function filterByContext(workload, candidates, context = {}) {
  const modelSize = Number(context.modelSize);
  const hasModelSize = Number.isFinite(modelSize) && modelSize > 0;
  const onBattery = Boolean(context.onBattery);

  // chat-short only routes to NPU when the model is small enough to
  // actually run at interactive speed on the NPU.
  if (workload === 'chat-short' && hasModelSize && modelSize > 3) {
    return candidates.filter((id) => id !== 'openvino-npu');
  }

  // chat-main on battery, small model: promote NPU to the front so the
  // RTX stays asleep. On AC, keep the canonical order.
  if (workload === 'chat-main' && onBattery && hasModelSize && modelSize <= 3) {
    return ['openvino-npu', ...candidates.filter((id) => id !== 'openvino-npu')];
  }

  return candidates;
}

/**
 * Get the ordered list of backend IDs preferred for this workload type.
 * Returns { candidates: string[], reason: string } — candidates is
 * always defined, may be empty (caller should fall through to its
 * existing scoring loop).
 */
function getLaneCandidates(workloadType, context = {}) {
  const workload = normalizeWorkload(workloadType, context.laneHint);
  if (!workload) {
    return { candidates: [], reason: 'unknown-workload-type', workload: null };
  }

  const lane = BASE_LANES[workload];
  if (!lane) {
    return { candidates: [], reason: 'no-lane-defined', workload };
  }

  const base = context.onBattery ? lane.onBattery : lane.onAc;
  const filtered = filterByContext(workload, base || [], context);

  // Filter to backends that actually exist on this machine.
  const availableBackends = Array.isArray(context.availableBackends)
    ? new Set(context.availableBackends)
    : null;
  const candidates = availableBackends
    ? filtered.filter((id) => availableBackends.has(id))
    : filtered;

  return {
    candidates,
    reason: lane.reason,
    workload,
  };
}

/**
 * Return the list of supported workload types. Exposed for smoke tests
 * and for the UI to surface "here's what the NPU handles" copy.
 */
function getSupportedWorkloadTypes() {
  return Object.keys(BASE_LANES);
}

module.exports = {
  getLaneCandidates,
  getSupportedWorkloadTypes,
  normalizeWorkload,
  BASE_LANES,
  LANE_ALIAS_TO_WORKLOAD,
};
