/**
 * Speculative-Decoding Bus
 *
 * Coordinates draft <-> verify traffic between the NPU drafter (Python
 * process, reached over HTTP) and the in-process llamanode verifier.
 * The bus is transport-agnostic: today it uses HTTP for the draft side
 * because that's how the Python NPU server is reached; tomorrow a
 * native shared-memory addon can replace the http transport without
 * touching any caller.
 *
 * The plan envisioned a zero-copy ring buffer to avoid HTTP overhead.
 * In our shipped architecture the verifier runs in the same process as
 * the bus itself, so the only IPC hop is draft-only and HTTP latency
 * (~5-50 ms typical) is the baseline. Native shared-memory transport
 * is gated behind DEVFORGE_SPEC_BUS_TRANSPORT=shmem and stays a
 * follow-up optimisation for v0.4.x.
 *
 * Caller contract (the orchestrator loop):
 *   const bus = createSpecDecodeBus({ npuBridge, verifier });
 *   const draft = await bus.requestDraft({ prompt, lookahead, requestId });
 *   const verifyResult = await bus.submitVerification({
 *     prefix, draftTokens: draft.draft_tokens, evaluateLogits,
 *   });
 *   // verifyResult.accepted, .bonusToken, ...
 *   await bus.cancelDraft(requestId); // if needed mid-flight
 *   bus.getMetrics(); // -> { drafts: {...}, verifies: {...} }
 *   bus.dispose();
 */

const { verifySpecBatch } = require('./spec-decode-verifier');

const DEFAULT_TRANSPORT = (process.env.DEVFORGE_SPEC_BUS_TRANSPORT || 'http').toLowerCase();

function nowMs() {
  return Date.now();
}

function createMetricsBucket() {
  return {
    count: 0,
    failures: 0,
    cancelled: 0,
    totalLatencyMs: 0,
    p50LatencyMs: 0,
    p99LatencyMs: 0,
    samples: [],
  };
}

function recordSample(bucket, latencyMs) {
  bucket.count += 1;
  bucket.totalLatencyMs += latencyMs;
  bucket.samples.push(latencyMs);
  // Cap rolling window to last 200 samples to bound memory.
  if (bucket.samples.length > 200) bucket.samples.shift();
  const sorted = [...bucket.samples].sort((a, b) => a - b);
  bucket.p50LatencyMs = sorted[Math.floor(sorted.length * 0.5)] || 0;
  bucket.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1] || 0;
}

function createHttpDraftTransport(npuBridge) {
  if (!npuBridge || typeof npuBridge.draftTokens !== 'function') {
    throw new Error('spec-decode-bus: HTTP transport requires npuBridge with draftTokens()/cancelDraft()');
  }
  return {
    name: 'http',
    async requestDraft({ prompt, prefixTokens, lookahead, requestId, sampling, branch }) {
      return npuBridge.draftTokens({ prompt, prefixTokens, lookahead, requestId, sampling, branch });
    },
    async cancelDraft(requestId) {
      if (typeof npuBridge.cancelDraft !== 'function') {
        return { success: false, error: 'cancelDraft not implemented in transport' };
      }
      return npuBridge.cancelDraft(requestId);
    },
    async createSession(payload) {
      if (typeof npuBridge.createDraftSession !== 'function') {
        return { success: false, error: 'createDraftSession not implemented in transport' };
      }
      return npuBridge.createDraftSession(payload || {});
    },
    async extendSession(payload) {
      if (typeof npuBridge.extendDraftSession !== 'function') {
        return { success: false, error: 'extendDraftSession not implemented in transport' };
      }
      return npuBridge.extendDraftSession(payload || {});
    },
    async closeSession(sessionId) {
      if (typeof npuBridge.closeDraftSession !== 'function') {
        return { success: false, error: 'closeDraftSession not implemented in transport' };
      }
      return npuBridge.closeDraftSession(sessionId);
    },
    dispose() { /* no-op */ },
  };
}

function createShmemDraftTransport() {
  // Future: native addon round-trip. For now this transport is a stub
  // gated behind DEVFORGE_SPEC_BUS_TRANSPORT=shmem so the contract is
  // exercised when the addon ships, without forcing every install to
  // build the addon up front.
  const err = new Error('spec-decode-bus: shmem transport not implemented in this build');
  err.code = 'SPEC_BUS_TRANSPORT_UNAVAILABLE';
  return {
    name: 'shmem',
    async requestDraft() { throw err; },
    async cancelDraft() { throw err; },
    dispose() { /* no-op */ },
  };
}

function createSpecDecodeBus({ npuBridge, transport = DEFAULT_TRANSPORT } = {}) {
  const drafts = createMetricsBucket();
  const verifies = createMetricsBucket();

  let activeTransport;
  if (transport === 'shmem') {
    activeTransport = createShmemDraftTransport();
  } else {
    activeTransport = createHttpDraftTransport(npuBridge);
  }

  let disposed = false;

  function ensureLive() {
    if (disposed) {
      throw new Error('spec-decode-bus: bus has been disposed');
    }
  }

  return {
    transport: activeTransport.name,

    async requestDraft({ prompt = null, prefixTokens = null, lookahead = 4, requestId = null, sampling = {}, branch = null } = {}) {
      ensureLive();
      const startedAt = nowMs();
      try {
        const result = await activeTransport.requestDraft({ prompt, prefixTokens, lookahead, requestId, sampling, branch });
        const latency = nowMs() - startedAt;
        if (result?.success === false) {
          drafts.failures += 1;
          recordSample(drafts, latency);
          return result;
        }
        if (result?.cancelled === true) {
          drafts.cancelled += 1;
        }
        recordSample(drafts, latency);
        return result;
      } catch (err) {
        drafts.failures += 1;
        recordSample(drafts, nowMs() - startedAt);
        throw err;
      }
    },

    async cancelDraft(requestId) {
      ensureLive();
      return activeTransport.cancelDraft(requestId);
    },

    async createSession(payload = {}) {
      ensureLive();
      if (typeof activeTransport.createSession !== 'function') {
        return { success: false, error: 'createSession not supported by transport' };
      }
      return activeTransport.createSession(payload);
    },

    async extendSession(payload = {}) {
      ensureLive();
      if (typeof activeTransport.extendSession !== 'function') {
        return { success: false, error: 'extendSession not supported by transport' };
      }
      const startedAt = nowMs();
      try {
        const result = await activeTransport.extendSession(payload);
        const latency = nowMs() - startedAt;
        if (result?.success === false) {
          drafts.failures += 1;
          recordSample(drafts, latency);
          return result;
        }
        if (result?.cancelled === true) drafts.cancelled += 1;
        recordSample(drafts, latency);
        return result;
      } catch (err) {
        drafts.failures += 1;
        recordSample(drafts, nowMs() - startedAt);
        throw err;
      }
    },

    async closeSession(sessionId) {
      ensureLive();
      if (typeof activeTransport.closeSession !== 'function') {
        return { success: false, error: 'closeSession not supported by transport' };
      }
      return activeTransport.closeSession(sessionId);
    },

    async submitVerification({
      prefix = [],
      draftTokens,
      evaluateLogits,
      mode = 'greedy',
      draftLogprobs = null,
      rng,
    } = {}) {
      ensureLive();
      const startedAt = nowMs();
      try {
        const result = await verifySpecBatch({
          prefix,
          draftTokens,
          evaluateLogits,
          mode,
          draftLogprobs,
          rng,
        });
        recordSample(verifies, nowMs() - startedAt);
        return result;
      } catch (err) {
        verifies.failures += 1;
        recordSample(verifies, nowMs() - startedAt);
        throw err;
      }
    },

    getMetrics() {
      return {
        transport: activeTransport.name,
        drafts: { ...drafts, samples: drafts.samples.length },
        verifies: { ...verifies, samples: verifies.samples.length },
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      activeTransport.dispose();
    },
  };
}

module.exports = {
  createSpecDecodeBus,
  createHttpDraftTransport,
  createShmemDraftTransport,
};
