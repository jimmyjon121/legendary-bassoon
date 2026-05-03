/**
 * Ollama Backend
 * Wrapper for Ollama API (supports CUDA and CPU)
 */

const BaseBackend = require('./base-backend');
const http = require('http');
const https = require('https');

class OllamaBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: config.useCuda ? 'ollama-cuda' : 'ollama-cpu',
      name: config.useCuda ? 'Ollama (CUDA)' : 'Ollama (CPU)',
      type: 'ollama',
      endpoint: config.endpoint || 'http://localhost:11434',
      device: config.device || (config.useCuda ? 'NVIDIA GPU' : 'CPU'),
      priority: config.useCuda ? 1 : 99,
      capabilities: {
        streaming: true,
        vision: true,
        embeddings: true,
        function_calling: false
      },
      ...config
    });

    this.useCuda = config.useCuda || false;
    this.activeRequests = new Map();
  }

  /**
   * Make HTTP request to Ollama
   */
  _makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: options.timeout || 30000
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
   * Stream request to Ollama
   */
  _streamRequest(path, body, onChunk, requestId) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;
      const shouldLogDiagnostics = process.env.NODE_ENV !== 'production';

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = protocol.request(reqOptions, (res) => {
        if (res.statusCode !== 200) {
          let errorBody = '';
          res.on('data', (chunk) => { errorBody += chunk.toString(); });
          res.on('end', () => {
            this.activeRequests.delete(requestId);
            reject(new Error(`HTTP ${res.statusCode}: ${errorBody.slice(0, 300)}`));
          });
          return;
        }

        let buffer = '';
        let emittedContent = false;
        let sawDoneSignal = false;

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed?.done) sawDoneSignal = true;
              if (
                (typeof parsed?.response === 'string' && parsed.response.length > 0) ||
                (typeof parsed?.message?.content === 'string' && parsed.message.content.length > 0)
              ) {
                emittedContent = true;
              }
              onChunk(parsed);
            } catch (error) {
              if (shouldLogDiagnostics) {
                console.warn('[OllamaBackend] Failed to parse stream line:', error.message);
              }
            }
          }
        });

        res.on('end', () => {
          const trailing = buffer.trim();
          if (trailing) {
            try {
              const parsed = JSON.parse(trailing);
              if (parsed?.done) sawDoneSignal = true;
              if (
                (typeof parsed?.response === 'string' && parsed.response.length > 0) ||
                (typeof parsed?.message?.content === 'string' && parsed.message.content.length > 0)
              ) {
                emittedContent = true;
              }
              onChunk(parsed);
            } catch (error) {
              if (shouldLogDiagnostics) {
                console.warn('[OllamaBackend] Dropped trailing partial stream buffer:', error.message);
              }
            }
          }
          this.activeRequests.delete(requestId);
          if (shouldLogDiagnostics && sawDoneSignal && !emittedContent) {
            console.warn('[OllamaBackend] Stream finished without content after done signal');
          }
          resolve();
        });
      });

      req.on('error', (error) => {
        this.activeRequests.delete(requestId);
        reject(error);
      });

      // Store request for cancellation
      if (requestId) {
        this.activeRequests.set(requestId, req);
      }

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Check if Ollama is available
   */
  async checkHealth() {
    try {
      const response = await this._makeRequest('/api/tags', { timeout: 5000 });
      
      if (response.status === 200) {
        this.setStatus('available');
        return {
          available: true,
          status: 'online',
          models: response.data?.models?.length || 0,
          version: response.data?.version
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
        status: 'offline',
        error: error.message
      };
    }
  }

  /**
   * Build optimized options for this backend
   * Ensures GPU offload, flash attention, and performance settings are applied
   */
  _buildOptions(payloadOptions = {}) {
    const options = {
      num_gpu: this.useCuda ? -1 : 0, // -1 = ALL layers on GPU, no exceptions
      ...payloadOptions,
    };

    // ALWAYS force full GPU offload for CUDA backends
    // Don't let caller accidentally set partial offload
    if (this.useCuda && (options.num_gpu === 0 || options.num_gpu === undefined)) {
      options.num_gpu = -1;
    }

    // Enable flash attention if not explicitly disabled
    // Dramatically speeds up long-context inference on modern GPUs
    if (options.flash_attn === undefined && this.useCuda) {
      options.flash_attn = true;
    }

    return options;
  }

  /**
   * Generate a complete response
   */
  async generate(payload) {
    try {
      const options = this._buildOptions(payload.options);

      const hasMessages = Array.isArray(payload.messages) && payload.messages.length > 0;
      const apiPath = hasMessages ? '/api/chat' : '/api/generate';

      // Default to long residency when upstream didn't set a keep_alive.
      // The orchestrator normally sets this profile-aware; this fallback
      // applies only for callers that bypass the orchestrator.
      const keepAlive = payload.keep_alive !== undefined && payload.keep_alive !== null
        ? payload.keep_alive
        : '24h';

      const requestBody = hasMessages
        ? {
            model: payload.model,
            messages: payload.system
              ? [{ role: 'system', content: payload.system }, ...payload.messages]
              : payload.messages,
            stream: false,
            options,
            keep_alive: keepAlive,
            ...(payload.format ? { format: payload.format } : {}),
          }
        : {
            model: payload.model,
            prompt: payload.prompt,
            system: payload.system,
            stream: false,
            options,
            keep_alive: keepAlive,
            ...(payload.raw ? { raw: true } : {}),
            ...(payload.format ? { format: payload.format } : {}),
            ...(payload.images ? { images: payload.images } : {}),
          };

      const response = await this._makeRequest(apiPath, {
        method: 'POST',
        body: requestBody,
        timeout: 300000 // 5 minutes for generation
      });

      if (response.status !== 200) {
        throw new Error(response.data?.error || `HTTP ${response.status}`);
      }

      if (hasMessages && response.data?.message?.content && !response.data?.response) {
        response.data.response = response.data.message.content;
      }

      return response.data || {};
    } catch (error) {
      throw new Error(`Ollama generation failed: ${error.message}`);
    }
  }

  /**
   * Stream a response
   */
  async stream(payload, onChunk) {
    const requestId = `ollama-${Date.now()}`;
    
    try {
      const options = this._buildOptions(payload.options);
      const hasMessages = Array.isArray(payload.messages) && payload.messages.length > 0;
      const apiPath = hasMessages ? '/api/chat' : '/api/generate';

      const keepAlive = payload.keep_alive !== undefined && payload.keep_alive !== null
        ? payload.keep_alive
        : '24h';

      const requestBody = hasMessages
        ? {
            model: payload.model,
            messages: payload.system
              ? [{ role: 'system', content: payload.system }, ...payload.messages]
              : payload.messages,
            stream: true,
            options,
            keep_alive: keepAlive,
            ...(payload.format ? { format: payload.format } : {}),
          }
        : {
            model: payload.model,
            prompt: payload.prompt,
            system: payload.system,
            stream: true,
            options,
            keep_alive: keepAlive,
            ...(payload.raw ? { raw: true } : {}),
            ...(payload.images ? { images: payload.images } : {}),
          };

      const streamTask = this._streamRequest(
        apiPath,
        requestBody,
        (parsed) => {
          if (hasMessages && parsed?.message?.content) {
            onChunk({ response: parsed.message.content, done: !!parsed.done });
            return;
          }
          onChunk(parsed);
        },
        requestId
      ).catch((error) => {
        onChunk({ error: error.message, done: true });
        throw error;
      });

      this.activeRequests.set(`${requestId}:task`, streamTask);
      streamTask.finally(() => this.activeRequests.delete(`${requestId}:task`));
      
      return { requestId, streamTask };
    } catch (error) {
      throw new Error(`Ollama streaming failed: ${error.message}`);
    }
  }

  /**
   * Get available models
   */
  async getModels() {
    try {
      const response = await this._makeRequest('/api/tags');
      return response.data?.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Pull/load a model
   */
  async loadModel(modelName) {
    try {
      const response = await this._makeRequest('/api/pull', {
        method: 'POST',
        body: { name: modelName },
        timeout: 600000 // 10 minutes for download
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to pull model: ${error.message}`);
    }
  }

  /**
   * Warmup/preload a model into GPU memory
   * This sends a minimal request to force Ollama to load the model
   */
  async warmupModel(modelName) {
    console.log(`[OllamaBackend] Warming up model: ${modelName}`);
    try {
      // Send a minimal generation request to force model loading
      // Use full GPU offload to preload all layers into VRAM
      const response = await this._makeRequest('/api/generate', {
        method: 'POST',
        body: {
          model: modelName,
          prompt: 'Hi',
          stream: false,
          options: {
            num_gpu: this.useCuda ? -1 : 0, // Full GPU offload
            num_predict: 1,    // Only generate 1 token
            num_ctx: 512,      // Minimal context for warmup
            flash_attn: true,  // Enable flash attention from the start
          }
        },
        timeout: 120000 // 2 minutes for initial load
      });

      if (response.status !== 200) {
        throw new Error(response.data?.error || `HTTP ${response.status}`);
      }

      console.log(`[OllamaBackend] Model ${modelName} warmed up successfully`);
      return { success: true, model: modelName };
    } catch (error) {
      console.error(`[OllamaBackend] Warmup failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get GPU memory info from Ollama
   */
  async getGpuInfo() {
    try {
      // Ollama doesn't have a direct GPU info endpoint, but we can check
      // running models which shows GPU layer info
      const response = await this._makeRequest('/api/ps', { timeout: 5000 });
      return response.data;
    } catch {
      return null;
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
   * Estimate performance based on GPU/CPU
   */
  estimatePerformance(parameterCount) {
    if (this.useCuda) {
      // CUDA estimates (rough)
      return {
        tokensPerSecond: parameterCount < 7 ? 50 : parameterCount < 13 ? 30 : 15,
        memoryRequired: parameterCount * 1.2, // GGUF is compressed
        suitable: parameterCount < 30 // Most consumer GPUs can handle up to 30B
      };
    } else {
      // CPU estimates
      return {
        tokensPerSecond: parameterCount < 7 ? 10 : parameterCount < 13 ? 5 : 2,
        memoryRequired: parameterCount * 1.2,
        suitable: true // CPU can always run, just slower
      };
    }
  }
}

module.exports = OllamaBackend;
