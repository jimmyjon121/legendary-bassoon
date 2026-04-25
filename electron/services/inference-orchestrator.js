/**
 * Inference Orchestrator
 * Unified routing for chat, streaming, warmup and benchmark requests.
 */

const OllamaBackend = require('./backends/ollama-backend');
const LlamaCppBackend = require('./backends/llamacpp-backend');
const LlamaNodeBackend = require('./backends/llamanode-backend');
const OpenVinoBackend = require('./backends/openvino-backend');
const { isGgufModelId } = require('./backends/llamanode-backend');
const { getLaneCandidates } = require('./lane-registry');
const hardwareDetection = require('./hardware-detection');
const JobQueue = require('./job-queue');
const { getPowerMode } = require('./power-mode');
const { embedTextsWithRouting } = require('./embedding-service');
const draftSelector = require('./draft-selector');
const { createSpecDecodeBus } = require('./spec-decode-bus');
const { verifySpecBatch, verifyTreeBatch } = require('./spec-decode-verifier');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROFILE_ORDER_STANDARD = {
  // Standard mode now registers NPU and Intel Arc passively when the
  // hardware is present (Phase 1). openvino-npu appears as a secondary
  // option in all profiles so lane routing can pick it for small-model
  // / embedding / classifier workloads without flipping Unified Brain.
  //
  // speed/balanced: RTX-first (NVIDIA CUDA), NPU after as a helper.
  // efficiency/laptop: NPU-first for small workloads, RTX behind.
  speed: ['ollama-cuda', 'llamanode', 'openvino-npu', 'openvino-gpu', 'llamacpp-vulkan', 'ollama-cpu'],
  balanced: ['ollama-cuda', 'llamanode', 'openvino-npu', 'openvino-gpu', 'llamacpp-vulkan', 'ollama-cpu'],
  efficiency: ['openvino-npu', 'llamanode', 'llamacpp-vulkan', 'openvino-gpu', 'ollama-cuda', 'ollama-cpu'],
  laptop: ['openvino-npu', 'llamanode', 'llamacpp-vulkan', 'openvino-gpu', 'ollama-cpu', 'ollama-cuda'],
};

const PROFILE_ORDER_UNIFIED = {
  speed: ['openvino-hybrid', 'ollama-cuda', 'openvino-npu', 'llamanode', 'llamacpp-vulkan', 'ollama-cpu'],
  balanced: ['openvino-hybrid', 'openvino-npu', 'ollama-cuda', 'llamanode', 'llamacpp-vulkan', 'ollama-cpu'],
  efficiency: ['openvino-npu', 'openvino-hybrid', 'llamanode', 'llamacpp-vulkan', 'ollama-cuda', 'ollama-cpu'],
  laptop: ['openvino-npu', 'llamanode', 'llamacpp-vulkan', 'openvino-hybrid', 'ollama-cpu', 'ollama-cuda'],
};

const PROFILE_PRIORITY = {
  speed: -15,
  balanced: 0,
  efficiency: 10,
  laptop: -5,
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

const MAX_OFFLOAD_EVIDENCE_ROWS = 80;

let npuBridgeModule = null;

function getLazyNpuBridge() {
  if (!npuBridgeModule) {
    npuBridgeModule = require('./npu-bridge');
  }
  return npuBridgeModule.getNpuBridge();
}

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

function isSyntheticNpuModel(modelName = '') {
  return String(modelName || '').trim().toLowerCase().startsWith('npu:');
}

function unwrapSyntheticModel(modelName = '') {
  const raw = String(modelName || '').trim();
  if (!isSyntheticNpuModel(raw)) return raw;
  return raw.slice(4).trim();
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
    this.streamEvents = [];
    this.warmloopTransitions = [];
    // Phase 2: speculative-decoding outcome history per main+draft pair.
    // Each entry is { pair, accepted, total, mainTokensPerSec,
    // baselineTokensPerSec, ts }. Auto-disable evaluates the rolling
    // window when new outcomes land; the disabled set is queried by
    // the orchestrator before routing through the verifier loop.
    this.specDecodeOutcomes = [];
    this.specDecodeAutoDisabled = new Set();
    this.specDecodeRecentSinceDisable = new Map();
    this.specDecodeConfig = {
      disableThreshold: 0.4,
      windowSize: 50,
      autoReenableTurns: 100,
    };
    this.lastBackendDecision = null;
    this.lastExecutionPlan = null;
    this._applyLanePolicy();
  }

  _attachStore(store) {
    if (!store) return;
    this.store = store;

    const nextProfile = String(store?.get?.('performanceProfile') || '').trim().toLowerCase();
    if (nextProfile && PROFILE_PRIORITY[nextProfile] !== undefined) {
      this.profile = nextProfile;
    }

    const nextPreferredBackend = String(store?.get?.('preferredBackend') || '').trim();
    if (nextPreferredBackend) {
      this.preferredBackendId = nextPreferredBackend;
    }

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
    } else if (this.profile === 'laptop') {
      // Keep laptop responsive: favor interactive lane and limit concurrent heavy jobs.
      laneConfig.lane_agent = { concurrency: 1, priorityBase: 8 };
      laneConfig.lane_embedding = { concurrency: hasNpu ? 2 : 1, priorityBase: -18 };
      laneConfig.lane_maintenance = { concurrency: 1, priorityBase: 26 };
      maxConcurrent = hasNpu ? 2 : 1;
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
    if (this.preferredBackendId === 'auto') {
      const fallback = this.backends.has('ollama-cuda') ? 'ollama-cuda' : 'ollama-cpu';
      this.preferredBackendId = fallback;
      this.store?.set?.('preferredBackend', fallback);
      console.log('[Orchestrator] Defaulting preferred backend to', fallback);
    }
    this._applyLanePolicy();
    await this.selectOptimalBackend();
    this.initialized = true;
    console.log('[Orchestrator] Initialized with backend:', this.currentBackend?.id);

    // Phase 1: start the NPU warm-loop in the background so embeddings /
    // autocomplete / classifier work hits a warm model. Gated internally
    // on RAM, battery, and profile — safe to fire-and-forget here.
    this._startNpuWarmloop().catch((err) => {
      console.warn('[Orchestrator] NPU warmloop start failed:', err?.message || err);
    });
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

    // Direct GGUF runtime via node-llama-cpp. Registered unconditionally so
    // local GGUF files (LM Studio imports, HF downloads) load in-process
    // without needing Ollama's "ollama create" blob-copy path. The backend
    // lazy-loads the native module and reports as offline if the install
    // failed, so registration is always safe.
    const primaryGpu = this.hardware.gpus?.find((g) => g.type === 'nvidia')
      || this.hardware.gpus?.find((g) => g.type === 'intel-arc')
      || null;
    this.backends.set('llamanode', new LlamaNodeBackend({
      id: 'llamanode',
      name: primaryGpu?.name ? `llama.cpp (in-process, ${primaryGpu.name})` : 'llama.cpp (in-process)',
      device: primaryGpu?.name || 'auto',
      useGpu: Boolean(primaryGpu),
      priority: 2,
    }));

    const hasArcGpu = this.hardware.gpus?.some((g) => g.type === 'intel-arc');
    if (hasArcGpu) {
      const arcGpu = this.hardware.gpus.find((g) => g.type === 'intel-arc');
      this.backends.set('llamacpp-vulkan', new LlamaCppBackend({
        endpoint: llamaCppEndpoint,
        device: arcGpu?.name || 'Intel Arc GPU',
        useVulkan: true,
        priority: 3,
      }));
    }

    // Phase 1: NPU and Intel Arc iGPU are registered whenever the hardware
    // is detected, regardless of preferredBackend. The OpenVINO Python
    // server stays lazy-spawned (Phase 0 work) so "registered" costs
    // nothing at boot until a request actually routes to that backend.
    //
    // Unified Brain (openvino-hybrid) still requires explicit user opt-in
    // because HETERO:GPU,NPU has real tradeoffs — it blocks the NVIDIA
    // discrete GPU for the duration and has a different performance curve.
    await this._registerPassiveOpenVinoBackends();

    const prefBackend = this.preferredBackendId || '';
    const userWantsHybrid = prefBackend.includes('hybrid');
    if (userWantsHybrid) {
      await this._registerOpenVinoBackends();
    }

    await this.checkAllBackends();
  }

  /**
   * Register NPU + Intel Arc OpenVINO backends whenever the hardware is
   * detected. These are passive: the Python server only spawns when a
   * request actually routes to one of them. No user opt-in required.
   */
  async _registerPassiveOpenVinoBackends() {
    const openvinoEndpoint = this.store?.get('openvinoEndpoint') || 'http://127.0.0.1:8081';
    const hasArcGpu = this.hardware?.gpus?.some((g) => g.type === 'intel-arc');
    const npuDetected = Boolean(this.hardware?.npu?.detected);

    if (npuDetected && !this.backends.has('openvino-npu')) {
      this.backends.set('openvino-npu', new OpenVinoBackend({
        device: 'NPU',
        endpoint: openvinoEndpoint,
        priority: 3,
      }));
      console.log('[Orchestrator] NPU detected — registered openvino-npu (passive, lazy-spawn)');
    }

    if (hasArcGpu && !this.backends.has('openvino-gpu')) {
      this.backends.set('openvino-gpu', new OpenVinoBackend({
        device: 'GPU',
        endpoint: openvinoEndpoint,
        priority: 4,
      }));
      console.log('[Orchestrator] Intel Arc iGPU detected — registered openvino-gpu (passive, lazy-spawn)');
    }

    // If hardware.npu.detected is false but OpenVINO enumerates an NPU
    // device, trust OpenVINO and backfill the hardware flag so lane
    // routing works. Runs async so the rest of init doesn't block on
    // a Python subprocess; the lazy registration catches up before
    // the first request.
    if (!npuDetected && !this.backends.has('openvino-npu')) {
      this._lazyDiscoverNpu(openvinoEndpoint).catch((err) => {
        console.warn('[Orchestrator] Lazy NPU discovery failed:', err?.message || err);
      });
    }
  }

  async _lazyDiscoverNpu(openvinoEndpoint) {
    try {
      const npuBridge = getLazyNpuBridge();
      const installation = await npuBridge.checkOpenVinoInstallation();
      if (!installation?.installed) return;
      const devicesResult = await npuBridge.queryDevices({ force: true });
      if (!devicesResult?.npuAvailable) return;
      if (this.backends.has('openvino-npu')) return;

      console.log('[Orchestrator] Lazy NPU discovery: OpenVINO enumerates NPU — registering');
      this.backends.set('openvino-npu', new OpenVinoBackend({
        device: 'NPU',
        endpoint: openvinoEndpoint,
        priority: 3,
      }));
      if (!this.hardware.npu) this.hardware.npu = {};
      this.hardware.npu.detected = true;
    } catch (err) {
      console.warn('[Orchestrator] Lazy NPU discovery error:', err?.message || err);
    }
  }

  /**
   * Register the Unified Brain backend (HETERO:GPU,NPU). Requires explicit
   * user opt-in since it's not a free default — it changes how the whole
   * inference path behaves and conflicts with NVIDIA-based Ollama routing.
   */
  async _registerOpenVinoBackends() {
    const openvinoEndpoint = this.store?.get('openvinoEndpoint') || 'http://127.0.0.1:8081';

    // Make sure NPU + iGPU passive registration ran first.
    await this._registerPassiveOpenVinoBackends();

    if (this.backends.has('openvino-npu') || this.hardware?.npu?.detected) {
      try {
        const bridge = getLazyNpuBridge();
        await bridge.queryDevices({ force: true });
        const hybridCaps = bridge._getHybridCapabilitiesSync();
        const hybridStatus = bridge.getHybridStatus();
        if (!this.backends.has('openvino-hybrid') && (hybridCaps.canHetero || hybridStatus.enabled)) {
          const hybridDevice = hybridStatus.enabled
            ? (hybridStatus.device || 'HETERO:GPU,NPU')
            : (hybridCaps.recommended?.device || 'HETERO:GPU,NPU');
          this.backends.set('openvino-hybrid', new OpenVinoBackend({
            id: 'openvino-hybrid',
            name: 'Unified Brain (GPU+NPU)',
            device: hybridDevice,
            endpoint: openvinoEndpoint,
            priority: 0,
          }));
          console.log('[Orchestrator] Registered Unified Brain backend:', hybridDevice);
        }
      } catch (err) {
        console.warn('[Orchestrator] Unified Brain backend registration failed:', err?.message);
      }
    }
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

  _isUnifiedBrainActive() {
    const pref = this.preferredBackendId || '';
    return pref.includes('openvino') || pref.includes('hybrid');
  }

  _orderedBackendIdsForProfile(profile = this.profile) {
    const table = this._isUnifiedBrainActive() ? PROFILE_ORDER_UNIFIED : PROFILE_ORDER_STANDARD;
    const order = table[profile] || table.balanced;
    const listed = order.filter((id) => this.backends.has(id));
    const remaining = Array.from(this.backends.keys()).filter((id) => !listed.includes(id));
    return [...listed, ...remaining];
  }

  _getPreferredOpenVinoBackendIds() {
    const preferred = String(this.preferredBackendId || '').trim();
    const ordered = [];
    const push = (backendId) => {
      if (this.backends.has(backendId) && !ordered.includes(backendId)) {
        ordered.push(backendId);
      }
    };

    if (preferred.startsWith('openvino')) {
      push(preferred);
    }

    push('openvino-npu');
    push('openvino-hybrid');
    push('openvino-gpu');

    return ordered;
  }

  async _tryStartNpuServer(context = {}) {
    const cooldownKey = '_npuStartCooldown';
    const now = Date.now();
    if (this[cooldownKey] && now - this[cooldownKey] < 30000) {
      return false;
    }

    try {
      const npuBridge = getLazyNpuBridge();
      const status = await npuBridge.getStatus();

      if (!status.openvinoInstalled) {
        console.warn('[Orchestrator] NPU skipped: OpenVINO not installed');
        this[cooldownKey] = now;
        return false;
      }
      if (status.serverRunning) return true;

      console.log('[Orchestrator] Attempting NPU server start...');
      const preferredModel = unwrapSyntheticModel(context.preferredModel || null) || null;
      await npuBridge.autoConfigureModel({
        enableAutoStart: true,
        workload: context.workload || 'chat',
        profile: context.profile || this.profile,
        preferredModel,
        forceStatusRefresh: true,
      });
      const result = await npuBridge.startServer();
      if (result?.success) {
        console.log('[Orchestrator] NPU server started successfully');
        return true;
      }
      console.warn('[Orchestrator] NPU start returned:', result?.error || 'unknown failure');
      this[cooldownKey] = now;
      return false;
    } catch (error) {
      console.warn('[Orchestrator] NPU auto-start error:', error.message);
      this[cooldownKey] = now;
      return false;
    }
  }

  async selectOptimalBackend(modelSize = null, modelName = '') {
    const requestedModel = String(modelName || this.store?.get?.('currentModel') || '').trim();
    const effectiveModelSize = modelSize ?? parseModelSizeHint(requestedModel);
    const modelRequiresOpenVino = isSyntheticNpuModel(requestedModel);
    const preferredIsNpu = this.preferredBackendId?.includes('npu') || this.preferredBackendId?.includes('openvino');
    const modelNeedsOllama = this._isOllamaOnlyModel(requestedModel);

    if (modelRequiresOpenVino) {
      const openvinoBackends = this._getPreferredOpenVinoBackendIds();
      for (const backendId of openvinoBackends) {
        const backend = this.backends.get(backendId);
        if (!backend) continue;

        let health = await this._safeBackendHealth(backend);
        if (!health.available) {
          const started = await this._tryStartNpuServer({
            workload: 'interactive',
            profile: this.profile,
            preferredModel: requestedModel || null,
          });
          if (started) {
            health = await this._safeBackendHealth(backend);
          }
        }

        if (health.available) {
          this.currentBackend = backend;
          return backend;
        }
      }

      this.currentBackend = null;
      return null;
    }

    // If NPU is preferred but model requires Ollama, go straight to GPU
    if (preferredIsNpu && modelNeedsOllama) {
      const cudaBackend = this.backends.get('ollama-cuda');
      if (cudaBackend) {
        const health = await this._safeBackendHealth(cudaBackend);
        if (health.available) {
          console.log('[Orchestrator] selectOptimalBackend: model', modelName, 'needs Ollama — using ollama-cuda');
          this.currentBackend = cudaBackend;
          return cudaBackend;
        }
      }
    }

    if (!(preferredIsNpu && modelNeedsOllama) && this.preferredBackendId && this.preferredBackendId !== 'auto') {
      const preferred = this.backends.get(this.preferredBackendId);
      if (preferred) {
        const health = await this._safeBackendHealth(preferred);
        if (health.available) {
          this.currentBackend = preferred;
          return preferred;
        }
        if (preferredIsNpu) {
          const started = await this._tryStartNpuServer({
            workload: 'interactive',
            profile: this.profile,
          });
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

    if (effectiveModelSize !== null && this.hardware?.npu?.detected && effectiveModelSize <= 3 && !modelNeedsOllama) {
      const npuBackend = this.backends.get('openvino-npu');
      if (npuBackend) {
        let health = await this._safeBackendHealth(npuBackend);
        if (!health.available) {
          const started = await this._tryStartNpuServer({
            workload: 'interactive',
            profile: this.profile,
          });
          if (started) health = await this._safeBackendHealth(npuBackend);
        }
        if (health.available) {
          this.currentBackend = npuBackend;
          return npuBackend;
        }
      }
    }

    // Prefer GPU over CPU in fallback ordering
    const gpuFirst = ['ollama-cuda', 'llamacpp-vulkan'];
    for (const gpuId of gpuFirst) {
      const backend = this.backends.get(gpuId);
      if (!backend) continue;
      const health = await this._safeBackendHealth(backend);
      if (health.available) {
        this.currentBackend = backend;
        return backend;
      }
    }

    const ordered = this._orderedBackendIdsForProfile()
      .filter((backendId) => !(modelNeedsOllama && backendId.startsWith('openvino')));
    for (const backendId of ordered) {
      const backend = this.backends.get(backendId);
      if (!backend) continue;
      const health = await this._safeBackendHealth(backend);
      if (health.available) {
        this.currentBackend = backend;
        return backend;
      }
    }

    const cpuFallback = this.backends.get('ollama-cpu') || null;
    if (cpuFallback) {
      const cpuHealth = await this._safeBackendHealth(cpuFallback);
      if (cpuHealth.available) {
        this.currentBackend = cpuFallback;
        return this.currentBackend;
      }
    }

    this.currentBackend = null;
    return null;
  }

  async setPreferredBackend(backendId) {
    const oldPref = this.preferredBackendId || '';
    this.preferredBackendId = backendId;
    this.store?.set('preferredBackend', backendId);

    const wasOpenVino = oldPref.includes('openvino') || oldPref.includes('hybrid');
    const nowOpenVino = backendId.includes('openvino') || backendId.includes('hybrid');

    // Register OpenVINO backends additively when the user first opts into a
    // hybrid/NPU path — we never tear down existing backends. The one-runtime-
    // family-at-a-time invariant (OpenVINO server vs pure Ollama on the same
    // GPU) is preserved by lazy-spawning the OpenVINO Python server only when
    // a request actually routes there. Switching back to a non-OpenVINO
    // preferred backend leaves the existing registrations in place so chat
    // streams never observe "backend unavailable" mid-flight.
    if (nowOpenVino && !wasOpenVino) {
      console.log('[Orchestrator] Mode switch: Standard → Unified — registering OpenVINO backends additively');
      try {
        await this._registerOpenVinoBackends();
      } catch (err) {
        console.warn('[Orchestrator] OpenVINO registration on mode switch failed:', err?.message);
      }
    } else if (!nowOpenVino && wasOpenVino) {
      console.log('[Orchestrator] Mode switch: Unified → Standard — keeping OpenVINO backends registered (lazy, idle)');
    }

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

  recordStreamEvent(event = {}) {
    const type = String(event?.type || '').trim().toLowerCase();
    if (!type) return;
    const ts = Number(event?.ts);
    const row = {
      ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      type,
      streamId: String(event?.streamId || '').trim() || null,
      code: String(event?.code || '').trim() || null,
      reason: String(event?.reason || '').trim() || null,
      firstTokenMs: Number.isFinite(Number(event?.firstTokenMs)) ? Number(event.firstTokenMs) : null,
      tokensPerSecond: Number.isFinite(Number(event?.tokensPerSecond)) ? Number(event.tokensPerSecond) : null,
      requestedModel: String(event?.requestedModel || '').trim() || null,
      effectiveModel: String(event?.effectiveModel || '').trim() || null,
      backendId: String(event?.backendId || '').trim() || null,
      lane: String(event?.lane || '').trim() || null,
    };
    this.streamEvents.push(row);
    if (this.streamEvents.length > 300) {
      this.streamEvents.shift();
    }
  }

  // Phase 2: speculative-decoding telemetry. The orchestrator's
  // dashboard reads aggregated stats; the auto-disable state machine
  // toggles a pair off when its rolling acceptance rate falls below
  // the configured threshold. Re-enables after autoReenableTurns
  // worth of fresh non-spec turns observed on the same pair.
  recordSpecDecodeOutcome(outcome = {}) {
    const pair = String(outcome?.pair || '').trim();
    if (!pair) return;
    const accepted = Math.max(0, Number(outcome.accepted) || 0);
    const total = Math.max(accepted, Number(outcome.total) || 0);
    const row = {
      ts: Number.isFinite(Number(outcome.ts)) && outcome.ts > 0 ? Number(outcome.ts) : Date.now(),
      pair,
      accepted,
      total,
      acceptanceRate: total > 0 ? accepted / total : 0,
      mainTokensPerSec: Number.isFinite(Number(outcome.mainTokensPerSec)) ? Number(outcome.mainTokensPerSec) : null,
      baselineTokensPerSec: Number.isFinite(Number(outcome.baselineTokensPerSec)) ? Number(outcome.baselineTokensPerSec) : null,
    };
    this.specDecodeOutcomes.push(row);
    if (this.specDecodeOutcomes.length > 1000) {
      this.specDecodeOutcomes.shift();
    }
    this._evaluateSpecDecodeAutoDisable(pair);
  }

  _evaluateSpecDecodeAutoDisable(pair) {
    const cfg = this.specDecodeConfig || { disableThreshold: 0.4, windowSize: 50, autoReenableTurns: 100 };
    const recent = this.specDecodeOutcomes.filter((row) => row.pair === pair).slice(-cfg.windowSize);
    if (recent.length < Math.max(5, Math.floor(cfg.windowSize / 5))) {
      // Need enough samples to make a confident call.
      return;
    }
    const avgRate = recent.reduce((sum, row) => sum + row.acceptanceRate, 0) / recent.length;
    if (avgRate < cfg.disableThreshold) {
      if (!this.specDecodeAutoDisabled.has(pair)) {
        this.specDecodeAutoDisabled.add(pair);
        this.specDecodeRecentSinceDisable.set(pair, 0);
      }
    } else if (this.specDecodeAutoDisabled.has(pair)) {
      const fresh = (this.specDecodeRecentSinceDisable.get(pair) || 0) + recent.length;
      this.specDecodeRecentSinceDisable.set(pair, fresh);
      if (fresh >= cfg.autoReenableTurns) {
        this.specDecodeAutoDisabled.delete(pair);
        this.specDecodeRecentSinceDisable.delete(pair);
      }
    }
  }

  isSpecDecodeDisabled(pair) {
    const key = String(pair || '').trim();
    if (!key) return false;
    return this.specDecodeAutoDisabled.has(key);
  }

  // Returns the most recent spec-decode outcome row for the requested
  // pair (or any pair when omitted). Read this *after* an orchestrator
  // stream turn to attribute acceptance to the just-completed batch
  // instead of averaging across earlier turns. Returns null when no
  // matching row exists.
  getLastSpecDecodeOutcome(pair = null) {
    const filterPair = pair ? String(pair).trim() : null;
    for (let i = this.specDecodeOutcomes.length - 1; i >= 0; i -= 1) {
      const row = this.specDecodeOutcomes[i];
      if (!filterPair || row.pair === filterPair) {
        return { ...row };
      }
    }
    return null;
  }

  getSpecDecodeStats({ pair = null, windowSize = null } = {}) {
    const cfg = this.specDecodeConfig || { windowSize: 50 };
    const window = Math.max(1, Math.floor(Number(windowSize) || cfg.windowSize));
    const filter = (row) => (pair ? row.pair === pair : true);
    const filtered = this.specDecodeOutcomes.filter(filter).slice(-window);
    const byPair = new Map();
    for (const row of filtered) {
      const bucket = byPair.get(row.pair) || { pair: row.pair, accepted: 0, total: 0, count: 0 };
      bucket.accepted += row.accepted;
      bucket.total += row.total;
      bucket.count += 1;
      byPair.set(row.pair, bucket);
    }
    const pairs = [...byPair.values()].map((b) => ({
      ...b,
      acceptanceRate: b.total > 0 ? b.accepted / b.total : 0,
      autoDisabled: this.specDecodeAutoDisabled.has(b.pair),
    }));
    const last = filtered[filtered.length - 1] || null;
    return {
      windowSize: window,
      lastAcceptanceRate: last ? last.acceptanceRate : 0,
      pairs,
      autoDisabled: [...this.specDecodeAutoDisabled],
      config: { ...cfg },
    };
  }

  recordWarmloopTransition(transition = {}) {
    const ts = Number(transition?.ts);
    const row = {
      ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      active: Boolean(transition?.active),
      reason: String(transition?.reason || 'unknown'),
      model: String(transition?.model || '').trim() || null,
    };
    this.warmloopTransitions.push(row);
    if (this.warmloopTransitions.length > 200) {
      this.warmloopTransitions.shift();
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
      // Primary: try Ollama /api/ps
      try {
        const ps = await backend.getGpuInfo?.();
        const models = Array.isArray(ps?.models) ? ps.models : [];
        const lowerTarget = String(modelName || '').toLowerCase();
        const matched = models.find((row) => {
          const name = String(row?.name || '').toLowerCase();
          return lowerTarget ? name.includes(lowerTarget.split(':')[0]) : false;
        });
        const sizeVram = Number(matched?.size_vram || 0);
        if (sizeVram > 0) {
          return {
            ...base,
            verified: true,
            method: 'ollama:/api/ps',
            sizeVram,
            details: matched || null,
          };
        }
      } catch {
        // /api/ps failed or timed out — fall through to nvidia-smi
      }

      // Fallback: use nvidia-smi directly. This never blocks even when Ollama
      // is busy loading a model.
      if (backend.useCuda) {
        try {
          const nvidiaSmi = await this._queryNvidiaSmi();
          if (nvidiaSmi && nvidiaSmi.vramUsed > 200) {
            return {
              ...base,
              verified: true,
              method: 'nvidia-smi',
              sizeVram: nvidiaSmi.vramUsed * 1024 * 1024,
              details: nvidiaSmi,
            };
          }
        } catch {
          // nvidia-smi not available
        }
      }

      return base;
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

  async _queryNvidiaSmi() {
    // `nvidia-smi` is best-effort telemetry and simply resolves null when the
    // command is unavailable on the current machine.
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
        { timeout: 3000 },
        (error, stdout) => {
          if (error || !stdout?.trim()) { resolve(null); return; }
          try {
            const parts = stdout.trim().split(',').map(s => parseFloat(s.trim()));
            if (parts.length >= 3 && parts.every(v => Number.isFinite(v))) {
              resolve({
                utilizationGpu: Math.round(parts[0]),
                vramUsed: Math.round(parts[1]),
                vramTotal: Math.round(parts[2]),
              });
            } else { resolve(null); }
          } catch { resolve(null); }
        }
      );
    });
  }

  _lanePreferenceRank(lane, backendId) {
    const unified = this._isUnifiedBrainActive();
    const lanePreference = unified ? {
      lane_embedding: ['openvino-npu', 'openvino-gpu', 'ollama-cuda', 'ollama-cpu', 'llamacpp-vulkan'],
      lane_maintenance: ['openvino-npu', 'ollama-cuda', 'openvino-gpu', 'ollama-cpu', 'llamacpp-vulkan'],
      lane_agent: ['openvino-npu', 'ollama-cuda', 'llamacpp-vulkan', 'openvino-gpu', 'ollama-cpu'],
      lane_interactive: ['openvino-npu', 'ollama-cuda', 'llamacpp-vulkan', 'openvino-gpu', 'ollama-cpu'],
    } : {
      lane_embedding: ['ollama-cuda', 'ollama-cpu', 'llamacpp-vulkan'],
      lane_maintenance: ['ollama-cuda', 'ollama-cpu', 'llamacpp-vulkan'],
      lane_agent: ['ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu'],
      lane_interactive: ['ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu'],
    };
    const order = lanePreference[lane] || lanePreference.lane_interactive;
    const idx = order.indexOf(backendId);
    return idx === -1 ? order.length : idx;
  }

  _scoreBackendCandidate({ backendId, backend, lane, modelSize, baseOrderRank }) {
    let score = 0;

    const laneRank = this._lanePreferenceRank(lane, backendId);
    score += Math.max(0, 55 - laneRank * 10);
    score += Math.max(0, 24 - baseOrderRank * 4);

    if (modelSize !== null && Number.isFinite(modelSize)) {
      const perf = backend.estimatePerformance(modelSize);
      if (perf?.suitable === false) {
        score -= 120;
      } else {
        const tps = Number(perf?.tokensPerSecond || 0);
        if (Number.isFinite(tps)) {
          score += Math.min(45, tps);
        }
      }

      if (backendId === 'openvino-npu') {
        if (modelSize <= 3) score += 18;
        else if (modelSize <= 7) score += 4;
        else score -= 45;
      }
      if (backendId === 'ollama-cuda') {
        if (modelSize >= 7) score += 16;
        else if (modelSize >= 3) score += 8;
      }
      if (backendId === 'ollama-cpu') {
        score -= 50;
      }
    }

    if (lane === 'lane_embedding') {
      if (backend.supports?.('embeddings')) score += 22;
      if (backendId === 'openvino-npu') score += 8;
    }

    // CPU is always a last resort — user explicitly wants NPU/GPU to carry the load
    if (backendId === 'ollama-cpu') score -= 80;

    if (this.profile === 'speed' && backendId === 'ollama-cuda') score += 10;
    if (this.profile === 'efficiency' && backendId === 'openvino-npu') score += 10;
    if (this.profile === 'laptop') {
      if (lane === 'lane_interactive' && backendId === 'ollama-cuda') score += 10;
      if ((lane === 'lane_embedding' || lane === 'lane_maintenance') && backendId === 'openvino-npu') score += 16;
      if (backendId === 'ollama-cpu') score -= 10;
    }

    if (this.hardware?.npu?.detected && backendId === 'openvino-npu') score += 4;
    if (Array.isArray(this.hardware?.gpus) && this.hardware.gpus.some((gpu) => gpu.type === 'nvidia') && backendId === 'ollama-cuda') {
      score += 4;
    }

    return score;
  }

  _isSpecDecodeWorkload(payload = {}) {
    const workload = String(payload?.workloadType || '').toLowerCase();
    if (workload && !['chat', 'chat-main', 'chat-long'].includes(workload)) return false;
    const lane = normalizeLane(payload?.lane, payload?.workloadType);
    return lane === 'lane_interactive' || lane === 'lane_agent' || !lane;
  }

  _normalizeModelKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/^gguf:/, '')
      .replace(/:latest$/, '')
      .replace(/\.gguf$/, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  _resolveOllamaBlobForModel(modelName) {
    const raw = String(modelName || '').trim();
    if (!raw || raw.startsWith('gguf:') || raw.includes('\\') || raw.includes('/')) return null;

    const [namePart, tagPart = 'latest'] = raw.split(':');
    const parts = namePart.split('/').filter(Boolean);
    const namespace = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : 'library';
    const model = parts[parts.length - 1];
    const tag = tagPart || 'latest';
    const manifestPath = path.join(
      os.homedir(),
      '.ollama',
      'models',
      'manifests',
      'registry.ollama.ai',
      namespace,
      model,
      tag,
    );

    try {
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const modelLayer = (Array.isArray(manifest?.layers) ? manifest.layers : [])
        .find((layer) => String(layer?.mediaType || '').includes('application/vnd.ollama.image.model'));
      const digest = String(modelLayer?.digest || '').trim();
      if (!digest.startsWith('sha256:')) return null;
      const blobPath = path.join(os.homedir(), '.ollama', 'models', 'blobs', digest.replace(':', '-'));
      if (!fs.existsSync(blobPath)) return null;
      return `gguf:${blobPath}`;
    } catch {
      return null;
    }
  }

  _resolveLocalGgufForModel(modelName) {
    const raw = String(modelName || '').trim();
    if (!raw) return null;
    if (isGgufModelId(raw)) return raw;

    const normalizedTarget = this._normalizeModelKey(raw);
    const catalog = Array.isArray(this.store?.get?.('localGgufCatalog'))
      ? this.store.get('localGgufCatalog')
      : [];
    for (const entry of catalog) {
      const entryPath = String(entry?.path || '').trim();
      if (!entryPath || !fs.existsSync(entryPath)) continue;
      const candidates = [
        entry?.id,
        entry?.name,
        path.basename(entryPath),
        path.basename(entryPath, path.extname(entryPath)),
      ].map((item) => this._normalizeModelKey(item));
      if (candidates.some((key) => key && (key.includes(normalizedTarget) || normalizedTarget.includes(key)))) {
        return `gguf:${entryPath}`;
      }
    }

    return this._resolveOllamaBlobForModel(raw);
  }

  _getActiveDraftRuntimeInfo() {
    const configPath = path.resolve(__dirname, '..', '..', 'scripts', 'openvino-model.json');
    try {
      if (!fs.existsSync(configPath)) return { modelId: null, tokenizerId: null, family: null };
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const modelId = String(cfg.model_path || cfg.model_id || '').trim();
      const tokenizerId = String(cfg.tokenizer || modelId || '').trim();
      const key = this._normalizeModelKey(`${modelId} ${tokenizerId}`);
      let family = null;
      if (key.includes('qwen25') || key.includes('qwen2')) family = 'qwen2';
      else if (key.includes('llama3')) family = 'llama3';
      else if (key.includes('deepseek')) family = 'deepseek';
      else if (key.includes('phi4')) family = 'phi-4';
      else if (key.includes('mistral')) family = 'mistral';
      return { modelId, tokenizerId, family };
    } catch {
      return { modelId: null, tokenizerId: null, family: null };
    }
  }

  _isSpecPairCompatibleWithDraftRuntime(pair) {
    if (!pair || !pair.draftModelId) return false;
    const runtime = this._getActiveDraftRuntimeInfo();
    if (!runtime.family) return false;
    const pairTokenizer = String(pair.tokenizerId || pair.family || '').toLowerCase();
    if (runtime.family === 'qwen2') return pairTokenizer.includes('qwen');
    if (runtime.family === 'llama3') return pairTokenizer.includes('llama3') || pairTokenizer === 'llama';
    if (runtime.family === 'deepseek') return pairTokenizer.includes('deepseek');
    if (runtime.family === 'phi-4') return pairTokenizer.includes('phi');
    if (runtime.family === 'mistral') return pairTokenizer.includes('mistral');
    return false;
  }

  // Phase 2 unblock (v0.4.4): proactively warm the llamanode verifier
  // GGUF when a chat session begins on a model with a curated draft pair
  // and `DEVFORGE_SPEC_DECODE_ENABLE=1`. `loadModel` is idempotent for
  // matching path + ctx, so the first spec-decode turn arrives with a
  // hot verifier instead of paying ~30 s of GGUF cold-load. Safe to call
  // even when spec-decode is disabled — returns `{ skipped: <reason> }`
  // in every short-circuit branch and never throws.
  async prewarmSpecDecodeVerifier(mainModel, options = {}) {
    if (process.env.DEVFORGE_SPEC_DECODE_ENABLE !== '1') {
      return { warmed: false, skipped: 'spec_decode_disabled_by_default' };
    }
    if (process.env.DEVFORGE_SPEC_DECODE_DISABLE === '1') {
      return { warmed: false, skipped: 'spec_decode_disabled_env' };
    }

    const requestedModel = String(mainModel || '').trim();
    if (!requestedModel) {
      return { warmed: false, skipped: 'no_model' };
    }

    const pair = draftSelector.getDraftFor(requestedModel);
    if (!pair || !pair.draftModelId || !(Number(pair.score) >= 0.7)) {
      return { warmed: false, skipped: 'no_pair', model: requestedModel };
    }
    const pairKey = `${requestedModel}|${pair.draftModelId}`;
    if (this.isSpecDecodeDisabled(pairKey)) {
      return { warmed: false, skipped: 'pair_auto_disabled', pairKey };
    }

    const verifierModel = this._resolveLocalGgufForModel(requestedModel);
    if (!verifierModel) {
      return { warmed: false, skipped: 'verifier_gguf_unavailable', model: requestedModel };
    }

    const backend = this.backends.get('llamanode');
    if (!backend || typeof backend.loadModel !== 'function') {
      return { warmed: false, skipped: 'llamanode_unavailable' };
    }

    const contextSize = Number.isFinite(Number(options.contextSize)) && Number(options.contextSize) > 0
      ? Number(options.contextSize)
      : 4096;

    try {
      const result = await backend.loadModel(verifierModel, { contextSize });
      return {
        warmed: true,
        already: Boolean(result?.already),
        model: verifierModel,
        pairKey,
        contextSize,
      };
    } catch (err) {
      return {
        warmed: false,
        skipped: 'load_failed',
        error: err?.message || String(err),
        model: verifierModel,
        contextSize,
      };
    }
  }

  async _trySelectSpecDecodeBackend(payload = {}, buildDecision, rejectedCandidates = []) {
    if (process.env.DEVFORGE_SPEC_DECODE_ENABLE !== '1') {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'spec_decode_disabled_by_default' });
      return null;
    }
    if (process.env.DEVFORGE_SPEC_DECODE_DISABLE === '1') {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'spec_decode_disabled_env' });
      return null;
    }
    if (!this._isSpecDecodeWorkload(payload)) return null;

    const requestedModel = String(payload?.model || '').trim();
    if (!requestedModel) return null;

    const pair = draftSelector.getDraftFor(requestedModel);
    if (!pair || !pair.draftModelId || !(Number(pair.score) >= 0.7)) {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'spec_pair_unavailable', model: requestedModel });
      return null;
    }
    if (!this._isSpecPairCompatibleWithDraftRuntime(pair)) {
      rejectedCandidates.push({
        backendId: 'llamanode',
        reason: 'spec_pair_incompatible_with_active_draft_runtime',
        model: requestedModel,
        pairTokenizerId: pair.tokenizerId || null,
        activeDraftRuntime: this._getActiveDraftRuntimeInfo(),
      });
      return null;
    }

    const verifierModel = this._resolveLocalGgufForModel(requestedModel);
    if (!verifierModel) {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'spec_verifier_gguf_unavailable', model: requestedModel });
      return null;
    }

    const pairKey = `${requestedModel}|${pair.draftModelId}`;
    if (this.isSpecDecodeDisabled(pairKey)) {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'spec_pair_auto_disabled', pairKey });
      return null;
    }

    const backend = this.backends.get('llamanode');
    if (!backend) {
      rejectedCandidates.push({ backendId: 'llamanode', reason: 'backend_missing' });
      return null;
    }
    const health = await this._safeBackendHealth(backend);
    if (!health.available || health.gpu !== 'cuda') {
      rejectedCandidates.push({
        backendId: 'llamanode',
        reason: health.available ? 'spec_verifier_cuda_unavailable' : 'spec_verifier_unavailable',
        healthStatus: health?.status || 'unavailable',
        gpu: health?.gpu ?? null,
        error: health?.error || null,
      });
      return null;
    }

    payload._specDecode = {
      pair,
      pairKey,
      requestedModel,
      verifierModel,
      draftModelId: pair.draftModelId,
    };

    return {
      backend,
      fallbackReason: null,
      decisionEvidence: buildDecision({
        selectedBackend: backend.id,
        fallbackReason: null,
        candidateOrder: ['llamanode', 'ollama-cuda'],
        scored: [{ backendId: backend.id, score: 110, index: 0 }],
        rejected: rejectedCandidates,
        selectionSource: 'spec-decode',
        extra: {
          pairKey,
          draftModelId: pair.draftModelId,
          verifierModel,
          requestedModel,
        },
      }),
    };
  }

  async _selectBackendForRequest(payload = {}) {
    const lane = normalizeLane(payload.lane, payload.workloadType);
    const modelSize = parseModelSizeHint(payload.model);
    const modelRequiresOpenVino = isSyntheticNpuModel(payload.model);
    const modelRequiresGguf = isGgufModelId(payload.model);
    const order = this._orderedBackendIdsForProfile();
    const rejectedCandidates = [];
    const scoredCandidates = [];

    const buildDecision = ({
      selectedBackend = null,
      fallbackReason = null,
      candidateOrder = [],
      scored = [],
      rejected = [],
      selectionSource = 'auto',
      extra = {},
    } = {}) => ({
      lane,
      workloadType: payload.workloadType || null,
      model: payload.model || null,
      modelSize,
      selectedBackend,
      fallbackReason,
      selectionSource,
      candidateOrder,
      scoredCandidates: scored.map((item) => ({
        backendId: item.backendId,
        score: item.score,
        index: item.index,
      })),
      rejectedCandidates: rejected,
      timestamp: Date.now(),
      ...extra,
    });

    // Explicit backend override wins.
    if (payload.forceBackend && this.backends.has(payload.forceBackend)) {
      const forced = this.backends.get(payload.forceBackend);
      const health = await this._safeBackendHealth(forced);
      if (health.available) {
        return {
          backend: forced,
          fallbackReason: null,
          decisionEvidence: buildDecision({
            selectedBackend: forced.id,
            fallbackReason: null,
            candidateOrder: [forced.id],
            scored: [{ backendId: forced.id, score: 100, index: 0 }],
            rejected: [],
            selectionSource: 'forceBackend',
          }),
        };
      }
      rejectedCandidates.push({
        backendId: forced.id,
        reason: 'force_backend_unavailable',
        healthStatus: health?.status || 'unavailable',
        error: health?.error || null,
      });
    }

    // Speculative decoding is a verifier-routing decision, not a normal
    // profile-order decision. Check it before the generic GGUF/Ollama path so
    // eligible chat turns get a real llamannode verifier instead of falling
    // through to ollama-cuda simply because that backend ranks first.
    const specDecodeSelection = await this._trySelectSpecDecodeBackend(payload, buildDecision, rejectedCandidates);
    if (specDecodeSelection) return specDecodeSelection;

    // Direct GGUF models (id starts with "gguf:") are force-routed to
    // llamanode. This is the path LM Studio imports and local file loads
    // take — no Ollama involvement, no file copy, no blob store.
    if (modelRequiresGguf) {
      const llamanode = this.backends.get('llamanode');
      if (llamanode) {
        const health = await this._safeBackendHealth(llamanode);
        if (health.available) {
          return {
            backend: llamanode,
            fallbackReason: null,
            decisionEvidence: buildDecision({
              selectedBackend: llamanode.id,
              fallbackReason: null,
              candidateOrder: [llamanode.id],
              scored: [{ backendId: llamanode.id, score: 100, index: 0 }],
              rejected: rejectedCandidates,
              selectionSource: 'gguf-model',
            }),
          };
        }
        rejectedCandidates.push({
          backendId: llamanode.id,
          reason: 'llamanode_unavailable',
          healthStatus: health?.status || 'unavailable',
          error: health?.error || null,
        });
      } else {
        rejectedCandidates.push({
          backendId: 'llamanode',
          reason: 'backend_missing',
        });
      }

      return {
        backend: null,
        fallbackReason: 'gguf-runtime-unavailable',
        decisionEvidence: buildDecision({
          selectedBackend: null,
          fallbackReason: 'gguf-runtime-unavailable',
          candidateOrder: ['llamanode'],
          scored: [],
          rejected: rejectedCandidates,
          selectionSource: 'gguf-model',
        }),
      };
    }

    // User preferred backend next — but respect model compatibility.
    // NPU can only serve its own OpenVINO model; Ollama/GGUF models must go to
    // ollama-cuda (GPU) to keep CPU free.
    if (modelRequiresOpenVino) {
      const openvinoCandidates = this._getPreferredOpenVinoBackendIds();
      for (let index = 0; index < openvinoCandidates.length; index += 1) {
        const backendId = openvinoCandidates[index];
        const backend = this.backends.get(backendId);
        if (!backend) {
          rejectedCandidates.push({
            backendId,
            reason: 'backend_missing',
          });
          continue;
        }

        let health = await this._safeBackendHealth(backend);
        if (!health.available) {
          const started = await this._tryStartNpuServer({
            workload: lane,
            profile: this.profile,
            preferredModel: payload.model || null,
          });
          if (started) {
            health = await this._safeBackendHealth(backend);
          }
        }

        if (!health.available) {
          rejectedCandidates.push({
            backendId,
            reason: 'backend_unavailable',
            healthStatus: health?.status || 'unavailable',
            error: health?.error || null,
          });
          continue;
        }

        return {
          backend,
          fallbackReason: null,
          decisionEvidence: buildDecision({
            selectedBackend: backend.id,
            fallbackReason: null,
            candidateOrder: openvinoCandidates,
            scored: [{ backendId: backend.id, score: 99 - index, index }],
            rejected: rejectedCandidates,
            selectionSource: 'synthetic-openvino-model',
          }),
        };
      }

      return {
        backend: null,
        fallbackReason: 'openvino-model-unavailable',
        decisionEvidence: buildDecision({
          selectedBackend: null,
          fallbackReason: 'openvino-model-unavailable',
          candidateOrder: openvinoCandidates,
          scored: [],
          rejected: rejectedCandidates,
          selectionSource: 'synthetic-openvino-model',
        }),
      };
    }

    // Phase 1 lane registry: consult the tiered-utilization map before
    // the preferredBackend / scoring path. The registry is the right
    // answer for small, well-defined workloads (embeddings, classifiers,
    // autocomplete) regardless of what the user picked as preferred
    // backend for chat. For unknown workloads we fall through unchanged.
    const modelNeedsOllamaForLaneCheck = this._isOllamaOnlyModel(payload.model);
    if (!modelNeedsOllamaForLaneCheck) {
      try {
        const powerState = await this._getPowerState();
        const laneResult = getLaneCandidates(payload.workloadType, {
          onBattery: Boolean(powerState?.onBattery),
          modelSize,
          profile: this.profile,
          availableBackends: Array.from(this.backends.keys()),
          laneHint: lane,
        });
        if (Array.isArray(laneResult.candidates) && laneResult.candidates.length > 0) {
          for (let i = 0; i < laneResult.candidates.length; i += 1) {
            const backendId = laneResult.candidates[i];
            const backend = this.backends.get(backendId);
            if (!backend) continue;
            let health = await this._safeBackendHealth(backend);
            if (!health.available && backendId.startsWith('openvino')) {
              const started = await this._tryStartNpuServer({
                workload: lane,
                profile: this.profile,
                preferredModel: payload.model || null,
              });
              if (started) health = await this._safeBackendHealth(backend);
            }
            if (!health.available) {
              rejectedCandidates.push({
                backendId,
                reason: 'lane_candidate_unavailable',
                healthStatus: health?.status || 'unavailable',
                error: health?.error || null,
              });
              continue;
            }
            return {
              backend,
              fallbackReason: null,
              decisionEvidence: buildDecision({
                selectedBackend: backend.id,
                fallbackReason: null,
                candidateOrder: laneResult.candidates,
                scored: [{ backendId: backend.id, score: 90 - i, index: i }],
                rejected: rejectedCandidates,
                selectionSource: `lane-registry:${laneResult.workload || 'unknown'}`,
              }),
            };
          }
        }
      } catch (err) {
        console.warn('[Orchestrator] Lane registry lookup failed:', err?.message || err);
      }
    }

    if (this.preferredBackendId && this.preferredBackendId !== 'auto') {
      const modelName = String(payload.model || '').trim();
      const preferredIsNpu = this.preferredBackendId.includes('npu') || this.preferredBackendId.includes('openvino');
      const modelNeedsOllama = this._isOllamaOnlyModel(modelName);

      if (preferredIsNpu && modelNeedsOllama) {
        const cudaBackend = this.backends.get('ollama-cuda');
        if (cudaBackend) {
          const cudaHealth = await this._safeBackendHealth(cudaBackend);
          if (cudaHealth.available) {
            console.log('[Orchestrator] Model', modelName, 'needs Ollama — routing to ollama-cuda (GPU offload)');
            return {
              backend: cudaBackend,
              fallbackReason: null,
              decisionEvidence: buildDecision({
                selectedBackend: cudaBackend.id,
                fallbackReason: null,
                candidateOrder: [cudaBackend.id],
                scored: [{ backendId: cudaBackend.id, score: 94, index: 0 }],
                rejected: rejectedCandidates,
                selectionSource: 'npu-model-compat-gpu-redirect',
              }),
            };
          }
        }
      }

      if (!(preferredIsNpu && modelNeedsOllama)) {
        const preferred = this.backends.get(this.preferredBackendId);
        if (preferred) {
          let health = await this._safeBackendHealth(preferred);
          if (!health.available && preferredIsNpu) {
            const started = await this._tryStartNpuServer({
              workload: lane,
              profile: this.profile,
              preferredModel: payload.model || null,
            });
            if (started) {
              health = await this._safeBackendHealth(preferred);
            }
          }
          if (health.available) {
            return {
              backend: preferred,
              fallbackReason: null,
              decisionEvidence: buildDecision({
                selectedBackend: preferred.id,
                fallbackReason: null,
                candidateOrder: [preferred.id],
                scored: [{ backendId: preferred.id, score: 95, index: 0 }],
                rejected: rejectedCandidates,
                selectionSource: 'preferredBackend',
              }),
            };
          }
          rejectedCandidates.push({
            backendId: preferred.id,
            reason: 'preferred_backend_unavailable',
            healthStatus: health?.status || 'unavailable',
            error: health?.error || null,
          });
        }
      } else {
        rejectedCandidates.push({
          backendId: this.preferredBackendId,
          reason: 'preferred_backend_incompatible_model',
          error: modelName || null,
        });
      }
    }

    // Hard lane routing — model-aware, mode-aware.
    const laneOrder = [];
    const modelNeedsOllama = this._isOllamaOnlyModel(payload.model);
    const unified = this._isUnifiedBrainActive();

    if (modelNeedsOllama || !unified) {
      laneOrder.push('ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu');
    } else if (lane === 'lane_embedding') {
      laneOrder.push('openvino-npu', 'openvino-gpu', 'ollama-cuda', 'ollama-cpu');
    } else if (lane === 'lane_maintenance') {
      laneOrder.push('openvino-npu', 'ollama-cuda', 'ollama-cpu');
    } else if (lane === 'lane_agent') {
      laneOrder.push('openvino-npu', 'ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu');
    } else {
      laneOrder.push('openvino-npu', 'ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu');
    }

    if (unified && !modelNeedsOllama && modelSize !== null && modelSize <= 3 && lane !== 'lane_interactive') {
      laneOrder.unshift('openvino-npu');
    }

    const candidates = [...new Set([...laneOrder, ...order])]
      .filter((backendId) => !(modelNeedsOllama && backendId.startsWith('openvino')));
    const available = [];
    const candidateRows = candidates.map((backendId, index) => ({
      backendId,
      index,
      backend: this.backends.get(backendId) || null,
    }));
    const presentCandidates = candidateRows.filter((row) => row.backend);
    const initialHealthRows = await Promise.all(presentCandidates.map(async (row) => ({
      backendId: row.backendId,
      health: await this._safeBackendHealth(row.backend),
    })));
    const healthById = new Map(initialHealthRows.map((row) => [row.backendId, row.health]));
    const openvinoCandidatesNeedingRetry = unified
      ? presentCandidates.filter((row) => row.backendId.startsWith('openvino') && !healthById.get(row.backendId)?.available)
      : [];

    if (openvinoCandidatesNeedingRetry.length > 0) {
      const started = await this._tryStartNpuServer({
        workload: lane,
        profile: this.profile,
        preferredModel: payload.model || null,
      });
      if (started) {
        const retriedHealthRows = await Promise.all(openvinoCandidatesNeedingRetry.map(async (row) => ({
          backendId: row.backendId,
          health: await this._safeBackendHealth(row.backend),
        })));
        for (const row of retriedHealthRows) {
          healthById.set(row.backendId, row.health);
        }
      }
    }

    for (const row of candidateRows) {
      const { backendId, backend, index } = row;
      if (!backend) {
        rejectedCandidates.push({
          backendId,
          reason: 'backend_missing',
        });
        continue;
      }

      const health = healthById.get(backendId) || { available: false, status: 'unknown' };
      if (!health.available) {
        rejectedCandidates.push({
          backendId,
          reason: 'backend_unavailable',
          healthStatus: health?.status || 'unavailable',
          error: health?.error || null,
        });
        continue;
      }

      const score = this._scoreBackendCandidate({
        backendId,
        backend,
        lane,
        modelSize,
        baseOrderRank: index,
      });
      const scored = { backendId, backend, score, index };
      available.push(scored);
      scoredCandidates.push(scored);
    }

    if (available.length > 0) {
      available.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });
      const best = available[0];
      return {
        backend: best.backend,
        fallbackReason: best.backendId === candidates[0] ? null : `fallback:${best.backendId}`,
        decisionEvidence: buildDecision({
          selectedBackend: best.backendId,
          fallbackReason: best.backendId === candidates[0] ? null : `fallback:${best.backendId}`,
          candidateOrder: candidates,
          scored: scoredCandidates,
          rejected: rejectedCandidates,
          selectionSource: 'auto',
        }),
      };
    }

    const cpuFallback = this.backends.get('ollama-cpu') || null;
    let healthyCpuFallback = null;
    if (cpuFallback) {
      const cpuHealth = await this._safeBackendHealth(cpuFallback);
      if (cpuHealth.available) {
        healthyCpuFallback = cpuFallback;
      } else {
        rejectedCandidates.push({
          backendId: cpuFallback.id,
          reason: 'cpu_last_resort_unavailable',
          healthStatus: cpuHealth?.status || 'unavailable',
          error: cpuHealth?.error || null,
        });
      }
    }

    return {
      backend: healthyCpuFallback,
      fallbackReason: healthyCpuFallback ? 'fallback:cpu-last-resort' : 'no-backend-available',
      decisionEvidence: buildDecision({
        selectedBackend: healthyCpuFallback?.id || null,
        fallbackReason: healthyCpuFallback ? 'fallback:cpu-last-resort' : 'no-backend-available',
        candidateOrder: candidates,
        scored: scoredCandidates,
        rejected: rejectedCandidates,
        selectionSource: healthyCpuFallback ? 'cpu-last-resort' : 'no-backend-available',
      }),
    };
  }

  _isOllamaOnlyModel(modelName = '') {
    const raw = String(modelName || '').trim();
    const lower = raw.toLowerCase();
    if (!lower) return false;
    if (isSyntheticNpuModel(raw)) return false;
    if (lower.includes('.gguf')) return true;
    if (lower.startsWith('local-')) return true;
    if (lower.includes(':')) return true;
    // Plain Ollama tags like "llama3" stay on the Ollama lane unless the user
    // picked an explicit synthetic NPU model. Unified mode does not assume
    // those generic tags have a stable one-to-one OpenVINO/NPU equivalent.
    if (/^[a-z0-9_-]+$/.test(lower)) return true;
    return false;
  }

  _normalizePayloadForBackend(backend, payload = {}) {
    if (!backend) return payload;
    const normalized = { ...payload };
    if (backend.type === 'openvino' && isSyntheticNpuModel(normalized.model)) {
      normalized.model = unwrapSyntheticModel(normalized.model);
    }
    if (Array.isArray(normalized.messages) && normalized.messages.length > 0 && backend.type === 'openvino') {
      normalized.prompt = buildPromptFromMessages(normalized.messages, normalized.system);
      delete normalized.messages;
    }
    if (backend.type === 'ollama') {
      if (!normalized.options) normalized.options = {};
      // Always request full GPU offload. Ollama will gracefully handle this
      // even on CPU-only systems — it simply ignores num_gpu when no GPU
      // is detected. This guarantees we never accidentally run on CPU
      // when a GPU is available.
      normalized.options.num_gpu = -1;

      const profile = String(this.profile || 'balanced').toLowerCase();
      const isCuda = Boolean(backend.useCuda);
      const rawCtx = Number(normalized.options.num_ctx);
      const rawPredict = Number(normalized.options.num_predict);
      const rawBatch = Number(normalized.options.num_batch);

      // Workstation-citizen clamps are scoped to efficiency/laptop profiles so
      // the app plays nice with other processes on constrained systems. On
      // balanced/speed we trust the upstream clampInferenceOptionsToModel call
      // to bound num_ctx against the model's real n_ctx_train — this is what
      // unlocks long-context behavior that the stacked clamps were silently
      // truncating.
      const conservativeProfile = profile === 'efficiency' || profile === 'laptop';
      if (conservativeProfile) {
        const maxCtx = profile === 'laptop' ? (isCuda ? 8192 : 4096) : (isCuda ? 12288 : 4096);
        const maxPredict = isCuda ? 1536 : 768;
        const maxBatch = isCuda ? 256 : 128;
        if (Number.isFinite(rawCtx)) {
          normalized.options.num_ctx = Math.max(1024, Math.min(rawCtx, maxCtx));
        }
        if (Number.isFinite(rawPredict)) {
          normalized.options.num_predict = Math.max(32, Math.min(rawPredict, maxPredict));
        }
        if (Number.isFinite(rawBatch)) {
          normalized.options.num_batch = Math.max(32, Math.min(rawBatch, maxBatch));
        }
      } else {
        // Defensive floors so we never send a nonsense value to Ollama.
        if (Number.isFinite(rawCtx) && rawCtx < 512) normalized.options.num_ctx = 512;
        if (Number.isFinite(rawPredict) && rawPredict < 1) normalized.options.num_predict = 1;
        if (Number.isFinite(rawBatch) && rawBatch < 32) normalized.options.num_batch = 32;
      }

      // Keep-alive resolution order:
      //   1. Explicit payload.keep_alive (request-level, always wins)
      //   2. User's "Keep model loaded" setting when not 'auto'
      //   3. Performance-profile default (efficiency/laptop release faster;
      //      balanced/speed keep resident LM Studio-style).
      if (normalized.keep_alive === undefined || normalized.keep_alive === null || normalized.keep_alive === '') {
        const userPolicy = String(this.store?.get?.('keepModelLoaded') || 'auto').trim().toLowerCase();
        if (userPolicy === 'always') {
          normalized.keep_alive = -1;
        } else if (userPolicy === 'timed') {
          normalized.keep_alive = '30m';
        } else if (profile === 'efficiency') {
          normalized.keep_alive = '30m';
        } else if (profile === 'laptop') {
          normalized.keep_alive = '10m';
        } else {
          normalized.keep_alive = -1;
        }
      }
    }
    return normalized;
  }

  _recordOffloadEvidence(key, evidence) {
    if (!key) return;
    this.offloadEvidence.set(key, evidence);
    while (this.offloadEvidence.size > MAX_OFFLOAD_EVIDENCE_ROWS) {
      const oldestKey = this.offloadEvidence.keys().next().value;
      if (!oldestKey) break;
      this.offloadEvidence.delete(oldestKey);
    }
  }

  async _startNpuWarmloop() {
    // Only attempt when NPU is actually detected and the OpenVINO backend
    // is registered. Otherwise the warmloop would just bounce off empty
    // checks forever.
    if (!this.hardware?.npu?.detected) return;
    if (!this.backends.has('openvino-npu') && !this.backends.has('openvino-hybrid')) return;

    try {
      const { createNpuWarmloop } = require('./npu-warmloop');
      const npuBridge = getLazyNpuBridge();
      const powerMode = getPowerMode();
      this._npuWarmloop = createNpuWarmloop({
        npuBridge,
        powerMode,
        getProfile: () => this.profile,
        onTransition: (transition) => this.recordWarmloopTransition(transition),
      });
      await this._npuWarmloop.start();
    } catch (err) {
      console.warn('[Orchestrator] Warmloop init error:', err?.message || err);
    }
  }

  getNpuWarmloopStatus() {
    if (!this._npuWarmloop) return { active: false, available: false };
    return { available: true, ...this._npuWarmloop.getStatus() };
  }

  /**
   * Aggregate per-device activity from the last N seconds of decisions.
   * Used by the HardwareMonitor "Device Activity" UI. Maps backend IDs
   * to display-friendly device tags (rtx, arc, npu, cpu).
   */
  getDeviceUtilization(windowMs = 60 * 1000) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const decisions = Array.isArray(this.recentDecisions) ? this.recentDecisions : [];
    const streamEvents = Array.isArray(this.streamEvents) ? this.streamEvents : [];

    const backendToDevice = (backendId) => {
      const id = String(backendId || '').toLowerCase();
      if (id.includes('openvino-npu') || id === 'openvino-hybrid') return 'npu';
      if (id.includes('openvino-gpu')) return 'arc';
      if (id.includes('llamacpp-vulkan')) return 'arc';
      if (id.includes('ollama-cuda') || id === 'llamanode') return 'gpu';
      if (id.includes('ollama-cpu')) return 'cpu';
      return 'other';
    };

    const buckets = {
      gpu: { device: 'gpu', label: 'GPU', jobs: 0, lastActivityAt: 0, lastWorkload: null, lastBackend: null },
      npu: { device: 'npu', label: 'NPU', jobs: 0, lastActivityAt: 0, lastWorkload: null, lastBackend: null },
      arc: { device: 'arc', label: 'Intel Arc', jobs: 0, lastActivityAt: 0, lastWorkload: null, lastBackend: null },
      cpu: { device: 'cpu', label: 'CPU', jobs: 0, lastActivityAt: 0, lastWorkload: null, lastBackend: null },
      other: { device: 'other', label: 'Other', jobs: 0, lastActivityAt: 0, lastWorkload: null, lastBackend: null },
    };

    for (const row of decisions) {
      if (!row || !row.backend) continue;
      const ts = Number(row.ts) || 0;
      if (ts < cutoff) continue;
      const device = backendToDevice(row.backend);
      const bucket = buckets[device] || buckets.other;
      bucket.jobs += 1;
      if (ts > bucket.lastActivityAt) {
        bucket.lastActivityAt = ts;
        bucket.lastWorkload = row.decisionEvidence?.workloadType || row.mode || null;
        bucket.lastBackend = row.backend;
      }
    }

    const devices = Object.values(buckets).filter((b) => b.jobs > 0 || b.device !== 'other');
    const warmloop = this.getNpuWarmloopStatus();
    const warmloopTransitions = this.warmloopTransitions.filter((row) => Number(row?.ts) >= cutoff);

    const streamById = new Map();
    const aborts = {};
    for (const event of streamEvents) {
      if (!event) continue;
      const ts = Number(event.ts) || 0;
      if (ts < cutoff) continue;
      const streamId = String(event.streamId || `stream-${ts}`);
      const bucket = streamById.get(streamId) || {
        streamId,
        firstTokenMs: null,
        tokensPerSecond: null,
        abort: null,
        requestedModel: null,
        effectiveModel: null,
        backendId: null,
        lane: null,
        status: 'in_progress',
        updatedAt: ts,
      };
      bucket.updatedAt = Math.max(bucket.updatedAt, ts);
      if (event.requestedModel) bucket.requestedModel = event.requestedModel;
      if (event.effectiveModel) bucket.effectiveModel = event.effectiveModel;
      if (event.backendId) bucket.backendId = event.backendId;
      if (event.lane) bucket.lane = event.lane;

      if (event.type === 'first_token') {
        bucket.firstTokenMs = Number.isFinite(Number(event.firstTokenMs)) ? Number(event.firstTokenMs) : bucket.firstTokenMs;
      } else if (event.type === 'completed') {
        bucket.tokensPerSecond = Number.isFinite(Number(event.tokensPerSecond))
          ? Number(event.tokensPerSecond)
          : bucket.tokensPerSecond;
        bucket.status = 'completed';
      } else if (event.type === 'abort') {
        const code = String(event.code || 'unknown');
        aborts[code] = (aborts[code] || 0) + 1;
        bucket.abort = {
          code,
          reason: event.reason || null,
          ts,
        };
        bucket.status = 'aborted';
      }
      streamById.set(streamId, bucket);
    }

    const streamRows = [...streamById.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const lastStream = streamRows[0] || null;

    const specDecodeStats = this.getSpecDecodeStats({});

    return {
      windowMs,
      generatedAt: now,
      devices,
      warmloop,
      streams: {
        firstTokenMs: Number.isFinite(Number(lastStream?.firstTokenMs)) ? Number(lastStream.firstTokenMs) : null,
        last: lastStream,
        aborts,
        warmloopTransitions,
        specDecode: specDecodeStats,
      },
      currentBackend: this.currentBackend?.id || null,
    };
  }

  /**
   * Returns { onBattery, batteryPercent, acConnected } for lane-routing
   * decisions. Delegates to power-mode.js's getPowerState when available;
   * returns a safe default (treating the machine as plugged in) when it
   * isn't. Cached briefly so lane routing doesn't hit this on every turn.
   */
  async _getPowerState() {
    const now = Date.now();
    if (this._powerStateCache && (now - this._powerStateCache.at) < 5000) {
      return this._powerStateCache.value;
    }
    let state = { onBattery: false, batteryPercent: null, acConnected: true };
    try {
      const powerMode = getPowerMode();
      if (powerMode && typeof powerMode.getPowerState === 'function') {
        const resolved = await powerMode.getPowerState();
        if (resolved && typeof resolved === 'object') {
          state = {
            onBattery: Boolean(resolved.onBattery),
            batteryPercent: Number.isFinite(resolved.batteryPercent) ? resolved.batteryPercent : null,
            acConnected: resolved.acConnected === undefined ? !resolved.onBattery : Boolean(resolved.acConnected),
          };
        }
      }
    } catch (err) {
      // Non-blocking: treat as plugged-in on any failure.
    }
    this._powerStateCache = { at: now, value: state };
    return state;
  }

  async _executeOnBackend(backend, mode, payload, onChunk) {
    const normalizedPayload = this._normalizePayloadForBackend(backend, payload);
    // Phase 2: stream-mode chat-main turns through llamanode get the
    // speculative-decode loop when a compatible draft pair exists, the
    // verifier API is healthy, and auto-disable hasn't suspended the
    // pair. On any failure we fall back to plain backend.stream so chat
    // never breaks because of a spec-decode glitch.
    if (
      mode === 'stream'
      && backend?.id === 'llamanode'
      && this._shouldUseSpecDecode(normalizedPayload, backend)
    ) {
      try {
        const result = await this._runSpecDecodeChat(backend, normalizedPayload, onChunk);
        if (result?.success !== false) return result;
      } catch (err) {
        if (err?.code !== 'SPEC_DECODE_UNAVAILABLE') {
          console.warn('[Orchestrator] spec-decode chat failed, falling back to direct stream:', err?.message || err);
        }
        // Fall through to plain llamannode stream. If the user selected an
        // Ollama tag but we resolved a local GGUF verifier model, use that
        // resolved model for the direct fallback too; otherwise backend.stream
        // would try to load an Ollama tag as a filesystem path.
        if (normalizedPayload?._specDecode?.verifierModel) {
          return backend.stream({
            ...normalizedPayload,
            model: normalizedPayload._specDecode.verifierModel,
          }, onChunk);
        }
      }
    }
    if (mode === 'stream') {
      return backend.stream(normalizedPayload, onChunk);
    }
    return backend.generate(normalizedPayload);
  }

  _shouldUseSpecDecode(payload, backend) {
    if (!backend || backend.id !== 'llamanode') return false;
    if (typeof backend.evaluateForVerifier !== 'function') return false;
    if (typeof backend.getActiveSequence !== 'function') return false;
    if (process.env.DEVFORGE_SPEC_DECODE_ENABLE !== '1') return false;
    if (process.env.DEVFORGE_SPEC_DECODE_DISABLE === '1') return false;

    const workload = String(payload?.workloadType || '').toLowerCase();
    if (workload && !['chat', 'chat-main', 'chat-long'].includes(workload)) return false;

    const mainModel = String(payload?.model || '').trim();
    if (!mainModel) return false;

    const pair = payload?._specDecode?.pair || draftSelector.getDraftFor(mainModel);
    if (!pair || !pair.draftModelId || !(Number(pair.score) >= 0.7)) return false;

    const pairKey = payload?._specDecode?.pairKey || `${mainModel}|${pair.draftModelId}`;
    if (this.isSpecDecodeDisabled(pairKey)) return false;

    return true;
  }

  // Drives a draft -> verify -> commit -> continue loop using the NPU
  // drafter via spec-decode-bus and the in-process llamanode verifier.
  // Streams accepted tokens to onChunk as plain text deltas so the
  // caller (chat-v2) cannot tell whether the response came from spec
  // decoding or vanilla generation. Records per-batch outcomes so the
  // dashboard's auto-disable state machine has live data.
  async _runSpecDecodeChat(backend, payload, onChunk) {
    const npuBridge = getLazyNpuBridge();
    if (!npuBridge || typeof npuBridge.draftTokens !== 'function') {
      const err = new Error('spec-decode requires npu-bridge with draftTokens()');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }
    const bus = this._specDecodeBus || createSpecDecodeBus({ npuBridge });
    if (!this._specDecodeBus) this._specDecodeBus = bus;

    const mainModel = String(payload?._specDecode?.requestedModel || payload?.model || '').trim();
    const verifierModel = String(payload?._specDecode?.verifierModel || payload?.model || '').trim();
    const pair = payload?._specDecode?.pair || draftSelector.getDraftFor(mainModel);
    if (!pair || !pair.draftModelId) {
      const err = new Error('spec-decode: no draft pair available');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }
    const pairKey = payload?._specDecode?.pairKey || `${mainModel}|${pair.draftModelId}`;

    // Ensure the verifier model is loaded; this is what makes
    // backend.evaluateForVerifier work. Use the same num_ctx the
    // request asked for so prefill is sized correctly.
    const requestedCtx = Number(payload?.options?.num_ctx) || 4096;
    await backend.loadModel(verifierModel, { contextSize: requestedCtx });
    const sequence = backend.getActiveSequence?.();
    if (!sequence) {
      const err = new Error('spec-decode: verifier sequence unavailable after loadModel');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }
    const model = sequence.model;
    const tokensRef = model?.tokens;
    const isEogToken = (token) => {
      if (typeof model?.isEogToken === 'function') return model.isEogToken(token);
      if (tokensRef?.eos !== undefined && token === tokensRef.eos) return true;
      if (tokensRef?.eot !== undefined && token === tokensRef.eot) return true;
      return false;
    };

    // Build the prompt text for both drafter (NPU) and verifier (CUDA).
    const promptText = this._buildSpecDecodePrompt(payload);
    if (!promptText) {
      const err = new Error('spec-decode: empty prompt');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }
    const promptTokens = typeof model?.tokenize === 'function' ? model.tokenize(promptText) : [];
    if (!Array.isArray(promptTokens) || promptTokens.length === 0) {
      const err = new Error('spec-decode: tokenizer returned empty prefix');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }

    const lookahead = Number(process.env.DEVFORGE_SPEC_LOOKAHEAD) || 4;
    const maxNewTokens = Math.max(16, Number(payload?.options?.num_predict) || 256);
    const startedAt = Date.now();
    let committedTokens = 0;
    let acceptedTotal = 0;
    let draftTotal = 0;
    let lastEmittedText = '';
    let batchCount = 0;
    const maxSpecBatches = Math.max(1, Number(process.env.DEVFORGE_SPEC_MAX_BATCHES) || 64);

    // Prefer the session API so the Python side keeps the prompt + accepted
    // suffix and only the small accepted-delta is shipped per round.
    let serverSessionId = null;
    try {
      const created = await bus.createSession({ prompt: promptText });
      if (created?.success && created.session_id) serverSessionId = created.session_id;
    } catch {
      serverSessionId = null;
    }
    const sampling = {
      temperature: Number(payload?.options?.temperature ?? 0),
      top_k: Number(payload?.options?.top_k ?? 40),
      top_p: Number(payload?.options?.top_p ?? 0.9),
    };
    const requestIdBase = `spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    while (committedTokens < maxNewTokens && batchCount < maxSpecBatches) {
      batchCount += 1;
      let draft;
      let secondaryDraft = null;
      const treeEnabled = process.env.DEVFORGE_SPEC_TREE === '1' && !this._specTreeDisabled;
      if (serverSessionId) {
        draft = await bus.extendSession({
          sessionId: serverSessionId,
          acceptedText: committedTokens === 0 ? null : (lastEmittedText.length > 0 ? lastEmittedText.slice(lastEmittedText.lastIndexOf('\n') + 1) : ''),
          // We pass the cumulative text via the session's server-side state;
          // the orchestrator's per-round delta is whatever the verifier just
          // accepted. The session keeps prompt + committed_text so the pipe
          // sees the full continuation on every call without us re-sending.
          acceptedTokens: null,
          lookahead,
          requestId: `${requestIdBase}-${committedTokens}`,
          sampling,
        });
      } else {
        const calls = [bus.requestDraft({
          prompt: promptText + lastEmittedText,
          lookahead,
          requestId: `${requestIdBase}-${committedTokens}-primary`,
          sampling,
        })];
        if (treeEnabled) {
          calls.push(bus.requestDraft({
            prompt: promptText + lastEmittedText,
            lookahead,
            requestId: `${requestIdBase}-${committedTokens}-secondary`,
            sampling,
            branch: 'secondary',
          }).catch(() => null));
        }
        const results = await Promise.all(calls);
        draft = results[0];
        secondaryDraft = treeEnabled ? results[1] : null;
      }
      if (!draft || draft.success === false) {
        if (serverSessionId) {
          // Try to recover via the stateless path.
          serverSessionId = null;
          continue;
        }
        const err = new Error(`spec-decode draft failed: ${draft?.error || 'unknown'}`);
        err.code = 'SPEC_DECODE_RUNTIME_ERROR';
        throw err;
      }
      const draftTokens = Array.isArray(draft.draft_tokens) ? draft.draft_tokens : [];
      if (draftTokens.length === 0) break;

      let verify;
      const evaluateLogits = async (combinedTokens) => {
        const result = await backend.evaluateForVerifier({ tokens: combinedTokens });
        return result.logits;
      };
      try {
        const haveSecondary = secondaryDraft && secondaryDraft.success !== false
          && Array.isArray(secondaryDraft.draft_tokens) && secondaryDraft.draft_tokens.length > 0;
        if (haveSecondary) {
          const treeResult = await verifyTreeBatch({
            prefix: promptTokens,
            branches: [
              { branchId: 'primary', draftTokens },
              { branchId: 'secondary', draftTokens: secondaryDraft.draft_tokens },
            ],
            evaluateLogits,
            mode: 'greedy',
          });
          verify = treeResult;
          // Auto-disable secondary branch if it gives <5% additional
          // tokens accepted vs primary across the rolling window.
          this._recordTreeMargin(pairKey, treeResult.marginalGainTokens, draftTokens.length);
        } else {
          verify = await bus.submitVerification({
            prefix: promptTokens,
            draftTokens,
            evaluateLogits,
            mode: 'greedy',
          });
        }
      } catch (err) {
        if (err?.code === 'SPEC_DECODE_UNAVAILABLE') throw err;
        const wrapped = new Error(`spec-decode verifier failed: ${err?.message || err}`);
        wrapped.code = 'SPEC_DECODE_RUNTIME_ERROR';
        throw wrapped;
      }

      const acceptedTokens = Array.isArray(verify.accepted) ? verify.accepted : [];
      const bonusToken = Number.isFinite(Number(verify.bonusToken)) ? Number(verify.bonusToken) : null;
      const committedThisBatch = [...acceptedTokens];
      if (bonusToken != null) committedThisBatch.push(bonusToken);
      if (committedThisBatch.length === 0) {
        break;
      }

      acceptedTotal += acceptedTokens.length;
      draftTotal += draftTokens.length;

      // Detokenize the committed run as a string, anchored on the previously
      // emitted text so detokenizer heuristics produce continuation-safe
      // spacing. Then emit the *new* slice via onChunk and roll the prefix
      // forward for the next draft.
      const newPrefixTokens = [...promptTokens, ...committedThisBatch];
      const fullText = typeof model?.detokenize === 'function'
        ? model.detokenize(newPrefixTokens.slice(promptTokens.length), false, promptTokens)
        : '';
      const delta = fullText.length > lastEmittedText.length ? fullText.slice(lastEmittedText.length) : '';
      if (delta && typeof onChunk === 'function') {
        onChunk({ response: delta, done: false });
      }
      lastEmittedText = fullText;

      promptTokens.push(...committedThisBatch);
      committedTokens += committedThisBatch.length;

      // Record the per-batch outcome for the dashboard / auto-disable.
      this.recordSpecDecodeOutcome({
        pair: pairKey,
        accepted: acceptedTokens.length,
        total: draftTokens.length,
        mainTokensPerSec: null,
        baselineTokensPerSec: null,
      });

      // Stop on EOS / EOT.
      if (bonusToken != null && isEogToken(bonusToken)) break;
      if (acceptedTokens.some((t) => isEogToken(t))) break;
    }

    if (typeof onChunk === 'function') onChunk({ done: true });

    if (serverSessionId) {
      try { await bus.closeSession(serverSessionId); } catch { /* non-blocking */ }
    }

    const durationMs = Date.now() - startedAt;
    const tokensPerSecond = durationMs > 0 ? Math.round((committedTokens / (durationMs / 1000)) * 10) / 10 : 0;

    return {
      success: true,
      response: lastEmittedText,
      done: true,
      meta: {
        executionMode: 'spec-decode',
        pair: pairKey,
        committedTokens,
        acceptedTotal,
        draftTotal,
        acceptanceRate: draftTotal > 0 ? acceptedTotal / draftTotal : 0,
        tokensPerSecond,
        durationMs,
        batchCount,
      },
    };
  }

  // Tracks tree-spec marginal gain over a rolling window. When the
  // secondary branch contributes < 5% extra accepted tokens over the
  // last N rounds, disable tree mode for the remainder of this turn.
  _recordTreeMargin(pairKey, marginalGainTokens, draftLen) {
    if (!this._specTreeStats) this._specTreeStats = new Map();
    const stats = this._specTreeStats.get(pairKey) || { samples: [], sum: 0, total: 0 };
    const ratio = draftLen > 0 ? marginalGainTokens / draftLen : 0;
    stats.samples.push(ratio);
    stats.sum += ratio;
    stats.total += 1;
    if (stats.samples.length > 30) {
      const dropped = stats.samples.shift();
      stats.sum -= dropped;
    }
    this._specTreeStats.set(pairKey, stats);
    if (stats.samples.length >= 10) {
      const avg = stats.sum / stats.samples.length;
      if (avg < 0.05) {
        this._specTreeDisabled = true;
      }
    }
  }

  _buildSpecDecodePrompt(payload = {}) {
    if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
      const lines = [];
      const system = payload?.system && String(payload.system).trim();
      if (system) lines.push(`System: ${system}`);
      for (const m of payload.messages) {
        const role = String(m?.role || 'user').toLowerCase();
        const content = String(m?.content || '').trim();
        if (!content) continue;
        if (role === 'system') lines.push(`System: ${content}`);
        else if (role === 'assistant') lines.push(`Assistant: ${content}`);
        else lines.push(`User: ${content}`);
      }
      lines.push('Assistant:');
      return lines.join('\n\n');
    }
    return String(payload?.prompt || '').trim();
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
      const { backend, fallbackReason, decisionEvidence } = await this._selectBackendForRequest(payload);
      if (!backend) throw new Error('No available backend for inference');

      this.currentBackend = backend;
      this.lastBackendDecision = decisionEvidence || null;
      this.lastExecutionPlan = {
        ...(payload.executionPlan && typeof payload.executionPlan === 'object' ? payload.executionPlan : {}),
        requestedModel: payload.executionPlan?.requestedModel || payload.model || null,
        effectiveModel: payload.executionPlan?.effectiveModel || payload.model || null,
        effectiveOptions: payload.executionPlan?.effectiveOptions || payload.options || {},
        executionMode: payload.executionPlan?.executionMode || 'direct',
        lastExecutionMode: payload.executionPlan?.executionMode || 'direct',
        modeReasons: Array.isArray(payload.executionPlan?.reasons) ? payload.executionPlan.reasons : [],
        backendId: backend.id,
        timestamp: Date.now(),
      };
      this._recordDecision({
        mode,
        lane,
        model: payload.model || null,
        backend: backend.id,
        fallbackReason,
        decisionEvidence,
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

        const ordered = isSyntheticNpuModel(payload.model)
          ? this._getPreferredOpenVinoBackendIds()
          : this._orderedBackendIdsForProfile();
        for (const backendId of ordered) {
          if (backendId === backend.id) continue;
          const candidate = this.backends.get(backendId);
          if (!candidate) continue;
          const health = await this._safeBackendHealth(candidate);
          if (!health.available) continue;
          try {
            this.currentBackend = candidate;
            const recoveryEvidence = {
              ...(this.lastBackendDecision || {}),
              selectedBackend: candidate.id,
              fallbackReason: `recover:${backend.id}->${candidate.id}`,
              selectionSource: 'recovery',
              timestamp: Date.now(),
            };
            this.lastBackendDecision = recoveryEvidence;
            if (this.lastExecutionPlan) {
              this.lastExecutionPlan = {
                ...this.lastExecutionPlan,
                backendId: candidate.id,
                timestamp: Date.now(),
              };
            }
            this._recordDecision({
              mode,
              lane,
              model: payload.model || null,
              backend: candidate.id,
              fallbackReason: `recover:${backend.id}->${candidate.id}`,
              decisionEvidence: recoveryEvidence,
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

  /**
   * Run multiple personas in parallel, routing each to its own stream.
   *
   * @param {object} ensemble - { cast: [{ id, label, model, payload }], onChunk: (castId, chunk) => void }
   * @returns Array of per-cast completion results.
   *
   * The onChunk callback receives one event per cast member per token/chunk.
   * Each stream uses the full orchestrator pipeline (backend selection,
   * safety overrides, cancellation). If one fails it doesn't abort the rest.
   */
  async parallelStream(ensemble = {}) {
    const cast = Array.isArray(ensemble.cast) ? ensemble.cast.filter(Boolean) : [];
    if (cast.length === 0) {
      return { success: false, error: 'No cast members provided', results: [] };
    }
    const maxParallel = Math.max(1, Math.min(6, Number(ensemble.maxParallel) || 3));
    const onChunk = typeof ensemble.onChunk === 'function' ? ensemble.onChunk : () => {};

    const runOne = async (member) => {
      const castId = member.id || member.label || 'unknown';
      try {
        const payload = {
          ...(member.payload || {}),
          model: member.model || member.payload?.model,
        };
        const result = await this._enqueueInference(
          member.mode === 'generate' ? 'generate' : 'stream',
          payload,
          member.mode === 'generate' ? null : (chunk) => {
            try { onChunk(castId, chunk); } catch (_) { /* noop */ }
          },
        );
        // Backend.stream() returns {requestId, streamTask} immediately while
        // tokens keep arriving via onChunk in the background. We MUST await the
        // streamTask so parallelStream does not signal "done" prematurely; the
        // UI depends on the global done event to flip out of "playing" state
        // and Ollama may queue a second request behind a still-running one.
        if (member.mode !== 'generate'
          && result
          && typeof result === 'object'
          && typeof result.streamTask?.then === 'function') {
          try { await result.streamTask; }
          catch (streamError) {
            try { onChunk(castId, { error: streamError?.message || 'stream failed', done: true }); } catch (_) { /* noop */ }
            return { castId, label: member.label || castId, success: false, error: streamError?.message || String(streamError) };
          }
        }
        try { onChunk(castId, { done: true }); } catch (_) { /* noop */ }
        return { castId, label: member.label || castId, success: true, result };
      } catch (error) {
        try { onChunk(castId, { error: error?.message || 'stream failed', done: true }); } catch (_) { /* noop */ }
        return { castId, label: member.label || castId, success: false, error: error?.message || String(error) };
      }
    };

    const results = [];
    for (let i = 0; i < cast.length; i += maxParallel) {
      const slice = cast.slice(i, i + maxParallel);
      const batch = await Promise.all(slice.map(runOne));
      results.push(...batch);
    }
    return { success: results.some((r) => r.success), results };
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

    const { backend, fallbackReason: selectionFallbackReason } = await this._selectBackendForRequest(request);
    if (!backend) {
      return {
        ok: false,
        success: false,
        model: modelName,
        backend: null,
        fallbackReason: selectionFallbackReason || 'no-backend',
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

    let offloadEvidence = await this._collectOffloadEvidence(backend, modelName);
    const elapsedMs = Date.now() - startedAt;

    // If model ended up on CPU but GPU backend was selected, force a reload
    const strictGpuVerification = backend.id === 'ollama-cuda';
    if (strictGpuVerification && !offloadEvidence.verified && typeof backend._makeRequest === 'function') {
      console.log('[Orchestrator] GPU offload not verified — forcing unload/reload cycle for', modelName);
      try {
        await backend._makeRequest('/api/generate', {
          method: 'POST',
          body: { model: modelName, keep_alive: 0 },
          timeout: 10000,
        });
        await new Promise((r) => setTimeout(r, 1500));
        await backend._makeRequest('/api/generate', {
          method: 'POST',
          body: {
            model: modelName,
            prompt: 'Hi',
            stream: false,
            options: { num_gpu: -1, num_predict: 1, num_ctx: 512, flash_attn: true },
          },
          timeout: 120000,
        });
        offloadEvidence = await this._collectOffloadEvidence(backend, modelName);
        console.log('[Orchestrator] GPU reload complete, verified:', offloadEvidence.verified);
      } catch (reloadErr) {
        console.warn('[Orchestrator] GPU reload failed:', reloadErr.message);
      }
    }

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

    this._recordOffloadEvidence(`${modelName}::${backend.id}`, payload.offloadEvidence);
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
    if (!PROFILE_ORDER_STANDARD[profile] && !PROFILE_ORDER_UNIFIED[profile]) {
      profile = 'balanced';
    }
    this.profile = profile;
    this.store?.set('performanceProfile', profile);
    this._applyLanePolicy();
    // Re-evaluate the warmloop: efficiency/laptop should unload the
    // resident warm model, balanced/speed can re-warm if the gates
    // allow it.
    if (this._npuWarmloop) {
      this._npuWarmloop.evaluate().catch(() => { /* non-blocking */ });
    }
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
      lastBackendDecision: this.lastBackendDecision || null,
      lastExecutionMode: this.lastExecutionPlan?.lastExecutionMode || null,
      requestedModel: this.lastExecutionPlan?.requestedModel || null,
      effectiveModel: this.lastExecutionPlan?.effectiveModel || null,
      effectiveOptions: this.lastExecutionPlan?.effectiveOptions || {},
      modeReasons: Array.isArray(this.lastExecutionPlan?.modeReasons) ? this.lastExecutionPlan.modeReasons : [],
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
  } else if (store && orchestratorInstance.store !== store) {
    orchestratorInstance._attachStore(store);
  }
  return orchestratorInstance;
}

module.exports = {
  InferenceOrchestrator,
  getOrchestrator,
};
