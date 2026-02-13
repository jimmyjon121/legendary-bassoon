/**
 * Inference Orchestrator
 * Unified routing for chat, streaming, warmup and benchmark requests.
 */

const OllamaBackend = require('./backends/ollama-backend');
const LlamaCppBackend = require('./backends/llamacpp-backend');
const OpenVinoBackend = require('./backends/openvino-backend');
const hardwareDetection = require('./hardware-detection');
const JobQueue = require('./job-queue');
const { getPowerMode } = require('./power-mode');
const { embedTextsWithRouting } = require('./embedding-service');

const PROFILE_ORDER = {
  speed: ['ollama-cuda', 'llamacpp-vulkan', 'openvino-npu', 'ollama-cpu'],
  balanced: ['ollama-cuda', 'openvino-npu', 'llamacpp-vulkan', 'ollama-cpu'],
  efficiency: ['openvino-npu', 'ollama-cpu', 'llamacpp-vulkan', 'ollama-cuda'],
};

const PROFILE_PRIORITY = {
  speed: -15,
  balanced: 0,
  efficiency: 10,
};

const DEFAULT_LANE_CONFIG = {
  lane_interactive: { concurrency: 1, priorityBase: -100 },
  lane_agent: { concurrency: 1, priorityBase: 5 },
  lane_embedding: { concurrency: 1, priorityBase: -10 },
  lane_maintenance: { concurrency: 1, priorityBase: 25 },
  default: { concurrency: 1, priorityBase: 10 },
};

const INFERENCE_LANES = {
  interactive: 'lane_interactive',
  agent: 'lane_agent',
  embedding: 'lane_embedding',
  maintenance: 'lane_maintenance',
};

function normalizeLane(lane, workloadType) {
  const direct = String(lane || '').trim();
  if (direct && DEFAULT_LANE_CONFIG[direct]) return direct;
  if (direct && INFERENCE_LANES[direct]) return INFERENCE_LANES[direct];

  const normalizedWorkload = String(workloadType || '').toLowerCase();
  if (normalizedWorkload.includes('embed') || normalizedWorkload.includes('rag')) {
    return 'lane_embedding';
  }
  if (normalizedWorkload.includes('agent')) return 'lane_agent';
  if (normalizedWorkload.includes('index') || normalizedWorkload.includes('maintenance')) {
    return 'lane_maintenance';
  }
  return 'lane_interactive';
}

function parseModelSizeHint(modelName = '') {
  const lower = String(modelName || '').toLowerCase();
  if (!lower) return null;
  const match = lower.match(/(\d+(?:\.\d+)?)b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildPromptFromMessages(messages = [], system = '') {
  const parts = [];
  const sys = String(system || '').trim();
  if (sys) parts.push(`System: ${sys}`);
  for (const msg of messages) {
    const role = msg?.role === 'assistant' ? 'Assistant' : 'User';
    const content = String(msg?.content || '').trim();
    if (!content) continue;
    parts.push(`${role}: ${content}`);
  }
  parts.push('Assistant:');
  return parts.join('\n\n');
}

class InferenceOrchestrator {
  constructor(store) {
    this.store = store;
    this.backends = new Map();
    this.currentBackend = null;
    this.preferredBackendId = null;
    this.hardware = null;
    this.initialized = false;
    this.profile = this.store?.get('performanceProfile') || 'balanced';
    this.jobQueue = new JobQueue({
      maxConcurrent: 2,
      laneConfig: DEFAULT_LANE_CONFIG,
    });

    this.recentDecisions = [];
    this.fallbackCounters = {};
    this.offloadEvidence = new Map();
    this._applyLanePolicy();
  }

  _applyLanePolicy() {
    const hasNpu = Boolean(this.hardware?.npu?.detected);
    const laneConfig = {
      lane_interactive: { concurrency: 1, priorityBase: -120 },
      lane_agent: { concurrency: 1, priorityBase: 5 },
      lane_embedding: { concurrency: 1, priorityBase: -10 },
      lane_maintenance: { concurrency: 1, priorityBase: 25 },
      default: { concurrency: 1, priorityBase: 10 },
    };

    let maxConcurrent = 2;
    if (this.profile === 'speed') {
      laneConfig.lane_agent = { concurrency: 2, priorityBase: 0 };
      laneConfig.lane_embedding = { concurrency: hasNpu ? 2 : 1, priorityBase: -20 };
      laneConfig.lane_maintenance = { concurrency: 1, priorityBase: 20 };
      maxConcurrent = hasNpu ? 4 : 3;
    } else if (this.profile === 'efficiency') {
      laneConfig.lane_agent = { concurrency: 1, priorityBase: 10 };
      laneConfig.lane_embedding = { concurrency: hasNpu ? 2 : 1, priorityBase: -5 };
      laneConfig.lane_maintenance = { concurrency: 1, priorityBase: 30 };
      maxConcurrent = hasNpu ? 3 : 2;
    } else {
      laneConfig.lane_agent = { concurrency: 1, priorityBase: 6 };
      laneConfig.lane_embedding = { concurrency: hasNpu ? 2 : 1, priorityBase: -12 };
      laneConfig.lane_maintenance = { concurrency: 1, priorityBase: 24 };
      maxConcurrent = hasNpu ? 3 : 2;
    }

    this.jobQueue.setLaneConfig(laneConfig);
    this.jobQueue.setMaxConcurrent(maxConcurrent);
  }

  async initialize() {
    if (this.initialized) return;

    console.log('[Orchestrator] Initializing...');
    try {
      this.hardware = await hardwareDetection.detectHardware();
      console.log('[Orchestrator] Hardware detected:', {
        gpus: this.hardware.gpus?.length || 0,
        npu: this.hardware.npu?.detected || false,
        recommendations: this.hardware.recommendations?.primary,
      });
    } catch (error) {
      console.error('[Orchestrator] Hardware detection failed:', error);
      this.hardware = { gpus: [], npu: { detected: false }, cpu: {}, recommendations: {} };
    }

    this.preferredBackendId = this.store?.get('preferredBackend') || 'auto';
    await this.initializeBackends();
    this._applyLanePolicy();
    await this.selectOptimalBackend();
    this.initialized = true;
    console.log('[Orchestrator] Initialized with backend:', this.currentBackend?.id);
  }

  async initializeBackends() {
    const llmEndpoint = this.store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const llamaCppEndpoint = this.store?.get('llamaCppEndpoint') || 'http://127.0.0.1:8080';
    const openvinoEndpoint = this.store?.get('openvinoEndpoint') || 'http://127.0.0.1:8081';

    const hasNvidiaGpu = this.hardware.gpus?.some((g) => g.type === 'nvidia');
    if (hasNvidiaGpu) {
      const nvidiaGpu = this.hardware.gpus.find((g) => g.type === 'nvidia');
      this.backends.set('ollama-cuda', new OllamaBackend({
        useCuda: true,
        endpoint: llmEndpoint,
        device: nvidiaGpu?.name || 'NVIDIA GPU',
        priority: 1,
      }));
    }

    this.backends.set('ollama-cpu', new OllamaBackend({
      useCuda: false,
      endpoint: llmEndpoint,
      device: this.hardware.cpu?.brand || 'CPU',
      priority: 99,
    }));

    const hasArcGpu = this.hardware.gpus?.some((g) => g.type === 'intel-arc');
    if (hasArcGpu) {
      const arcGpu = this.hardware.gpus.find((g) => g.type === 'intel-arc');
      this.backends.set('llamacpp-vulkan', new LlamaCppBackend({
        endpoint: llamaCppEndpoint,
        device: arcGpu?.name || 'Intel Arc GPU',
        useVulkan: true,
        priority: 2,
      }));
    }

    if (this.hardware.npu?.detected) {
      this.backends.set('openvino-npu', new OpenVinoBackend({
        device: 'NPU',
        endpoint: openvinoEndpoint,
        priority: 3,
      }));
    } else if (hasArcGpu) {
      this.backends.set('openvino-gpu', new OpenVinoBackend({
        device: 'Intel GPU',
        endpoint: openvinoEndpoint,
        priority: 4,
      }));
    }

    await this.checkAllBackends();
  }

  async checkAllBackends() {
    const healthChecks = [];
    for (const [id, backend] of this.backends) {
      healthChecks.push(
        backend.checkHealth()
          .then((result) => ({ id, ...result }))
          .catch((error) => ({ id, available: false, error: error.message })),
      );
    }
    const results = await Promise.all(healthChecks);
    for (const result of results) {
      console.log(`[Orchestrator] Backend ${result.id}: ${result.available ? 'available' : 'unavailable'}`);
    }
    return results;
  }

  async _safeBackendHealth(backend) {
    try {
      return await backend.checkHealth();
    } catch {
      return { available: false, status: 'error' };
    }
  }

  _orderedBackendIdsForProfile(profile = this.profile) {
    const order = PROFILE_ORDER[profile] || PROFILE_ORDER.balanced;
    const listed = order.filter((id) => this.backends.has(id));
    const remaining = Array.from(this.backends.keys()).filter((id) => !listed.includes(id));
    return [...listed, ...remaining];
  }

  async _tryStartNpuServer() {
    try {
      const { getNpuBridge } = require('./npu-bridge');
      const npuBridge = getNpuBridge();
      const status = await npuBridge.getStatus();
      if (!status.openvinoInstalled) return false;
      if (status.serverRunning) return true;
      await npuBridge.autoConfigureModel({ enableAutoStart: true });
      const result = await npuBridge.startServer();
      return Boolean(result?.success);
    } catch (error) {
      console.warn('[Orchestrator] NPU auto-start error:', error.message);
      return false;
    }
  }

  async selectOptimalBackend(modelSize = null) {
    if (this.preferredBackendId && this.preferredBackendId !== 'auto') {
      const preferred = this.backends.get(this.preferredBackendId);
      if (preferred) {
        const health = await this._safeBackendHealth(preferred);
        if (health.available) {
          this.currentBackend = preferred;
          return preferred;
        }
        if (this.preferredBackendId.includes('npu') || this.preferredBackendId.includes('openvino')) {
          const started = await this._tryStartNpuServer();
          if (started) {
            const retryHealth = await this._safeBackendHealth(preferred);
            if (retryHealth.available) {
              this.currentBackend = preferred;
              return preferred;
            }
          }
        }
      }
    }

    if (modelSize !== null && this.hardware?.npu?.detected && modelSize <= 3) {
      const npuBackend = this.backends.get('openvino-npu');
      if (npuBackend) {
        let health = await this._safeBackendHealth(npuBackend);
        if (!health.available) {
          const started = await this._tryStartNpuServer();
          if (started) health = await this._safeBackendHealth(npuBackend);
        }
        if (health.available) {
          this.currentBackend = npuBackend;
          return npuBackend;
        }
      }
    }

    const ordered = this._orderedBackendIdsForProfile();
    for (const backendId of ordered) {
      const backend = this.backends.get(backendId);
      if (!backend) continue;
      const health = await this._safeBackendHealth(backend);
      if (health.available) {
        this.currentBackend = backend;
        return backend;
      }
    }

    this.currentBackend = this.backends.get('ollama-cpu') || null;
    return this.currentBackend;
  }

  async setPreferredBackend(backendId) {
    this.preferredBackendId = backendId;
    this.store?.set('preferredBackend', backendId);
    if (backendId === 'auto') {
      await this.selectOptimalBackend();
    } else {
      const backend = this.backends.get(backendId);
      if (backend) {
        const health = await this._safeBackendHealth(backend);
        if (health.available) this.currentBackend = backend;
      }
    }
    return this.currentBackend?.getInfo();
  }

  async getAvailableBackends() {
    const rows = [];
    for (const [id, backend] of this.backends) {
      const health = await this._safeBackendHealth(backend);
      rows.push({
        ...backend.getInfo(),
        available: health.available,
        healthStatus: health.status,
      });
    }
    return rows;
  }

  getCurrentBackend() {
    return this.currentBackend?.getInfo() || null;
  }

  _resolvePriority(payloadPriority = null) {
    const profileBias = PROFILE_PRIORITY[this.profile] ?? 0;
    const delta = Number.isFinite(payloadPriority) ? Number(payloadPriority) : 0;
    return profileBias + delta;
  }

  _recordDecision(entry = {}) {
    const row = {
      ts: Date.now(),
      ...entry,
    };
    this.recentDecisions.push(row);
    if (this.recentDecisions.length > 80) {
      this.recentDecisions.shift();
    }
    if (row.fallbackReason) {
      const key = String(row.fallbackReason);
      this.fallbackCounters[key] = (this.fallbackCounters[key] || 0) + 1;
    }
  }

  async _collectOffloadEvidence(backend, modelName) {
    const base = {
      verified: false,
      backend: backend?.id || null,
      method: null,
      model: modelName || null,
      sizeVram: 0,
      details: null,
      checkedAt: Date.now(),
    };

    if (!backend) return base;

    if (backend.id && backend.id.startsWith('ollama')) {
      try {
        const ps = await backend.getGpuInfo?.();
        const models = Array.isArray(ps?.models) ? ps.models : [];
        const lowerTarget = String(modelName || '').toLowerCase();
        const matched = models.find((row) => {
          const name = String(row?.name || '').toLowerCase();
          return lowerTarget ? name.includes(lowerTarget.split(':')[0]) : false;
        });
        const sizeVram = Number(matched?.size_vram || 0);
        return {
          ...base,
          verified: sizeVram > 0,
          method: 'ollama:/api/ps',
          sizeVram,
          details: matched || null,
        };
      } catch (error) {
        return {
          ...base,
          method: 'ollama:/api/ps',
          details: { error: error.message },
        };
      }
    }

    if (backend.id && backend.id.startsWith('openvino')) {
      const health = await this._safeBackendHealth(backend);
      return {
        ...base,
        verified: Boolean(health.available),
        method: 'openvino:/status',
        details: health,
      };
    }

    return base;
  }

  async _selectBackendForRequest(payload = {}) {
    const lane = normalizeLane(payload.lane, payload.workloadType);
    const modelSize = parseModelSizeHint(payload.model);
    const order = this._orderedBackendIdsForProfile();

    // Explicit backend override wins.
    if (payload.forceBackend && this.backends.has(payload.forceBackend)) {
      const forced = this.backends.get(payload.forceBackend);
      const health = await this._safeBackendHealth(forced);
      if (health.available) {
        return { backend: forced, fallbackReason: null };
      }
    }

    // User preferred backend next.
    if (this.preferredBackendId && this.preferredBackendId !== 'auto') {
      const preferred = this.backends.get(this.preferredBackendId);
      if (preferred) {
        const health = await this._safeBackendHealth(preferred);
        if (health.available) return { backend: preferred, fallbackReason: null };
      }
    }

    // Hard lane routing.
    const laneOrder = [];
    if (lane === 'lane_embedding') {
      laneOrder.push('openvino-npu', 'openvino-gpu', 'ollama-cuda', 'ollama-cpu');
    } else if (lane === 'lane_maintenance') {
      laneOrder.push('ollama-cpu', 'openvino-npu', 'ollama-cuda');
    } else if (lane === 'lane_agent') {
      laneOrder.push('ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu', 'openvino-npu');
    } else {
      laneOrder.push('ollama-cuda', 'llamacpp-vulkan', 'openvino-npu', 'ollama-cpu');
    }

    // Small model heuristic for non-interactive workloads.
    if (modelSize !== null && modelSize <= 3 && lane !== 'lane_interactive') {
      laneOrder.unshift('openvino-npu');
    }

    const candidates = [...new Set([...laneOrder, ...order])];
    for (const backendId of candidates) {
      const backend = this.backends.get(backendId);
      if (!backend) continue;
      let health = await this._safeBackendHealth(backend);
      if (!health.available && backendId === 'openvino-npu') {
        const started = await this._tryStartNpuServer();
        if (started) {
          health = await this._safeBackendHealth(backend);
        }
      }
      if (health.available) {
        return { backend, fallbackReason: backendId === candidates[0] ? null : `fallback:${backendId}` };
      }
    }

    return {
      backend: this.backends.get('ollama-cpu') || null,
      fallbackReason: 'fallback:cpu-last-resort',
    };
  }

  _normalizePayloadForBackend(backend, payload = {}) {
    if (!backend) return payload;
    const normalized = { ...payload };
    if (Array.isArray(normalized.messages) && normalized.messages.length > 0 && backend.type === 'openvino') {
      normalized.prompt = buildPromptFromMessages(normalized.messages, normalized.system);
      delete normalized.messages;
    }
    return normalized;
  }

  async _executeOnBackend(backend, mode, payload, onChunk) {
    const normalizedPayload = this._normalizePayloadForBackend(backend, payload);
    if (mode === 'stream') {
      return backend.stream(normalizedPayload, onChunk);
    }
    return backend.generate(normalizedPayload);
  }

  async _enqueueInference(mode, payload = {}, onChunk = null) {
    const lane = normalizeLane(payload.lane, payload.workloadType);
    const priority = this._resolvePriority(payload.priority);
    const allowFallback = payload.allowFallback !== false;

    const meta = {
      mode,
      model: payload.model || null,
      lane,
      workloadType: payload.workloadType || null,
    };

    return this.jobQueue.enqueue(async () => {
      const { backend, fallbackReason } = await this._selectBackendForRequest(payload);
      if (!backend) throw new Error('No available backend for inference');

      this.currentBackend = backend;
      this._recordDecision({
        mode,
        lane,
        model: payload.model || null,
        backend: backend.id,
        fallbackReason,
      });

      const powerMode = getPowerMode();
      if (!powerMode.enabled) {
        await powerMode.enable();
      }

      try {
        return await this._executeOnBackend(backend, mode, payload, onChunk);
      } catch (primaryError) {
        if (!allowFallback) {
          throw primaryError;
        }

        const ordered = this._orderedBackendIdsForProfile();
        for (const backendId of ordered) {
          if (backendId === backend.id) continue;
          const candidate = this.backends.get(backendId);
          if (!candidate) continue;
          const health = await this._safeBackendHealth(candidate);
          if (!health.available) continue;
          try {
            this.currentBackend = candidate;
            this._recordDecision({
              mode,
              lane,
              model: payload.model || null,
              backend: candidate.id,
              fallbackReason: `recover:${backend.id}->${candidate.id}`,
            });
            return await this._executeOnBackend(candidate, mode, payload, onChunk);
          } catch {
            // Try next candidate.
          }
        }
        throw primaryError;
      } finally {
        this._scheduleIdlePowerDown();
      }
    }, { lane, priority, meta });
  }

  async generate(payload) {
    return this._enqueueInference('generate', payload, null);
  }

  async stream(payload, onChunk) {
    return this._enqueueInference('stream', payload, onChunk);
  }

  async warmupModel(modelName, options = {}) {
    const request = {
      model: modelName,
      lane: options.lane || 'lane_interactive',
      workloadType: options.workloadType || 'warmup',
      allowFallback: options.allowFallback !== false,
      priority: Number.isFinite(options.priority) ? options.priority : -50,
      forceBackend: options.forceBackend || null,
    };

    const { backend } = await this._selectBackendForRequest(request);
    if (!backend) {
      return {
        ok: false,
        success: false,
        model: modelName,
        backend: null,
        fallbackReason: 'no-backend',
        offloadEvidence: null,
        timings: { elapsedMs: 0 },
      };
    }

    const startedAt = Date.now();
    let result;
    try {
      if (typeof backend.warmupModel === 'function') {
        result = await backend.warmupModel(modelName);
      } else {
        result = await backend.generate({
          model: modelName,
          prompt: 'Hi',
          options: { num_predict: 1, num_ctx: 512 },
        });
      }
    } catch (error) {
      result = { success: false, error: error.message };
    }

    const offloadEvidence = await this._collectOffloadEvidence(backend, modelName);
    const elapsedMs = Date.now() - startedAt;

    const strictGpuVerification = backend.id === 'ollama-cuda';
    const success = Boolean(result?.success !== false)
      && (!strictGpuVerification || offloadEvidence.verified);
    const fallbackReason = success ? null : (
      strictGpuVerification
        ? 'gpu-offload-not-verified'
        : (result?.error || 'warmup-failed')
    );

    const payload = {
      ok: success,
      success,
      model: modelName,
      backend: backend.id,
      offloadEvidence,
      timings: { elapsedMs },
      fallbackReason,
      details: result || null,
    };

    this.offloadEvidence.set(`${modelName}::${backend.id}`, payload.offloadEvidence);
    return payload;
  }

  async benchmark(config = {}) {
    const model = String(config.model || '').trim();
    if (!model) {
      return { ok: false, error: 'Model is required for benchmark' };
    }

    const samples = Math.max(1, Math.min(Number(config.samples) || 3, 8));
    const prompt = String(config.prompt || 'Write one concise sentence about local AI.');
    const lane = normalizeLane(config.lane || 'lane_maintenance', config.workloadType || 'benchmark');
    const options = {
      num_predict: Math.max(16, Math.min(Number(config.numPredict) || 64, 256)),
      num_ctx: Math.max(512, Math.min(Number(config.numCtx) || 4096, 32768)),
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.05,
    };

    const warmup = await this.warmupModel(model, {
      lane,
      workloadType: 'benchmark',
      allowFallback: true,
    });

    const runs = [];
    for (let i = 0; i < samples; i += 1) {
      const start = Date.now();
      try {
        const response = await this.generate({
          model,
          prompt,
          options,
          lane,
          workloadType: 'benchmark',
          allowFallback: true,
          priority: 5,
        });
        const elapsedMs = Date.now() - start;
        const text = String(response?.response || response?.message?.content || '');
        const estimatedTokens = Math.max(1, Math.round(text.length / 4));
        runs.push({
          ok: true,
          elapsedMs,
          estimatedTokens,
          tokensPerSecond: Number((estimatedTokens / Math.max(0.001, elapsedMs / 1000)).toFixed(2)),
        });
      } catch (error) {
        runs.push({
          ok: false,
          elapsedMs: Date.now() - start,
          error: error.message,
        });
      }
    }

    const successes = runs.filter((r) => r.ok);
    const avgLatencyMs = successes.length
      ? Math.round(successes.reduce((sum, row) => sum + row.elapsedMs, 0) / successes.length)
      : null;
    const avgTps = successes.length
      ? Number((successes.reduce((sum, row) => sum + row.tokensPerSecond, 0) / successes.length).toFixed(2))
      : null;

    return {
      ok: successes.length > 0,
      model,
      backend: this.currentBackend?.id || null,
      samples,
      warmup,
      avgLatencyMs,
      avgTokensPerSecond: avgTps,
      successCount: successes.length,
      failureCount: runs.length - successes.length,
      runs,
      runtime: this.getRuntimeState(),
    };
  }

  async embedTexts(texts = [], options = {}) {
    const payload = Array.isArray(texts)
      ? texts.map((item) => String(item || '')).filter(Boolean)
      : [];

    if (payload.length === 0) {
      return {
        ok: true,
        vectors: [],
        route: null,
        fallbackReason: 'no-texts',
        count: 0,
      };
    }

    const lane = normalizeLane(options.lane || 'lane_embedding', options.workloadType || 'embedding');
    const priority = this._resolvePriority(options.priority);
    const modelName = String(options.modelName || 'nomic-embed-text');
    const preferNpu = options.preferNpu !== false;
    const allowFallback = options.allowFallback !== false;
    const ollamaEndpoint = this.store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const openvinoEndpoint = this.store?.get('openvinoEndpoint') || 'http://127.0.0.1:8081';

    const meta = {
      mode: 'embed',
      lane,
      model: modelName,
      workloadType: options.workloadType || 'embedding',
    };

    return this.jobQueue.enqueue(async () => {
      const powerMode = getPowerMode();
      if (!powerMode.enabled) {
        await powerMode.enable();
      }

      try {
        const routed = await embedTextsWithRouting({
          texts: payload,
          ollamaEndpoint,
          openvinoEndpoint,
          modelName,
          preferNpu,
        });

        const ok = Array.isArray(routed?.vectors) && routed.vectors.length === payload.length;
        const fallbackReason = routed?.fallbackReason || (ok ? null : 'embedding-failed');

        this._recordDecision({
          mode: 'embed',
          lane,
          model: modelName,
          backend: routed?.route || null,
          fallbackReason: fallbackReason || null,
        });

        if (!ok && !allowFallback) {
          throw new Error(fallbackReason || 'embedding-failed');
        }

        return {
          ok,
          vectors: routed?.vectors || [],
          route: routed?.route || null,
          fallbackReason: fallbackReason || null,
          count: Array.isArray(routed?.vectors) ? routed.vectors.length : 0,
          requested: payload.length,
        };
      } finally {
        this._scheduleIdlePowerDown();
      }
    }, { lane, priority, meta });
  }

  async getModels() {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }
    if (!this.currentBackend) return [];
    return this.currentBackend.getModels();
  }

  async loadModel(modelName) {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }
    if (!this.currentBackend) {
      throw new Error('No available backend');
    }
    return this.currentBackend.loadModel(modelName);
  }

  async cancel(requestId) {
    for (const backend of this.backends.values()) {
      if (typeof backend.cancel !== 'function') continue;
      const result = await backend.cancel(requestId);
      if (result?.success) return result;
    }
    return { success: false, error: 'Request not found' };
  }

  async checkHealth() {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }
    if (!this.currentBackend) {
      return { healthy: false, status: 'no-backend' };
    }
    const health = await this._safeBackendHealth(this.currentBackend);
    return {
      healthy: health.available,
      status: health.status,
      backend: this.currentBackend.id,
      ...health,
    };
  }

  setProfile(profile) {
    if (!PROFILE_ORDER[profile]) profile = 'balanced';
    this.profile = profile;
    this.store?.set('performanceProfile', profile);
    this._applyLanePolicy();
  }

  getProfile() {
    return this.profile;
  }

  getJobPriority() {
    return PROFILE_PRIORITY[this.profile] ?? 0;
  }

  getRuntimeState() {
    const queueState = this.jobQueue.getState();
    const evidenceRows = Array.from(this.offloadEvidence.entries()).slice(-25).map(([key, value]) => ({
      key,
      ...value,
    }));

    return {
      profile: this.profile,
      preferredBackendId: this.preferredBackendId || 'auto',
      currentBackend: this.getCurrentBackend(),
      queue: queueState,
      fallbackCounters: { ...this.fallbackCounters },
      recentDecisions: [...this.recentDecisions].slice(-40),
      offloadEvidence: evidenceRows,
      hardware: {
        gpuCount: this.hardware?.gpus?.length || 0,
        hasNpu: Boolean(this.hardware?.npu?.detected),
        cpu: this.hardware?.cpu?.brand || null,
      },
      timestamp: Date.now(),
    };
  }

  getRecommendation(modelParams) {
    const recommendations = [];
    for (const [id, backend] of this.backends) {
      const perf = backend.estimatePerformance(modelParams);
      if (perf.suitable) {
        recommendations.push({
          backendId: id,
          backendName: backend.name,
          device: backend.device,
          ...perf,
        });
      }
    }
    recommendations.sort((a, b) => {
      if (typeof a.tokensPerSecond === 'number' && typeof b.tokensPerSecond === 'number') {
        return b.tokensPerSecond - a.tokensPerSecond;
      }
      return 0;
    });
    return recommendations;
  }

  _scheduleIdlePowerDown() {
    if (this._idlePowerDownTimeout) {
      clearTimeout(this._idlePowerDownTimeout);
    }
    this._idlePowerDownTimeout = setTimeout(async () => {
      const powerMode = getPowerMode();
      if (powerMode.enabled && this.jobQueue.isEmpty()) {
        await powerMode.disable();
      }
    }, 120000);
  }
}

let orchestratorInstance = null;

function getOrchestrator(store) {
  if (!orchestratorInstance) {
    orchestratorInstance = new InferenceOrchestrator(store);
  }
  return orchestratorInstance;
}

module.exports = {
  InferenceOrchestrator,
  getOrchestrator,
};
