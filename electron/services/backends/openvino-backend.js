/**
 * OpenVINO Backend
 * Wrapper for OpenVINO inference (NPU and Intel GPU support)
 *
 * Connects to an OpenVINO inference server (Python/FastAPI) that runs
 * on localhost:8081 by default.
 *
 * PERFORMANCE: checkHealth() caches its result for 15 seconds so that
 * repeated calls from the orchestrator / generate / stream don't
 * repeatedly spawn Python or hammer the HTTP endpoint.
 */

const BaseBackend = require('./base-backend');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { getNpuBridge } = require('../npu-bridge');

function traceNpuDebug(payload = {}) {
  if (process.env.DEVFORGE_DEBUG_NPU_TRACE !== '1') return;
  try {
    const line = JSON.stringify({
      source: 'openvino-backend',
      ...payload,
      timestamp: Date.now(),
    }) + '\n';
    fs.appendFileSync(path.join(process.cwd(), 'debug-npu-trace.log'), line);
  } catch (_) {
    // Debug tracing must never affect runtime behavior.
  }
}

class OpenVinoBackend extends BaseBackend {
  constructor(config = {}) {
    const deviceStr = String(config.device || 'NPU');
    const isHybrid = deviceStr.startsWith('HETERO:') || deviceStr.startsWith('MULTI:') || deviceStr.startsWith('AUTO:');
    const isNpu = deviceStr === 'NPU';
    const defaultId = isHybrid ? 'openvino-hybrid' : isNpu ? 'openvino-npu' : 'openvino-gpu';
    const defaultName = isHybrid
      ? `OpenVINO Hybrid (${deviceStr})`
      : isNpu ? 'OpenVINO (NPU)' : 'OpenVINO (Intel GPU)';

    super({
      id: config.id || defaultId,
      name: config.name || defaultName,
      type: 'openvino',
      endpoint: config.endpoint || 'http://localhost:8081',
      device: deviceStr,
      priority: isHybrid ? 0 : isNpu ? 3 : 4,
      capabilities: {
        streaming: true,
        vision: false,
        embeddings: true,
        function_calling: false,
        onnx: true,
        openvino_ir: true
      },
      ...config
    });

    this.npuBridge = getNpuBridge();
    this.configured = false;
    this.activeRequests = new Map();

    // === Health check cache ===
    this._healthCache = { at: 0, value: null };
    this._healthCacheTTL = 15000; // 15 seconds
    this._autoStartAttempted = false;
    // Concurrent requests share a single server-start promise so we never
    // spawn the OpenVINO Python server twice in a race.
    this._lazyStartPromise = null;
  }

  // ------------------------------------------------------------------
  // HTTP helper
  // ------------------------------------------------------------------

  _makeRequest(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 8081),
        path: urlPath,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        timeout: options.timeout || 30000,
      };

      const req = protocol.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // ------------------------------------------------------------------
  // Health check (cached)
  // ------------------------------------------------------------------

  /**
   * Check if OpenVINO backend is available.
   *
   * Results are cached for 15 seconds. To force a fresh check, call
   * invalidateHealthCache() first.
   */
  async checkHealth() {
    const now = Date.now();
    if (this._healthCache.value && (now - this._healthCache.at) < this._healthCacheTTL) {
      return this._healthCache.value;
    }

    const result = await this._doCheckHealth();
    this._healthCache = { at: Date.now(), value: result };
    return result;
  }

  /**
   * Force a fresh health check on next call
   */
  invalidateHealthCache() {
    this._healthCache = { at: 0, value: null };
  }

  /** @private */
  async _doCheckHealth() {
    // Step 1: Check if OpenVINO is installed & NPU is available
    const npuStatus = await this.npuBridge.getStatus();

    if (!npuStatus.openvinoInstalled) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'not-configured',
        error: 'OpenVINO not installed',
        setupRequired: true,
        setupInstructions: this.npuBridge.getSetupInstructions()
      };
    }

    const deviceStr = String(this.device || '');
    const isHybrid = deviceStr.startsWith('HETERO:') || deviceStr.startsWith('MULTI:') || deviceStr.startsWith('AUTO:');
    if (deviceStr === 'NPU' && !npuStatus.npuAvailable) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'no-npu',
        error: 'Intel NPU not detected',
        devices: npuStatus.devices
      };
    }
    if (isHybrid) {
      const devices = npuStatus.devices || [];
      const hasGpu = devices.some(d => /^GPU/i.test(d.id));
      const hasNpu = devices.some(d => /^NPU/i.test(d.id));
      if (!hasGpu && !hasNpu) {
        this.setStatus('unavailable');
        return {
          available: false,
          status: 'no-hybrid-devices',
          error: 'Neither Intel GPU nor NPU detected for hybrid mode',
          devices,
        };
      }
    }

    // Step 2: Check if server is running via lightweight /status endpoint
    try {
      const statusResponse = await this._makeRequest('/status', { timeout: 2000 });

      if (statusResponse.status === 200 && statusResponse.data && typeof statusResponse.data === 'object') {
        const serverRunning = statusResponse.data.server === 'running' || statusResponse.data.status === 'running';
        const modelLoaded = statusResponse.data.model_loaded === true || statusResponse.data.modelLoaded === true;

        if (serverRunning) {
          this.setStatus('available');
          this.configured = true;
          return {
            available: true,
            status: modelLoaded ? 'online' : 'online-idle',
            device: this.device,
            model: statusResponse.data?.model || null,
            modelLoaded,
          };
        }
      }

      // Server returned something but isn't "running" — fall through
      throw new Error('OpenVINO server not in running state');
    } catch {
      // Server unreachable or not running — try auto-start if we haven't recently
      return await this._handleServerOffline();
    }
  }

  /** @private Handle server-offline scenario with auto-start logic */
  async _handleServerOffline() {
    traceNpuDebug({
      location: '_handleServerOffline-entry',
      message: 'backend handler called',
      data: {
        backendId: this.id,
        device: this.device,
        hadLazyStartPromise: !!this._lazyStartPromise,
        autoStartAttempted: this._autoStartAttempted,
      },
    });

    // Concurrent callers share one in-flight start attempt so we never spawn
    // the Python server twice. The promise resolves to the final availability
    // result (success or failure) and is cleared on both outcomes.
    if (this._lazyStartPromise) {
      return this._lazyStartPromise;
    }

    if (this._autoStartAttempted) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'server-offline',
        error: 'OpenVINO server not running',
        serverRequired: true,
      };
    }

    this._autoStartAttempted = true;
    this._lazyStartPromise = (async () => {
      console.log('[OpenVINO Backend] Server offline, attempting auto-start...');
      try {
        const startResult = await this.npuBridge.startServer({ device: this.device });

        if (startResult.success) {
          console.log('[OpenVINO Backend] Server auto-started successfully');

          // Retry loop with backoff — server can take time to initialize
          const startAt = Date.now();
          let delay = 500;
          while (Date.now() - startAt < 30000) {
            try {
              const retryStatus = await this._makeRequest('/status', { timeout: 2000 });
              if (retryStatus.status === 200 && retryStatus.data && typeof retryStatus.data === 'object') {
                const serverRunning = retryStatus.data.server === 'running' || retryStatus.data.status === 'running';
                if (serverRunning) {
                  this.setStatus('available');
                  this.configured = true;
                  return {
                    available: true,
                    status: retryStatus.data.model_loaded === true ? 'online' : 'online-idle',
                    device: this.device,
                    model: retryStatus.data?.model || null,
                    autoStarted: true,
                    modelLoaded: retryStatus.data.model_loaded === true,
                  };
                }
              }
            } catch {
              // Not ready yet, continue retrying
            }
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(4000, Math.round(delay * 1.5));
          }
        }
      } catch (startError) {
        console.warn('[OpenVINO Backend] Auto-start failed:', startError.message);
      }

      // Allow another auto-start attempt after 2 minutes
      setTimeout(() => { this._autoStartAttempted = false; }, 120000);

      this.setStatus('unavailable');
      return {
        available: false,
        status: 'server-offline',
        error: 'OpenVINO server not running',
        serverRequired: true,
      };
    })();

    try {
      return await this._lazyStartPromise;
    } finally {
      this._lazyStartPromise = null;
    }
  }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------

  async generate(payload) {
    const health = await this.checkHealth();
    if (!health.available) {
      throw new Error(`OpenVINO backend not available: ${health.error}`);
    }

    const response = await this._makeRequest('/generate', {
      method: 'POST',
      body: {
        model: payload.model,
        prompt: payload.prompt,
        system: payload.system,
        max_tokens: payload.options?.num_predict || 512,
        temperature: payload.options?.temperature ?? 0.7,
      },
      timeout: 300000,
    });

    if (response.status !== 200) {
      throw new Error(response.data?.error || `Server error: ${response.status}`);
    }

    return {
      response: response.data?.response || response.data?.text || '',
      done: true,
      model: payload.model,
    };
  }

  // ------------------------------------------------------------------
  // Streaming
  // ------------------------------------------------------------------

  async stream(payload, onChunk) {
    const health = await this.checkHealth();
    if (!health.available) {
      throw new Error(`OpenVINO backend not available: ${health.error}`);
    }

    const requestId = `openvino-${Date.now()}`;

    const fallback = async () => {
      const result = await this.generate(payload);
      if (result.response) {
        onChunk({ response: result.response, done: false });
      }
      onChunk({ done: true });
      return { requestId };
    };

    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 8081),
        path: '/generate-stream',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
      };

      const req = protocol.request(reqOptions, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                onChunk({
                  response: parsed.token || parsed.text || '',
                  done: false,
                });
              } catch {
                // Ignore malformed SSE chunk
              }
            }
          }
        });

        res.on('end', () => {
          this.activeRequests.delete(requestId);
          onChunk({ done: true });
          resolve({ requestId });
        });
      });

      req.on('error', async () => {
        this.activeRequests.delete(requestId);
        try {
          const result = await fallback();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      this.activeRequests.set(requestId, req);

      req.write(JSON.stringify({
        model: payload.model,
        prompt: payload.prompt,
        system: payload.system,
        max_tokens: payload.options?.num_predict || 512,
        temperature: payload.options?.temperature ?? 0.7,
      }));

      req.end();
    });
  }

  // ------------------------------------------------------------------
  // Model management
  // ------------------------------------------------------------------

  async getModels() {
    try {
      const response = await this._makeRequest('/models');
      return response.data?.data || [];
    } catch {
      return [];
    }
  }

  async loadModel(modelPath) {
    try {
      const response = await this._makeRequest('/models/load', {
        method: 'POST',
        body: { model_path: modelPath, device: this.device }
      });
      // After loading a model, the health status changes
      this.invalidateHealthCache();
      return response.data;
    } catch (error) {
      throw new Error(`Failed to load model: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Request cancellation
  // ------------------------------------------------------------------

  async cancel(requestId) {
    const req = this.activeRequests.get(requestId);
    if (req) {
      req.destroy();
      this.activeRequests.delete(requestId);
      return { success: true };
    }
    return { success: false, error: 'Request not found' };
  }

  // ------------------------------------------------------------------
  // Performance estimation
  // ------------------------------------------------------------------

  estimatePerformance(parameterCount) {
    const deviceStr = String(this.device || '');
    const isHetero = deviceStr.startsWith('HETERO:');
    const isMulti = deviceStr.startsWith('MULTI:');
    const isAuto = deviceStr.startsWith('AUTO:');

    if (isHetero || isMulti) {
      const gpuBase = parameterCount < 7 ? 30 : parameterCount < 13 ? 15 : 8;
      const multiplier = isHetero ? 1.5 : 1.3;
      return {
        tokensPerSecond: Math.round(gpuBase * multiplier),
        memoryRequired: parameterCount * 1.2,
        suitable: parameterCount < 20,
        powerEfficient: true,
        unified: isHetero,
      };
    }

    if (isAuto) {
      return {
        tokensPerSecond: parameterCount < 7 ? 35 : parameterCount < 13 ? 18 : 10,
        memoryRequired: parameterCount * 1.3,
        suitable: parameterCount < 20,
        powerEfficient: true,
      };
    }

    if (this.device === 'NPU') {
      return {
        tokensPerSecond: parameterCount < 3 ? 40 : parameterCount < 7 ? 20 : 5,
        memoryRequired: parameterCount * 1.5,
        suitable: parameterCount < 7,
        powerEfficient: true,
      };
    }

    return {
      tokensPerSecond: parameterCount < 7 ? 30 : parameterCount < 13 ? 15 : 8,
      memoryRequired: parameterCount * 1.5,
      suitable: parameterCount < 20,
    };
  }

  getSetupInstructions() {
    return this.npuBridge.getSetupInstructions();
  }
}

module.exports = OpenVinoBackend;
