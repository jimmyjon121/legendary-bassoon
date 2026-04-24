/**
 * LlamaNode Backend
 *
 * In-process GGUF runtime via node-llama-cpp. Replaces the "ollama create
 * copies every GGUF into the blob store" path with a direct load from the
 * user's local file — no duplication, no Ollama subprocess, LM Studio-style.
 *
 * Single-resident model policy: one (model, context, session) triple is
 * kept hot. Loading a new model evicts the previous one. This mirrors LM
 * Studio's default behavior and matches OLLAMA_MAX_LOADED_MODELS=1.
 *
 * node-llama-cpp is loaded lazily (inside methods, guarded by try/catch)
 * so the app still boots if the native module failed to install or the
 * CUDA runtime is missing. When unavailable, the backend reports as
 * offline and the orchestrator falls back to Ollama automatically.
 */

const BaseBackend = require('./base-backend');
const path = require('path');
const fs = require('fs');

const GGUF_MODEL_PREFIX = 'gguf:';

function stripPrefix(modelId) {
  const id = String(modelId || '').trim();
  if (id.toLowerCase().startsWith(GGUF_MODEL_PREFIX)) {
    return id.slice(GGUF_MODEL_PREFIX.length);
  }
  return id;
}

function isGgufModelId(modelId) {
  return String(modelId || '').trim().toLowerCase().startsWith(GGUF_MODEL_PREFIX);
}

function normalizePathKey(modelPath) {
  try {
    return path.resolve(String(modelPath || '')).toLowerCase();
  } catch {
    return String(modelPath || '').toLowerCase();
  }
}

// node-llama-cpp v2 ships as ESM with top-level await in its entry point,
// so it cannot be loaded via require() from CommonJS. We use dynamic
// import() and cache the resulting module reference. The load is async,
// but the backend's public methods already return promises so callers
// don't see any difference.
async function loadLlamaModule() {
  try {
    const mod = await import('node-llama-cpp');
    // import() returns a namespace object; the library's exports live on
    // it directly. Normalize to a plain object with the symbols we need.
    return {
      LlamaModel: mod.LlamaModel,
      LlamaContext: mod.LlamaContext,
      LlamaChatSession: mod.LlamaChatSession,
      LlamaGrammar: mod.LlamaGrammar,
      AbortError: mod.AbortError,
    };
  } catch (err) {
    const reason = err?.code === 'MODULE_NOT_FOUND' || /Cannot find package/.test(String(err?.message || ''))
      ? 'node-llama-cpp not installed'
      : `node-llama-cpp load failed: ${err?.message || err}`;
    return { __error: reason };
  }
}

class LlamaNodeBackend extends BaseBackend {
  constructor(config = {}) {
    super({
      id: config.id || 'llamanode',
      name: config.name || 'llama.cpp (in-process)',
      type: 'llamanode',
      device: config.device || 'auto',
      priority: config.priority ?? 2,
      capabilities: {
        streaming: true,
        vision: false,
        embeddings: false,
        function_calling: false,
        local_gguf: true,
      },
      ...config,
    });

    this.useGpu = config.useGpu !== false;
    // Single-resident model state.
    this._current = null; // { pathKey, modelPath, contextSize, model, context, session, metadata }
    this._loading = null; // in-flight load promise (serializes concurrent loads)
    this._modulePromise = null; // cached dynamic import() promise for node-llama-cpp
    this._activeRequests = new Map();

    this.gpuLayers = typeof config.gpuLayers === 'number' ? config.gpuLayers : -1;
  }

  // Returns a Promise that resolves to the loaded module (or an error
  // object). We cache the promise so concurrent callers share one load,
  // and a resolved successful load is memoized for the lifetime of the
  // process.
  _getModule() {
    if (!this._modulePromise) {
      this._modulePromise = loadLlamaModule();
    }
    return this._modulePromise;
  }

  async checkHealth() {
    const mod = await this._getModule();
    if (mod?.__error) {
      this.setStatus('unavailable');
      return {
        available: false,
        status: 'not-installed',
        error: mod.__error,
      };
    }
    this.setStatus('available');
    return {
      available: true,
      status: this._current ? 'loaded' : 'idle',
      model: this._current?.modelPath || null,
      device: this.device,
    };
  }

  async loadModel(modelPathOrId, options = {}) {
    const modelPath = stripPrefix(modelPathOrId);
    if (!modelPath) {
      throw new Error('Model path is required');
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    const contextSize = Number.isFinite(Number(options.contextSize)) && Number(options.contextSize) > 0
      ? Number(options.contextSize)
      : (Number.isFinite(Number(options.num_ctx)) && Number(options.num_ctx) > 0 ? Number(options.num_ctx) : 4096);

    const pathKey = normalizePathKey(modelPath);

    if (this._current
      && this._current.pathKey === pathKey
      && this._current.contextSize === contextSize) {
      return { success: true, already: true, metadata: this._current.metadata };
    }

    if (this._loading) {
      try { await this._loading; } catch { /* previous load failed; continue */ }
    }

    const mod = await this._getModule();
    if (mod?.__error) {
      throw new Error(mod.__error);
    }

    this._loading = (async () => {
      await this._evictCurrent();

      const { LlamaModel, LlamaContext, LlamaChatSession } = mod;
      if (!LlamaModel || !LlamaContext || !LlamaChatSession) {
        throw new Error('node-llama-cpp API not found — check installed version is 2.x');
      }

      const model = new LlamaModel({
        modelPath,
        gpuLayers: this.useGpu ? this.gpuLayers : 0,
        useMlock: false,
      });

      const context = new LlamaContext({
        model,
        contextSize,
        batchSize: Number(options.batchSize) || 512,
      });

      const session = new LlamaChatSession({ context });

      const metadata = {
        path: modelPath,
        contextLength: contextSize,
        trainedContextLength: typeof model.trainContextSize === 'number' ? model.trainContextSize : null,
        architecture: model.architecture || null,
        fileSize: (() => {
          try { return fs.statSync(modelPath).size; } catch { return null; }
        })(),
      };

      this._current = { pathKey, modelPath, contextSize, model, context, session, metadata };
      this.setStatus('available');
      return { success: true, metadata };
    })();

    try {
      return await this._loading;
    } finally {
      this._loading = null;
    }
  }

  async _evictCurrent() {
    if (!this._current) return;
    const prev = this._current;
    this._current = null;
    try {
      if (typeof prev.session?.dispose === 'function') await prev.session.dispose();
      if (typeof prev.context?.dispose === 'function') await prev.context.dispose();
      if (typeof prev.model?.dispose === 'function') await prev.model.dispose();
    } catch (err) {
      console.warn('[LlamaNode] Eviction dispose warning:', err?.message || err);
    }
  }

  async unloadModel() {
    await this._evictCurrent();
    return { success: true };
  }

  _ensureLoaded(payload) {
    const requestedModel = stripPrefix(payload?.model);
    const requestedCtx = Number(payload?.options?.num_ctx) || 4096;
    if (!this._current || this._current.pathKey !== normalizePathKey(requestedModel) || this._current.contextSize !== requestedCtx) {
      return this.loadModel(requestedModel, { contextSize: requestedCtx });
    }
    return Promise.resolve({ success: true, already: true, metadata: this._current.metadata });
  }

  _buildUserPrompt(payload) {
    if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
      const reversed = [...payload.messages].reverse();
      const lastUser = reversed.find((m) => m?.role === 'user');
      return String(lastUser?.content || '').trim();
    }
    return String(payload?.prompt || '').trim();
  }

  _buildGenerationOptions(payload) {
    const o = payload?.options || {};
    const opts = {
      maxTokens: Number.isFinite(Number(o.num_predict)) && Number(o.num_predict) > 0 ? Number(o.num_predict) : 512,
      temperature: Number.isFinite(Number(o.temperature)) ? Number(o.temperature) : 0.7,
      topP: Number.isFinite(Number(o.top_p)) ? Number(o.top_p) : 0.9,
      topK: Number.isFinite(Number(o.top_k)) ? Number(o.top_k) : 40,
    };
    if (Number.isFinite(Number(o.repeat_penalty))) {
      opts.repeatPenalty = { penalty: Number(o.repeat_penalty) };
    }
    return opts;
  }

  async generate(payload) {
    await this._ensureLoaded(payload);
    const prompt = this._buildUserPrompt(payload);
    if (!prompt) {
      throw new Error('LlamaNode generate: empty prompt');
    }
    const session = this._current.session;
    const response = await session.prompt(prompt, this._buildGenerationOptions(payload));
    return {
      response: typeof response === 'string' ? response : String(response || ''),
      done: true,
      model: payload.model,
      metadata: this._current.metadata,
    };
  }

  async stream(payload, onChunk) {
    await this._ensureLoaded(payload);
    const prompt = this._buildUserPrompt(payload);
    if (!prompt) {
      throw new Error('LlamaNode stream: empty prompt');
    }

    const requestId = `llamanode-${Date.now()}`;
    const mod = await this._getModule();
    const session = this._current.session;
    const context = this._current.context;

    let aborted = false;
    const abortController = {
      abort: () => { aborted = true; },
    };
    this._activeRequests.set(requestId, abortController);

    const baseOptions = this._buildGenerationOptions(payload);

    try {
      await session.prompt(prompt, {
        ...baseOptions,
        onToken: (chunks) => {
          if (aborted) return;
          try {
            const decoded = typeof context.decode === 'function'
              ? context.decode(chunks)
              : (mod.Token && typeof mod.Token.decode === 'function' ? mod.Token.decode(chunks) : String(chunks));
            if (decoded) {
              onChunk({ response: decoded, done: false });
            }
          } catch (err) {
            console.warn('[LlamaNode] token decode failed:', err?.message || err);
          }
        },
      });
      if (!aborted) onChunk({ done: true });
    } catch (err) {
      if (!aborted) throw err;
    } finally {
      this._activeRequests.delete(requestId);
    }

    return { requestId };
  }

  async cancel(requestId) {
    const ctrl = this._activeRequests.get(requestId);
    if (ctrl) {
      ctrl.abort();
      this._activeRequests.delete(requestId);
      return { success: true };
    }
    return { success: false, error: 'Request not found' };
  }

  async getModels() {
    if (!this._current) return [];
    return [{
      name: path.basename(this._current.modelPath),
      path: this._current.modelPath,
      backend: 'llamanode',
      contextLength: this._current.metadata?.trainedContextLength || this._current.contextSize,
    }];
  }

  estimatePerformance(parameterCount) {
    // RTX 5050 Laptop Blackwell rough estimate (with CUDA GPU layers).
    return {
      tokensPerSecond: parameterCount < 7 ? 80 : parameterCount < 13 ? 50 : parameterCount < 30 ? 25 : 10,
      memoryRequired: parameterCount * 1.2,
      suitable: parameterCount < 32,
    };
  }
}

module.exports = LlamaNodeBackend;
module.exports.GGUF_MODEL_PREFIX = GGUF_MODEL_PREFIX;
module.exports.isGgufModelId = isGgufModelId;
module.exports.stripPrefix = stripPrefix;
