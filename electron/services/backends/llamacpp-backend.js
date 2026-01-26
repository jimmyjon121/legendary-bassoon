/**
 * llama.cpp Backend
 * Wrapper for llama.cpp server (supports Vulkan for Intel Arc)
 */

const BaseBackend = require('./base-backend');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class LlamaCppBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: 'llamacpp-vulkan',
      name: 'llama.cpp (Vulkan)',
      type: 'llamacpp',
      endpoint: config.endpoint || 'http://localhost:8080',
      device: config.device || 'Intel Arc GPU',
      priority: config.priority || 2,
      capabilities: {
        streaming: true,
        vision: false,
        embeddings: true,
        function_calling: false
      },
      ...config
    });

    this.serverProcess = null;
    this.serverPath = config.serverPath || null;
    this.modelPath = config.modelPath || null;
    this.activeRequests = new Map();
    this.useVulkan = config.useVulkan !== false;
  }

  /**
   * Make HTTP request to llama.cpp server
   */
  _makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || 8080,
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
   * Stream request using Server-Sent Events
   */
  _streamRequest(path, body, onChunk, requestId) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const protocol = url.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || 8080,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        }
      };

      const req = protocol.request(reqOptions, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                // Convert to Ollama-like format
                onChunk({
                  response: parsed.content || parsed.choices?.[0]?.delta?.content || '',
                  done: false
                });
              } catch {
                // Ignore parse errors
              }
            }
          }
        });

        res.on('end', () => {
          this.activeRequests.delete(requestId);
          onChunk({ done: true });
          resolve();
        });
      });

      req.on('error', (error) => {
        this.activeRequests.delete(requestId);
        reject(error);
      });

      if (requestId) {
        this.activeRequests.set(requestId, req);
      }

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Check if llama.cpp server is available
   */
  async checkHealth() {
    try {
      const response = await this._makeRequest('/health', { timeout: 5000 });
      
      if (response.status === 200) {
        this.setStatus('available');
        return {
          available: true,
          status: 'online',
          model: response.data?.model_path
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
   * Generate a complete response
   */
  async generate(payload) {
    try {
      const response = await this._makeRequest('/completion', {
        method: 'POST',
        body: {
          prompt: this._buildPrompt(payload),
          n_predict: payload.options?.num_predict || 512,
          temperature: payload.options?.temperature || 0.7,
          top_p: payload.options?.top_p || 0.9,
          stop: payload.options?.stop || [],
          stream: false
        },
        timeout: 300000
      });

      return {
        response: response.data?.content || '',
        done: true,
        model: payload.model
      };
    } catch (error) {
      throw new Error(`llama.cpp generation failed: ${error.message}`);
    }
  }

  /**
   * Stream a response
   */
  async stream(payload, onChunk) {
    const requestId = `llamacpp-${Date.now()}`;
    
    try {
      await this._streamRequest(
        '/completion',
        {
          prompt: this._buildPrompt(payload),
          n_predict: payload.options?.num_predict || 512,
          temperature: payload.options?.temperature || 0.7,
          top_p: payload.options?.top_p || 0.9,
          stop: payload.options?.stop || [],
          stream: true
        },
        onChunk,
        requestId
      );
      
      return { requestId };
    } catch (error) {
      throw new Error(`llama.cpp streaming failed: ${error.message}`);
    }
  }

  /**
   * Build prompt with system message
   */
  _buildPrompt(payload) {
    let prompt = '';
    
    if (payload.system) {
      prompt += `<|system|>\n${payload.system}\n`;
    }
    
    prompt += `<|user|>\n${payload.prompt}\n<|assistant|>\n`;
    
    return prompt;
  }

  /**
   * Get available models (llama.cpp loads one model at a time)
   */
  async getModels() {
    try {
      const health = await this.checkHealth();
      if (health.available && health.model) {
        return [{
          name: path.basename(health.model),
          path: health.model,
          backend: 'llamacpp'
        }];
      }
    } catch {
      // Ignore
    }
    return [];
  }

  /**
   * Load a model (requires server restart)
   */
  async loadModel(modelPath) {
    // llama.cpp server needs to be restarted with new model
    // This is a placeholder - actual implementation would restart the server
    return {
      success: false,
      message: 'Model loading requires server restart. Please start llama.cpp server with the desired model.'
    };
  }

  /**
   * Start the llama.cpp server
   */
  async startServer(modelPath, options = {}) {
    if (!this.serverPath) {
      throw new Error('llama.cpp server path not configured');
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    const args = [
      '-m', modelPath,
      '--host', '127.0.0.1',
      '--port', new URL(this.endpoint).port || '8080',
      '-c', options.contextSize || '4096',
      '-ngl', options.gpuLayers || '99', // Offload all layers to GPU
    ];

    // Add Vulkan support
    if (this.useVulkan) {
      args.push('--gpu-layers', '99');
    }

    return new Promise((resolve, reject) => {
      this.serverProcess = spawn(this.serverPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let started = false;

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[llama.cpp]', output);
        
        if (output.includes('listening') && !started) {
          started = true;
          resolve({ success: true, pid: this.serverProcess.pid });
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error('[llama.cpp error]', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        reject(error);
      });

      this.serverProcess.on('exit', (code) => {
        this.serverProcess = null;
        if (!started) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!started) {
          this.stopServer();
          reject(new Error('Server start timeout'));
        }
      }, 60000);
    });
  }

  /**
   * Stop the llama.cpp server
   */
  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    return { success: true };
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
   * Estimate performance for Vulkan/Arc
   */
  estimatePerformance(parameterCount) {
    // Intel Arc with Vulkan estimates
    return {
      tokensPerSecond: parameterCount < 7 ? 35 : parameterCount < 13 ? 20 : 10,
      memoryRequired: parameterCount * 1.2,
      suitable: parameterCount < 20 // Arc 140T with shared memory
    };
  }
}

module.exports = LlamaCppBackend;


