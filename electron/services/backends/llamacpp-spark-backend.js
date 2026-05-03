const http = require('http');
const { spawn } = require('child_process');
const BaseBackend = require('./base-backend');
const { resolveSparkMoeProfile } = require('../families/spark-moe-profiles');
const { recommendExpertShift } = require('../spark-retuner');

function httpJson(url, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      timeout: options.timeout || 5000,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
        } catch (_) {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', (error) => resolve({ status: 0, error: error.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'Request timeout' });
    });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

class LlamaCppSparkBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: 'llamacpp-spark',
      name: 'Unified Brain (Spark)',
      type: 'llamacpp-spark',
      endpoint: config.endpoint || 'http://127.0.0.1:11500',
      device: config.device || 'NVIDIA Spark unified memory',
      priority: config.priority ?? 0,
      capabilities: {
        streaming: true,
        chat: true,
        moeTensorPlacement: true,
      },
    });
    this.process = null;
    this.lastExpertTelemetry = null;
    this.lastRetuneRecommendation = null;
  }

  async checkHealth() {
    const response = await httpJson(`${this.endpoint}/health`, { timeout: 2000 });
    const available = response.status >= 200 && response.status < 500;
    this.setStatus(available ? 'available' : 'unavailable');
    return {
      available,
      status: available ? 'online' : 'offline',
      error: available ? null : response.error || 'Spark llama.cpp server is not running',
    };
  }

  buildArgs({ modelPath, modelName, profileLevel = 'recommended' } = {}) {
    const profile = resolveSparkMoeProfile(modelName || modelPath || '', { level: profileLevel }) || {};
    const ctx = profile.num_ctx || 8192;
    const batch = profile.num_batch || 96;
    const kv = profile.kv_cache_type || 'q4_0';
    return [
      '-m', modelPath,
      '-ngl', '999',
      '-fa',
      '--kv-cache-type', kv,
      '-ot', 'blk\\.[0-9]+\\.ffn_(up|gate|down)_exps\\.weight=CPU',
      '-ot', 'blk\\.[0-9]+\\.attn_.*=GPU',
      '-c', String(ctx),
      '-b', String(batch),
      '-ub', String(batch),
      '-t', String(Math.max(4, Math.min(16, require('os').cpus().length - 2))),
      '--host', '127.0.0.1',
      '--port', '11500',
    ];
  }

  async startServer({ binaryPath, modelPath, modelName, profileLevel } = {}) {
    if (!binaryPath || !modelPath) {
      return { success: false, error: 'llama-server binary and modelPath are required' };
    }
    if (this.process && !this.process.killed) {
      return { success: true, alreadyRunning: true };
    }
    const args = this.buildArgs({ modelPath, modelName, profileLevel });
    this.process = spawn(binaryPath, args, {
      env: {
        ...process.env,
        LLAMA_LOG_LEVEL: process.env.LLAMA_LOG_LEVEL || 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const collect = (chunk) => {
      const text = String(chunk || '');
      const expertMatch = text.match(/expert[^0-9]*(\d+)[^0-9]+tokens[^0-9]*(\d+)/i);
      if (expertMatch) {
        this.lastExpertTelemetry = {
          expertId: Number(expertMatch[1]),
          routedTokens: Number(expertMatch[2]),
          at: Date.now(),
        };
        this.lastRetuneRecommendation = recommendExpertShift({
          tokensPerSecond: 0,
          referenceTokensPerSecond: 0,
          memoryPressure: 0,
          currentGpuExperts: 0,
          minGpuExperts: 0,
          maxGpuExperts: 0,
        });
      }
    };
    this.process.stdout?.on('data', collect);
    this.process.stderr?.on('data', collect);
    this.process.on('exit', () => {
      this.process = null;
      this.setStatus('unavailable');
    });
    return { success: true, args };
  }

  async generate(payload = {}) {
    const response = await httpJson(`${this.endpoint}/completion`, {
      method: 'POST',
      timeout: payload.timeout || 300000,
      body: {
        prompt: payload.prompt || '',
        n_predict: payload.options?.num_predict || 1024,
        temperature: payload.options?.temperature,
        top_p: payload.options?.top_p,
        stream: false,
      },
    });
    if (response.status >= 400 || response.error) {
      throw new Error(response.error || response.data?.error || `llama.cpp returned HTTP ${response.status}`);
    }
    return response.data;
  }

  async stream(payload = {}, onChunk = () => {}) {
    const result = await this.generate(payload);
    onChunk({ response: result?.content || result?.response || '', done: true });
  }

  async getModels() {
    return [];
  }

  async loadModel(modelName) {
    return { success: false, error: 'Use startServer with a GGUF path for llamacpp-spark.', modelName };
  }

  getExpertTelemetry() {
    return this.lastExpertTelemetry ? {
      ...this.lastExpertTelemetry,
      retune: this.lastRetuneRecommendation,
    } : null;
  }
}

module.exports = LlamaCppSparkBackend;
