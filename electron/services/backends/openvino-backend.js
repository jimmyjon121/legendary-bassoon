/**
 * OpenVINO Backend
 * Wrapper for OpenVINO inference (NPU and Intel GPU support)
 * 
 * This is a stub implementation that will connect to an OpenVINO
 * inference server when available. The actual inference is done
 * by a Python server using the OpenVINO runtime.
 */

const BaseBackend = require('./base-backend');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getNpuBridge } = require('../npu-bridge');

class OpenVinoBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: config.device === 'NPU' ? 'openvino-npu' : 'openvino-gpu',
      name: config.device === 'NPU' ? 'OpenVINO (NPU)' : 'OpenVINO (Intel GPU)',
      type: 'openvino',
      endpoint: config.endpoint || 'http://localhost:8081',
      device: config.device || 'NPU',
      priority: config.device === 'NPU' ? 3 : 4,
      capabilities: {
        streaming: true,
        vision: false, // Depends on model
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
  }

  /**
   * Make HTTP request to OpenVINO server
   */
  _makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 8081),
        path,
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

  /**
   * Check if OpenVINO backend is available
   */
  async checkHealth() {
    // First check if OpenVINO is installed
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

    // Check if NPU is available for NPU backend
    if (this.device === 'NPU' && !npuStatus.npuAvailable) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'no-npu',
        error: 'Intel NPU not detected',
        devices: npuStatus.devices
      };
    }

    // Check if server is running
    try {
      const response = await this._makeRequest('/health', { timeout: 5000 });
      
      if (response.status === 200) {
        this.setStatus('available');
        this.configured = true;
        return {
          available: true,
          status: 'online',
          device: this.device,
          model: response.data?.model
        };
      } else {
        this.setStatus('error');
        return {
          available: false,
          status: 'error',
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'server-offline',
        error: 'OpenVINO server not running',
        serverRequired: true
      };
    }
  }

  /**
   * Generate a complete response
   * Uses OpenAI-compatible API format
   */
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

  /**
   * Stream a response
   */
  async stream(payload, onChunk) {
    const health = await this.checkHealth();
    if (!health.available) {
      throw new Error(`OpenVINO backend not available: ${health.error}`);
    }

    const requestId = `openvino-${Date.now()}`;

    const fallback = async () => {
      try {
        const result = await this.generate(payload);
        if (result.response) {
          onChunk({ response: result.response, done: false });
        }
        onChunk({ done: true });
        return { requestId };
      } catch (error) {
        throw error;
      }
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
                // ignore malformed chunk
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

      req.on('error', async (error) => {
        this.activeRequests.delete(requestId);
        try {
          const result = await fallback();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      this.activeRequests.set(requestId, req);

        req.write(
          JSON.stringify({
            model: payload.model,
            prompt: payload.prompt,
            system: payload.system,
            max_tokens: payload.options?.num_predict || 512,
            temperature: payload.options?.temperature ?? 0.7,
          }),
        );

      req.end();
    });
  }

  /**
   * Get available models
   */
  async getModels() {
    try {
      const response = await this._makeRequest('/models');
      return response.data?.data || [];
    } catch {
      return [];
    }
  }

  /**
   * Load a model
   * OpenVINO models need to be in ONNX or OpenVINO IR format
   */
  async loadModel(modelPath) {
    try {
      const response = await this._makeRequest('/models/load', {
        method: 'POST',
        body: { model_path: modelPath, device: this.device }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to load model: ${error.message}`);
    }
  }

  /**
   * Cancel an ongoing request
   */
  async cancel(requestId) {
    const req = this.activeRequests.get(requestId);
    if (req) {
      req.destroy();
      this.activeRequests.delete(requestId);
      return { success: true };
    }
    return { success: false, error: 'Request not found' };
  }

  /**
   * Estimate performance for NPU/Intel GPU
   */
  estimatePerformance(parameterCount) {
    if (this.device === 'NPU') {
      // NPU is efficient but has limited memory
      return {
        tokensPerSecond: parameterCount < 3 ? 40 : parameterCount < 7 ? 20 : 5,
        memoryRequired: parameterCount * 1.5,
        suitable: parameterCount < 7, // NPU best for small models
        powerEfficient: true
      };
    } else {
      // Intel Arc GPU
      return {
        tokensPerSecond: parameterCount < 7 ? 30 : parameterCount < 13 ? 15 : 8,
        memoryRequired: parameterCount * 1.5,
        suitable: parameterCount < 20
      };
    }
  }

  /**
   * Get setup instructions for OpenVINO
   */
  getSetupInstructions() {
    return this.npuBridge.getSetupInstructions();
  }
}

module.exports = OpenVinoBackend;


