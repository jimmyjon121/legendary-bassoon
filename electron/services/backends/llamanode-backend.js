/**
 * LlamaNode Backend
 *
 * In-process GGUF runtime via node-llama-cpp v3. Replaces the "ollama
 * create copies every GGUF into the blob store" path with a direct load
 * from the user's local file -- no duplication, no Ollama subprocess,
 * LM Studio-style.
 *
 * Single-resident model policy: one (model, context, session) triple is
 * kept hot. Loading a new model evicts the previous one. This mirrors LM
 * Studio's default behavior and matches OLLAMA_MAX_LOADED_MODELS=1.
 *
 * node-llama-cpp v3 is loaded lazily via dynamic import() so the app
 * still boots if the native module failed to install or the CUDA runtime
 * is missing. When unavailable, the backend reports as offline and the
 * orchestrator falls back to Ollama automatically.
 *
 * v3 API differences from v2 the orchestrator should know about:
 *   - Single Llama singleton (getLlama({ gpu })) shared across loads.
 *   - Models are awaited (llama.loadModel) instead of new-d.
 *   - Contexts come from model.createContext + context.getSequence().
 *   - Streaming uses onTextChunk(string) instead of onToken(int[]).
 *   - Cancellation via AbortSignal instead of a custom abort flag.
 *   - LlamaContextSequence exposes evaluate() / getProbabilities() which
 *     is the foundation Phase 2's speculative-decode verifier needs.
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

// node-llama-cpp v3 ships as ESM. Electron 32 (Node 20.18) supports
// require() of ESM with --experimental-require-module, but dynamic
// import() works on both v2 and v3 unconditionally so we keep it as
// the load shim for forward-compat.
async function loadLlamaModule() {
  try {
    const mod = await import('node-llama-cpp');
    return {
      getLlama: mod.getLlama,
      LlamaChatSession: mod.LlamaChatSession,
      LlamaJsonSchemaGrammar: mod.LlamaJsonSchemaGrammar,
      LlamaGrammar: mod.LlamaGrammar,
      Token: mod.Token,
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
    this._current = null;
    this._loading = null;
    this._modulePromise = null;
    this._llamaPromise = null;
    this._activeRequests = new Map();

    this.gpuLayers = typeof config.gpuLayers === 'number' ? config.gpuLayers : -1;
  }

  _getModule() {
    if (!this._modulePromise) {
      this._modulePromise = loadLlamaModule();
    }
    return this._modulePromise;
  }

  // Cached singleton llama instance. Initializing it spawns a worker
  // that probes the prebuilt bindings, which we only want to do once.
  async _getLlama() {
    if (!this._llamaPromise) {
      this._llamaPromise = (async () => {
        const mod = await this._getModule();
        if (mod?.__error) {
          throw new Error(mod.__error);
        }
        if (typeof mod.getLlama !== 'function') {
          throw new Error('node-llama-cpp v3 API not found - getLlama() missing. Installed version may be 2.x.');
        }
        const gpuPreference = this.useGpu ? 'auto' : false;
        return mod.getLlama({ gpu: gpuPreference });
      })().catch((err) => {
        this._llamaPromise = null;
        throw err;
      });
    }
    return this._llamaPromise;
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
    let gpu = null;
    try {
      const llama = await this._getLlama();
      gpu = llama?.gpu ?? null;
    } catch (err) {
      return {
        available: false,
        status: 'init-failed',
        error: err?.message || String(err),
      };
    }
    return {
      available: true,
      status: this._current ? 'loaded' : 'idle',
      model: this._current?.modelPath || null,
      device: this.device,
      gpu,
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
    const llama = await this._getLlama();
    const { LlamaChatSession } = mod;
    if (!LlamaChatSession) {
      throw new Error('node-llama-cpp v3 LlamaChatSession not found - check installed version is 3.x.');
    }

    this._loading = (async () => {
      await this._evictCurrent();

      const model = await llama.loadModel({
        modelPath,
        gpuLayers: this.useGpu ? this.gpuLayers : 0,
      });

      const context = await model.createContext({
        contextSize,
        batchSize: Number(options.batchSize) || 512,
      });
      const sequence = context.getSequence();
      const session = new LlamaChatSession({ contextSequence: sequence });

      const trainedContextLength = (
        typeof model.trainContextSize === 'number'
          ? model.trainContextSize
          : (typeof model.fileInfo?.contextLength === 'number'
            ? model.fileInfo.contextLength
            : null)
      );

      const metadata = {
        path: modelPath,
        contextLength: contextSize,
        trainedContextLength,
        architecture: model.fileInfo?.architecture
          || model.architecture
          || null,
        fileSize: (() => {
          try { return fs.statSync(modelPath).size; } catch { return null; }
        })(),
      };

      this._current = {
        pathKey,
        modelPath,
        contextSize,
        model,
        context,
        sequence,
        session,
        metadata,
      };
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
      // Disposing the context releases the sequence; disposing the model
      // releases the underlying weights and frees VRAM.
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

  _buildGenerationOptions(payload, extra = {}) {
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
    return { ...opts, ...extra };
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
    const session = this._current.session;
    const abortController = new AbortController();
    const cancelHandle = {
      abort: () => abortController.abort(),
    };
    this._activeRequests.set(requestId, cancelHandle);

    const baseOptions = this._buildGenerationOptions(payload, {
      signal: abortController.signal,
      onTextChunk: (chunk) => {
        const text = typeof chunk === 'string' ? chunk : String(chunk || '');
        if (text) onChunk({ response: text, done: false });
      },
    });

    let aborted = false;
    try {
      await session.prompt(prompt, baseOptions);
      if (!abortController.signal.aborted) onChunk({ done: true });
    } catch (err) {
      if (abortController.signal.aborted) {
        aborted = true;
      } else {
        throw err;
      }
    } finally {
      this._activeRequests.delete(requestId);
    }

    return { requestId, aborted };
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

  // Phase 2 hook: speculative-decode verifier needs raw access to the
  // active LlamaContextSequence so it can evaluate(tokens) and read
  // probabilities for the verifier acceptance loop. Returns null when
  // no model is loaded so callers can fall back to single-device mode.
  getActiveSequence() {
    return this._current?.sequence || null;
  }

  // Phase 2 verifier adapter. Runs the verifier model forward over the
  // supplied tokens and returns per-position logits. Concrete shape:
  //   - input: tokens = [...prefix, ...draftTokens]
  //   - output: { logits: Float32Array[], vocabSize: number }
  //     where logits[i] is the next-token distribution after observing
  //     tokens[0..i] -- length == tokens.length.
  //
  // The actual logits-extraction call depends on which controlled API
  // node-llama-cpp 3.x exposes for the installed prebuild. If none is
  // available, we throw a clearly-labelled "not implemented on this
  // build" error so the orchestrator can fall back to non-speculative
  // generation cleanly. The pure verifier algorithm in
  // electron/services/spec-decode-verifier.js does NOT depend on this
  // adapter for unit testing -- it accepts an evaluateLogits callback
  // that the orchestrator wires up at runtime.
  async evaluateForVerifier({ tokens } = {}) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('evaluateForVerifier: tokens array is required');
    }
    if (!this._current?.sequence) {
      throw new Error('evaluateForVerifier: no model loaded');
    }
    const sequence = this._current.sequence;

    // node-llama-cpp 3.x exposes `controlledEvaluate(tokens, options)`
    // when built with the verifier-friendly probabilities flag. Probe
    // it carefully so we degrade clearly when the API is missing.
    if (typeof sequence.controlledEvaluate !== 'function') {
      const err = new Error('evaluateForVerifier: spec-decode logits API not available in this node-llama-cpp build (controlledEvaluate missing)');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }

    const result = await sequence.controlledEvaluate(tokens, {
      generateLogits: tokens.map(() => true),
    });

    if (!result || !Array.isArray(result.logits)) {
      const err = new Error('evaluateForVerifier: controlledEvaluate did not return logits[]');
      err.code = 'SPEC_DECODE_UNAVAILABLE';
      throw err;
    }

    return {
      logits: result.logits,
      vocabSize: result.logits[0]?.length ?? 0,
    };
  }

  estimatePerformance(parameterCount) {
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
