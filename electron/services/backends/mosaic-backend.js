const BaseBackend = require('./base-backend');
const {
  buildGate2Decision,
  isMosaicRuntimeEnabled,
  planPlacement,
  probeRuntime,
} = require('../mosaic-coordinator');

class MosaicBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: 'mosaic',
      name: 'Mosaic Runtime (dev)',
      type: 'mosaic',
      device: 'RTX + Arc + CPU',
      priority: 50,
      capabilities: {
        streaming: true,
        vision: false,
        embeddings: false,
        function_calling: false,
        experimental: true,
      },
      ...config,
    });
    this.lastProbe = null;
  }

  async checkHealth() {
    if (!isMosaicRuntimeEnabled()) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'disabled',
        error: 'Mosaic requires DEVFORGE_MOSAIC_DEV=1 and DEVFORGE_MOSAIC_ENABLE=1',
      };
    }
    const probe = probeRuntime({ requireCombinedBackends: true });
    this.lastProbe = probe;
    if (!probe.available) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'blocked',
        error: probe.blockedReason || 'mosaic_runtime_blocked',
        blockers: probe.blockers || [],
        probe,
      };
    }
    this.setStatus('available');
    return {
      available: true,
      status: 'dev-ready',
      probe,
    };
  }

  async generate(payload = {}) {
    const health = await this.checkHealth();
    if (!health.available) {
      const error = new Error(`Mosaic runtime unavailable: ${health.error || health.status}`);
      error.code = 'MOSAIC_UNAVAILABLE';
      error.mosaic = health;
      throw error;
    }
    const plan = planPlacement({
      modelPath: payload.modelPath || payload.model,
      modelId: payload.model,
      contextSize: payload.options?.num_ctx || 4096,
    });
    const decision = buildGate2Decision({
      status: 'blocked',
      model: payload.model,
      reason: 'mosaic_chat_execution_not_enabled_until_gate2_passes',
      plan,
    });
    return {
      response: '',
      done: true,
      model: payload.model,
      metadata: {
        executionMode: 'mosaic',
        mosaicMode: 'diagnostic',
        gateStatus: decision.status,
        assignment: plan.assignment,
        speedup: decision.speedup,
        reason: decision.reason,
      },
    };
  }

  async stream(payload, onChunk) {
    const result = await this.generate(payload);
    if (typeof onChunk === 'function') {
      onChunk({ done: true, metadata: result.metadata });
    }
    return {
      requestId: `mosaic-${Date.now()}`,
      metadata: result.metadata,
    };
  }

  async getModels() {
    return [];
  }

  async loadModel() {
    return { success: false, error: 'Mosaic model loading is gate-script only until Gate 2 passes' };
  }

  async cancel() {
    return { success: true };
  }
}

module.exports = MosaicBackend;

