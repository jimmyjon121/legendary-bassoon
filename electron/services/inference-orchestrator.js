/**
 * Inference Orchestrator
 * Smart routing of inference requests to optimal backends
 */

const OllamaBackend = require('./backends/ollama-backend');
const LlamaCppBackend = require('./backends/llamacpp-backend');
const OpenVinoBackend = require('./backends/openvino-backend');
const hardwareDetection = require('./hardware-detection');
const JobQueue = require('./job-queue');
const { getPowerMode } = require('./power-mode');

const PROFILE_ORDER = {
  speed: ['ollama-cuda', 'llamacpp-vulkan', 'openvino-npu', 'ollama-cpu'],
  balanced: [],
  efficiency: ['openvino-npu', 'ollama-cpu', 'llamacpp-vulkan', 'ollama-cuda'],
};

const PROFILE_PRIORITY = {
  speed: 0,
  balanced: 1,
  efficiency: 2,
};

class InferenceOrchestrator {
  constructor(store) {
    this.store = store;
    this.backends = new Map();
    this.currentBackend = null;
    this.preferredBackendId = null;
    this.hardware = null;
    this.initialized = false;
    this.profile = this.store?.get('performanceProfile') || 'balanced';
    this.jobQueue = new JobQueue();
  }

  /**
   * Initialize the orchestrator and detect backends
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[Orchestrator] Initializing...');

    // Detect hardware
    try {
      this.hardware = await hardwareDetection.detectHardware();
      console.log('[Orchestrator] Hardware detected:', {
        gpus: this.hardware.gpus?.length || 0,
        npu: this.hardware.npu?.detected || false,
        recommendations: this.hardware.recommendations?.primary
      });
    } catch (error) {
      console.error('[Orchestrator] Hardware detection failed:', error);
      this.hardware = { gpus: [], npu: { detected: false } };
    }

    // Load preferred backend from settings
    this.preferredBackendId = this.store?.get('preferredBackend') || 'auto';

    // Initialize backends based on hardware
    await this.initializeBackends();

    // Select initial backend
    await this.selectOptimalBackend();

    this.initialized = true;
    console.log('[Orchestrator] Initialized with backend:', this.currentBackend?.id);
  }

  /**
   * Initialize available backends based on detected hardware
   */
  async initializeBackends() {
    const llmEndpoint = this.store?.get('llmEndpoint') || 'http://localhost:11434';
    const llamaCppEndpoint = this.store?.get('llamaCppEndpoint') || 'http://localhost:8080';
    const openvinoEndpoint = this.store?.get('openvinoEndpoint') || 'http://localhost:8081';

    // Always add Ollama backends
    const hasNvidiaGpu = this.hardware.gpus?.some(g => g.type === 'nvidia');
    
    if (hasNvidiaGpu) {
      const nvidiaGpu = this.hardware.gpus.find(g => g.type === 'nvidia');
      this.backends.set('ollama-cuda', new OllamaBackend({
        useCuda: true,
        endpoint: llmEndpoint,
        device: nvidiaGpu?.name || 'NVIDIA GPU',
        priority: 1
      }));
    }

    // CPU backend (always available)
    this.backends.set('ollama-cpu', new OllamaBackend({
      useCuda: false,
      endpoint: llmEndpoint,
      device: this.hardware.cpu?.brand || 'CPU',
      priority: 99
    }));

    // llama.cpp Vulkan backend for Intel Arc
    const hasArcGpu = this.hardware.gpus?.some(g => g.type === 'intel-arc');
    if (hasArcGpu) {
      const arcGpu = this.hardware.gpus.find(g => g.type === 'intel-arc');
      this.backends.set('llamacpp-vulkan', new LlamaCppBackend({
        endpoint: llamaCppEndpoint,
        device: arcGpu?.name || 'Intel Arc GPU',
        useVulkan: true,
        priority: 2
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

    // Check health of all backends
    await this.checkAllBackends();
  }

  /**
   * Check health of all registered backends
   */
  async checkAllBackends() {
    const healthChecks = [];
    
    for (const [id, backend] of this.backends) {
      healthChecks.push(
        backend.checkHealth()
          .then(result => ({ id, ...result }))
          .catch(error => ({ id, available: false, error: error.message }))
      );
    }

    const results = await Promise.all(healthChecks);
    
    for (const result of results) {
      console.log(`[Orchestrator] Backend ${result.id}: ${result.available ? 'available' : 'unavailable'}`);
    }

    return results;
  }

  /**
   * Select the optimal backend based on hardware, preferences, and model size.
   * 
   * STRATEGY:
   * - For models ≤3B params: prefer NPU if available (efficient, low power)
   * - For models ≤13B params: prefer GPU (CUDA > Vulkan)
   * - For larger models: prefer CUDA GPU with maximum VRAM
   * - If selected backend fails health check, try to auto-start it
   */
  async selectOptimalBackend(modelSize = null) {
    // If user has a preference and it's available, use it
    if (this.preferredBackendId && this.preferredBackendId !== 'auto') {
      const preferred = this.backends.get(this.preferredBackendId);
      if (preferred) {
        const health = await preferred.checkHealth();
        if (health.available) {
          this.currentBackend = preferred;
          return preferred;
        }
        // If preferred backend is NPU but not running, try to start it
        if (this.preferredBackendId.includes('npu') || this.preferredBackendId.includes('openvino')) {
          const started = await this._tryStartNpuServer();
          if (started) {
            const retryHealth = await preferred.checkHealth();
            if (retryHealth.available) {
              this.currentBackend = preferred;
              return preferred;
            }
          }
        }
      }
    }

    // === SMART MODEL-SIZE-AWARE SELECTION ===
    // If we know the model size, route to the best backend for that size
    if (modelSize !== null && this.hardware?.npu?.detected) {
      if (modelSize <= 3) {
        // Small models: NPU is perfect - fast, efficient, frees up GPU
        const npuBackend = this.backends.get('openvino-npu');
        if (npuBackend) {
          const health = await npuBackend.checkHealth();
          if (health.available) {
            console.log(`[Orchestrator] Routing ${modelSize}B model to NPU for efficiency`);
            this.currentBackend = npuBackend;
            return npuBackend;
          }
          // Try to auto-start NPU server
          const started = await this._tryStartNpuServer();
          if (started) {
            const retryHealth = await npuBackend.checkHealth();
            if (retryHealth.available) {
              console.log(`[Orchestrator] Auto-started NPU server for ${modelSize}B model`);
              this.currentBackend = npuBackend;
              return npuBackend;
            }
          }
        }
      }
    }

    // Auto-select based on priority and availability
    const availableBackends = [];
    
    for (const [id, backend] of this.backends) {
      const health = await backend.checkHealth();
      if (health.available) {
        availableBackends.push({ id, backend, priority: backend.priority });
      }
    }

    // Sort by priority (lower is better)
    availableBackends.sort((a, b) => a.priority - b.priority);

    const preferredOrder = PROFILE_ORDER[this.profile] || [];
    if (preferredOrder.length) {
      availableBackends.sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.id);
        const bIndex = preferredOrder.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return a.priority - b.priority;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }

    if (availableBackends.length > 0) {
      this.currentBackend = availableBackends[0].backend;
      return this.currentBackend;
    }

    // Fallback to CPU if nothing else available
    this.currentBackend = this.backends.get('ollama-cpu');
    return this.currentBackend;
  }

  /**
   * Try to auto-start the NPU (OpenVINO) server
   */
  async _tryStartNpuServer() {
    try {
      const { getNpuBridge } = require('./npu-bridge');
      const npuBridge = getNpuBridge();
      
      // Check if OpenVINO is installed first
      const status = await npuBridge.getStatus();
      if (!status.openvinoInstalled) {
        console.log('[Orchestrator] OpenVINO not installed, skipping NPU auto-start');
        return false;
      }

      if (status.serverRunning) {
        return true; // Already running
      }

      // Auto-configure if needed
      await npuBridge.autoConfigureModel({ enableAutoStart: true });

      console.log('[Orchestrator] Auto-starting NPU server...');
      const result = await npuBridge.startServer();
      
      if (result.success) {
        console.log('[Orchestrator] NPU server auto-started successfully');
        return true;
      } else {
        console.warn('[Orchestrator] NPU server auto-start failed:', result.error);
        return false;
      }
    } catch (error) {
      console.warn('[Orchestrator] NPU auto-start error:', error.message);
      return false;
    }
  }

  /**
   * Set the preferred backend
   */
  async setPreferredBackend(backendId) {
    this.preferredBackendId = backendId;
    this.store?.set('preferredBackend', backendId);
    
    if (backendId === 'auto') {
      await this.selectOptimalBackend();
    } else {
      const backend = this.backends.get(backendId);
      if (backend) {
        const health = await backend.checkHealth();
        if (health.available) {
          this.currentBackend = backend;
        }
      }
    }

    return this.currentBackend?.getInfo();
  }

  /**
   * Get list of available backends
   */
  async getAvailableBackends() {
    const backends = [];
    
    for (const [id, backend] of this.backends) {
      const health = await backend.checkHealth();
      backends.push({
        ...backend.getInfo(),
        available: health.available,
        healthStatus: health.status
      });
    }

    return backends;
  }

  /**
   * Get current backend info
   */
  getCurrentBackend() {
    return this.currentBackend?.getInfo() || null;
  }

  /**
   * Generate a response using the current backend
   */
  async generate(payload) {
    return this.jobQueue.enqueue(async () => {
      if (!this.currentBackend) {
        await this.selectOptimalBackend();
      }

      if (!this.currentBackend) {
        throw new Error('No available backend for inference');
      }

      // Auto-enable power mode for inference
      const powerMode = getPowerMode();
      const wasEnabled = powerMode.enabled;
      if (!wasEnabled) {
        await powerMode.enable();
        console.log('[Orchestrator] Power mode auto-enabled for inference');
      }

      try {
        return await this.currentBackend.generate(payload);
      } finally {
        // Keep power mode enabled - disable after idle timeout
        this._scheduleIdlePowerDown();
      }
    }, { priority: this.getJobPriority() });
  }

  /**
   * Generate with lightweight tool-calling support.
   * Expects the backend to emit JSON like:
   * { "tool_calls": [ { "name": "readFile", "args": { "path": "..." } } ], "commentary": "...", "final": "..." }
   */
  async generateWithTools(payload, toolExecutor) {
    const response = await this.generate(payload);
    const toolCalls = this._parseToolCalls(response);

    const executor = toolExecutor || (async (call) => {
      const agentTools = require('./agent-tools');
      const fn = agentTools[call.name];
      if (!fn) {
        return { error: `Unknown tool ${call.name}` };
      }
      return fn(call.args || {});
    });

    const toolResults = [];
    for (const call of toolCalls) {
      try {
        const result = await executor(call);
        toolResults.push({ name: call.name, result });
      } catch (error) {
        toolResults.push({ name: call.name, error: error.message });
      }
    }

    return {
      response,
      toolCalls,
      toolResults,
    };
  }

  _parseToolCalls(response) {
    const text = typeof response === 'string' ? response : response?.text || '';
    if (!text) return [];
    const candidates = [];
    const fenced = Array.from(text.matchAll(/```json([\s\S]*?)```/g)).map((m) => m[1]);
    if (fenced.length) {
      candidates.push(...fenced);
    } else {
      candidates.push(text);
    }

    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed.tool_calls)) {
          return parsed.tool_calls.map((t) => ({ name: t.name, args: t.args || {} }));
        }
        if (parsed.tool) {
          return [{ name: parsed.tool, args: parsed.args || {} }];
        }
      } catch {
        // continue
      }
    }
    return [];
  }

  /**
   * Schedule power mode disable after idle period
   */
  _scheduleIdlePowerDown() {
    // Clear existing timeout
    if (this._idlePowerDownTimeout) {
      clearTimeout(this._idlePowerDownTimeout);
    }
    
    // Disable power mode after 2 minutes of idle
    this._idlePowerDownTimeout = setTimeout(async () => {
      const powerMode = getPowerMode();
      if (powerMode.enabled && this.jobQueue.isEmpty()) {
        await powerMode.disable();
        console.log('[Orchestrator] Power mode disabled after idle');
      }
    }, 120000); // 2 minutes
  }

  /**
   * Stream a response using the current backend
   */
  async stream(payload, onChunk) {
    return this.jobQueue.enqueue(async () => {
      if (!this.currentBackend) {
        await this.selectOptimalBackend();
      }

      if (!this.currentBackend) {
        throw new Error('No available backend for inference');
      }

      // Auto-enable power mode for inference
      const powerMode = getPowerMode();
      if (!powerMode.enabled) {
        await powerMode.enable();
        console.log('[Orchestrator] Power mode auto-enabled for streaming');
      }

      try {
        return await this.currentBackend.stream(payload, onChunk);
      } finally {
        // Schedule idle power down
        this._scheduleIdlePowerDown();
      }
    }, { priority: this.getJobPriority() });
  }

  /**
   * Get models from current backend
   */
  async getModels() {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }

    if (!this.currentBackend) {
      return [];
    }

    return this.currentBackend.getModels();
  }

  /**
   * Load a model on current backend
   */
  async loadModel(modelName) {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }

    if (!this.currentBackend) {
      throw new Error('No available backend');
    }

    return this.currentBackend.loadModel(modelName);
  }

  /**
   * Cancel ongoing generation
   */
  async cancel(requestId) {
    if (!this.currentBackend) {
      return { success: false, error: 'No backend' };
    }

    return this.currentBackend.cancel(requestId);
  }

  /**
   * Check health of current backend
   */
  async checkHealth() {
    if (!this.currentBackend) {
      await this.selectOptimalBackend();
    }

    if (!this.currentBackend) {
      return { healthy: false, status: 'no-backend' };
    }

    const health = await this.currentBackend.checkHealth();
    return {
      healthy: health.available,
      status: health.status,
      backend: this.currentBackend.id,
      ...health
    };
  }

  setProfile(profile) {
    if (!PROFILE_ORDER[profile]) {
      profile = 'balanced';
    }
    this.profile = profile;
    this.store?.set('performanceProfile', profile);
  }

  getProfile() {
    return this.profile;
  }

  getJobPriority() {
    return PROFILE_PRIORITY[this.profile] ?? 1;
  }

  /**
   * Get recommendations for a given model
   */
  getRecommendation(modelParams) {
    const recommendations = [];
    
    for (const [id, backend] of this.backends) {
      const perf = backend.estimatePerformance(modelParams);
      if (perf.suitable) {
        recommendations.push({
          backendId: id,
          backendName: backend.name,
          device: backend.device,
          ...perf
        });
      }
    }

    // Sort by tokens per second
    recommendations.sort((a, b) => {
      if (typeof a.tokensPerSecond === 'number' && typeof b.tokensPerSecond === 'number') {
        return b.tokensPerSecond - a.tokensPerSecond;
      }
      return 0;
    });

    return recommendations;
  }
}

// Singleton instance
let orchestratorInstance = null;

function getOrchestrator(store) {
  if (!orchestratorInstance) {
    orchestratorInstance = new InferenceOrchestrator(store);
  }
  return orchestratorInstance;
}

module.exports = {
  InferenceOrchestrator,
  getOrchestrator
};


