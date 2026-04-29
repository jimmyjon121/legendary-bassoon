// Model state management slice
// Handles model selection, availability, runtime state, and hardware-aware tuning.

function isSyntheticModel(value = '') {
  return String(value || '').trim().toLowerCase().startsWith('npu:');
}

function isGgufModel(value = '') {
  return String(value || '').trim().toLowerCase().startsWith('gguf:');
}

function getGgufModelPath(value = '') {
  const raw = String(value || '').trim();
  return isGgufModel(raw) ? raw.slice(5).trim() : raw;
}

function getSyntheticModelTarget(value = '') {
  const raw = String(value || '').trim();
  if (!isSyntheticModel(raw)) return raw;
  return raw.slice(4).trim();
}

function getSyntheticModelDisplayName(value = '') {
  const target = getSyntheticModelTarget(value);
  if (!target) return 'NPU model';
  const parts = target.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || target;
}

function getGgufModelDisplayName(value = '') {
  const target = getGgufModelPath(value);
  if (!target) return 'Local GGUF';
  const parts = target.split(/[\\/]/).filter(Boolean);
  return (parts[parts.length - 1] || target).replace(/\.gguf$/i, '');
}

function buildSyntheticModelInfo(model = '', options = {}) {
  const npuStatus = options?.npuStatus || null;
  const target = getSyntheticModelTarget(model);
  const configuredModel = String(npuStatus?.model || npuStatus?.modelPath || '').trim();
  const serverRunning = Boolean(npuStatus?.serverRunning);
  const modelMatches = !target || !configuredModel || configuredModel === target;

  return {
    success: true,
    model,
    family: 'openvino',
    parameterSize: null,
    quantizationLevel: 'fp16',
    contextLength: 8192,
    rawContextLength: 8192,
    effectiveContextLength: 8192,
    format: 'openvino',
    parentModel: target || null,
    template: null,
    templateMode: 'native_chat',
    supportsNativeChat: true,
    baselineStatus: serverRunning && modelMatches ? 'healthy' : 'caution',
    baselineReasons: serverRunning && modelMatches ? [] : ['openvino_model_not_ready'],
    warnings: serverRunning && modelMatches
      ? []
      : ['OpenVINO is selected, but the configured NPU model is not ready yet.'],
    backend: 'openvino-npu',
    synthetic: true,
    displayName: getSyntheticModelDisplayName(model),
  };
}

function buildGgufModelInfo(model = '', options = {}) {
  const path = getGgufModelPath(model);
  const displayName = getGgufModelDisplayName(model);
  const backend = Array.isArray(options?.backends)
    ? options.backends.find((entry) => entry?.id === 'llamanode')
    : null;
  const available = backend ? backend.available !== false : true;

  return {
    success: true,
    model,
    family: 'gguf',
    parameterSize: null,
    quantizationLevel: null,
    contextLength: 8192,
    rawContextLength: 8192,
    effectiveContextLength: 8192,
    format: 'gguf',
    parentModel: path || null,
    template: null,
    templateMode: 'native_chat',
    supportsNativeChat: true,
    baselineStatus: available ? 'healthy' : 'caution',
    baselineReasons: available ? [] : ['llamanode_backend_unavailable'],
    warnings: available ? [] : ['Local GGUF runtime is not available yet.'],
    backend: 'llamanode',
    synthetic: true,
    displayName,
  };
}

function normalizeGgufHealth(model = '', backends = []) {
  const backend = Array.isArray(backends)
    ? backends.find((entry) => entry?.id === 'llamanode')
    : null;
  const available = backend ? backend.available !== false : true;
  return {
    healthy: available,
    status: available ? 'online' : (backend?.healthStatus || 'offline'),
    models: 1,
    error: available ? null : (backend?.error || 'Local GGUF runtime is unavailable'),
    checkedAt: Date.now(),
    model,
    backend: 'llamanode',
  };
}

function normalizeModelLookupKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/:latest$/i, '')
    .replace(/\.gguf$/i, '')
    .replace(/^local-/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function sanitizeLocalModelBase(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function buildModelCandidates(raw = '') {
  const input = String(raw || '').trim();
  if (!input) return [];

  const candidates = new Set();
  const add = (v) => {
    const s = String(v || '').trim();
    if (s) candidates.add(s);
  };

  add(input);
  if (!input.includes(':')) add(`${input}:latest`);

  const parts = input.split(' - ').map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    add(part);
    if (!part.includes(':')) add(`${part}:latest`);

    const base = sanitizeLocalModelBase(part);
    if (base) {
      add(base);
      add(`${base}:latest`);
      const localName = base.startsWith('local-') ? base : `local-${base}`;
      add(localName);
      add(`${localName}:latest`);
    }
  }

  const inputBase = sanitizeLocalModelBase(input);
  if (inputBase) {
    add(inputBase);
    add(`${inputBase}:latest`);
    const localName = inputBase.startsWith('local-') ? inputBase : `local-${inputBase}`;
    add(localName);
    add(`${localName}:latest`);
  }

  return Array.from(candidates);
}

function resolveModelName(requestedModel, models = []) {
  const names = (Array.isArray(models) ? models : [])
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean);

  if (names.length === 0) return null;
  if (!requestedModel) return names[0];

  const candidates = buildModelCandidates(requestedModel);
  if (candidates.length === 0) return names[0];

  const exactMap = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const candidate of candidates) {
    const exact = exactMap.get(candidate.toLowerCase());
    if (exact) return exact;
  }

  const keyedMap = new Map();
  for (const name of names) {
    const key = normalizeModelLookupKey(name);
    if (key && !keyedMap.has(key)) keyedMap.set(key, name);
  }

  for (const candidate of candidates) {
    const key = normalizeModelLookupKey(candidate);
    const match = key ? keyedMap.get(key) : null;
    if (match) return match;
  }

  return null;
}

const DEFAULT_LLM_HEALTH = Object.freeze({
  healthy: false,
  status: 'offline',
  models: 0,
  error: null,
  checkedAt: null,
});

const DEFAULT_LLM_RUNTIME = Object.freeze({
  profile: 'balanced',
  preferredBackendId: 'auto',
  currentBackend: null,
  queue: {
    queued: 0,
    active: 0,
    lanes: {},
  },
  fallbackCounters: {},
  recentDecisions: [],
  lastBackendDecision: null,
  lastExecutionMode: null,
  requestedModel: null,
  effectiveModel: null,
  effectiveOptions: {},
  lastExperiencePlan: null,
  selectedTaskIntent: null,
  overrideTrace: [],
  clampReasons: [],
  softBackendPreference: null,
  backendDecisionSource: null,
  modeReasons: [],
  offloadEvidence: [],
  hardware: {
    gpuCount: 0,
    hasNpu: false,
    cpu: null,
  },
  deviceUtilization: null,
  timestamp: null,
});

function normalizeHealth(health, models = []) {
  const count = Array.isArray(models)
    ? models.length
    : Number(health?.models || 0);

  return {
    healthy: Boolean(health?.healthy),
    status: health?.status || (health?.healthy ? 'online' : 'offline'),
    models: count,
    error: health?.healthy ? null : (health?.error || null),
    checkedAt: Date.now(),
  };
}

function normalizeRuntimeState(runtimeState, fallbacks = {}) {
  const queue = runtimeState?.queue || {};
  const hardware = runtimeState?.hardware || {};

  return {
    profile: runtimeState?.profile || fallbacks.profile || 'balanced',
    preferredBackendId: runtimeState?.preferredBackendId || fallbacks.preferredBackend || 'auto',
    currentBackend: runtimeState?.currentBackend || null,
    queue: {
      queued: Number(queue.queued || 0),
      active: Number(queue.active || 0),
      lanes: queue?.lanes && typeof queue.lanes === 'object' ? queue.lanes : {},
    },
    fallbackCounters: runtimeState?.fallbackCounters && typeof runtimeState.fallbackCounters === 'object'
      ? runtimeState.fallbackCounters
      : {},
    recentDecisions: Array.isArray(runtimeState?.recentDecisions) ? runtimeState.recentDecisions.slice(-40) : [],
    lastBackendDecision: runtimeState?.lastBackendDecision || null,
    lastExecutionMode: runtimeState?.lastExecutionMode || null,
    requestedModel: runtimeState?.requestedModel || null,
    effectiveModel: runtimeState?.effectiveModel || null,
    effectiveOptions: runtimeState?.effectiveOptions && typeof runtimeState.effectiveOptions === 'object'
      ? runtimeState.effectiveOptions
      : {},
    lastExperiencePlan: runtimeState?.lastExperiencePlan || null,
    selectedTaskIntent: runtimeState?.selectedTaskIntent || runtimeState?.lastExperiencePlan?.taskIntent || null,
    overrideTrace: Array.isArray(runtimeState?.overrideTrace)
      ? runtimeState.overrideTrace
      : (Array.isArray(runtimeState?.lastExperiencePlan?.overrideTrace) ? runtimeState.lastExperiencePlan.overrideTrace : []),
    clampReasons: Array.isArray(runtimeState?.clampReasons)
      ? runtimeState.clampReasons
      : (Array.isArray(runtimeState?.lastExperiencePlan?.clampReasons) ? runtimeState.lastExperiencePlan.clampReasons : []),
    softBackendPreference: runtimeState?.softBackendPreference || null,
    backendDecisionSource: runtimeState?.backendDecisionSource || runtimeState?.lastBackendDecision?.selectionSource || null,
    modeReasons: Array.isArray(runtimeState?.modeReasons) ? runtimeState.modeReasons : [],
    offloadEvidence: Array.isArray(runtimeState?.offloadEvidence) ? runtimeState.offloadEvidence.slice(-25) : [],
    hardware: {
      gpuCount: Number(hardware?.gpuCount || 0),
      hasNpu: Boolean(hardware?.hasNpu),
      cpu: hardware?.cpu || null,
    },
    deviceUtilization: runtimeState?.deviceUtilization || null,
    timestamp: runtimeState?.timestamp || Date.now(),
  };
}

function normalizeSyntheticHealth(model, runtimeState, npuStatus = null) {
  const backendId = String(runtimeState?.currentBackend?.id || runtimeState?.currentBackend || '').toLowerCase();
  const openvinoActive = backendId.startsWith('openvino');
  const configuredModel = String(npuStatus?.model || npuStatus?.modelPath || '').trim();
  const requestedTarget = getSyntheticModelTarget(model);
  const serverRunning = Boolean(npuStatus?.serverRunning);
  const modelMatches = !requestedTarget || !configuredModel || configuredModel === requestedTarget;
  const healthy = openvinoActive || (serverRunning && modelMatches);

  return {
    healthy,
    status: healthy ? 'online' : 'offline',
    models: requestedTarget ? 1 : 0,
    error: healthy
      ? null
      : (
        npuStatus?.error
        || (!npuStatus?.openvinoInstalled ? 'OpenVINO is not installed' : 'OpenVINO server is not running')
      ),
    checkedAt: Date.now(),
  };
}

export const createModelSlice = (set, get) => {
  const getElectron = () => (typeof window !== 'undefined' ? (window.electronAPI || null) : null);

  const syncLlmRuntime = async (options = {}) => {
    const api = getElectron();
    const {
      requestedModel = undefined,
      refreshModels = true,
      hydrateSelection = false,
      persistResolvedSelection = false,
      updateError = true,
      skipStatus = false,
    } = options;

    if (!skipStatus) {
      set({
        llmBootstrapStatus: 'loading',
        modelStatus: get().currentModel ? 'loading' : get().modelStatus,
      });
    }

    const [
      healthResult,
      modelsResult,
      runtimeStateResult,
      backendsResult,
      profileResult,
      preferredBackendResult,
      ollamaStatusResult,
      savedModelResult,
      npuStatusResult,
    ] = await Promise.allSettled([
      api?.checkLLMHealth?.(),
      refreshModels ? api?.getModels?.() : Promise.resolve(get().availableModels),
      api?.getLlmRuntimeState?.(),
      api?.getBackends?.(),
      api?.getPerformanceProfile?.(),
      api?.getSettings?.('preferredBackend'),
      api?.getOllamaStatus?.(),
      requestedModel === undefined ? api?.getSettings?.('currentModel') : Promise.resolve(requestedModel),
      api?.getNpuStatus?.({ force: false }),
    ]);

    const models = Array.isArray(modelsResult?.value)
      ? modelsResult.value
      : (Array.isArray(get().availableModels) ? get().availableModels : []);
    const health = normalizeHealth(healthResult?.value, models);
    const profile = typeof profileResult?.value === 'string' && profileResult.value
      ? profileResult.value
      : (get().performanceProfile || DEFAULT_LLM_RUNTIME.profile);
    const preferredBackend = typeof preferredBackendResult?.value === 'string' && preferredBackendResult.value
      ? preferredBackendResult.value
      : (get().preferredBackend || DEFAULT_LLM_RUNTIME.preferredBackendId);
    const runtimeState = normalizeRuntimeState(runtimeStateResult?.value, {
      profile,
      preferredBackend,
    });
    const backends = Array.isArray(backendsResult?.value) ? backendsResult.value : [];
    const ollamaStatus = ollamaStatusResult?.status === 'fulfilled'
      ? (ollamaStatusResult.value || null)
      : get().ollamaStatus;
    const npuStatus = npuStatusResult?.status === 'fulfilled'
      ? (npuStatusResult.value || null)
      : null;

    const savedModel = savedModelResult?.status === 'fulfilled'
      ? savedModelResult.value
      : null;
    const desiredModel = requestedModel !== undefined
      ? requestedModel
      : (get().currentModel || savedModel || null);
    const resolvedModel = isSyntheticModel(desiredModel) || isGgufModel(desiredModel)
      ? desiredModel
      : resolveModelName(desiredModel, models);
    const didResolveChange = resolvedModel !== get().currentModel;
    const effectiveHealth = isSyntheticModel(resolvedModel)
      ? normalizeSyntheticHealth(resolvedModel, runtimeState, npuStatus)
      : (isGgufModel(resolvedModel) ? normalizeGgufHealth(resolvedModel, backends) : health);

    if (persistResolvedSelection && api?.setSettings && resolvedModel !== desiredModel) {
      try {
        await api.setSettings('currentModel', resolvedModel || null);
      } catch (error) {
        console.warn('[Model] Failed to persist resolved current model:', error?.message || error);
      }
    }

    const basePatch = {
      availableModels: models,
      currentModel: resolvedModel || null,
      currentModelInfo: didResolveChange ? null : get().currentModelInfo,
      autoTuneResult: didResolveChange ? null : get().autoTuneResult,
      llmHealth: effectiveHealth,
      llmRuntimeState: runtimeState,
      llmBackends: backends,
      preferredBackend: runtimeState.preferredBackendId || preferredBackend || 'auto',
      performanceProfile: runtimeState.profile || profile || 'balanced',
      ollamaStatus: ollamaStatus || null,
      llmBootstrapStatus: effectiveHealth.healthy ? 'ready' : 'error',
      llmLastSyncAt: Date.now(),
      llmError: effectiveHealth.healthy ? null : (effectiveHealth.error || 'LLM backend is not available'),
      modelStatus: resolvedModel && effectiveHealth.healthy ? 'online' : 'offline',
    };

    if (updateError) {
      basePatch.error = effectiveHealth.healthy ? null : (effectiveHealth.error || 'LLM backend is not available');
    }

    set(basePatch);

    if (hydrateSelection && resolvedModel) {
      const hydrated = await get().hydrateModelState(resolvedModel, {
        warmup: options.warmup === true,
        persist: false,
        refreshRuntime: false,
      });
      return {
        ...basePatch,
        model: hydrated?.model || resolvedModel,
        currentModelInfo: hydrated?.info || null,
        autoTuneResult: hydrated?.autoTuneResult || null,
        warmup: hydrated?.warmup || null,
      };
    }

    return {
      ...basePatch,
      model: resolvedModel || null,
    };
  };

  return {
    // State
    currentModel: null,
    availableModels: [],
    modelStatus: 'offline', // 'offline' | 'loading' | 'online' | 'warming'
    isWarmingUp: false,

    // Real metadata from Ollama /api/show (populated on model switch)
    currentModelInfo: null,
    // Auto-tuner recommendation (hardware vs model fit)
    autoTuneResult: null,

    // Unified runtime state for settings, onboarding, and hardware-aware UI
    llmHealth: DEFAULT_LLM_HEALTH,
    llmRuntimeState: DEFAULT_LLM_RUNTIME,
    llmBackends: [],
    preferredBackend: 'auto',
    performanceProfile: 'balanced',
    ollamaStatus: null,
    llmBootstrapStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
    llmLastSyncAt: null,
    llmLastWarmup: null,
    llmError: null,

    // Actions
    resolveModelSelection: async (requestedModel, options = {}) => {
      const shouldRefresh = options.refresh !== false;
      let models = Array.isArray(get().availableModels) ? get().availableModels : [];
      if (isSyntheticModel(requestedModel) || isGgufModel(requestedModel)) {
        return { modelName: requestedModel, models };
      }
      let modelName = resolveModelName(requestedModel, models);

      if ((!modelName || models.length === 0) && shouldRefresh) {
        const result = await get().refreshLlmRuntime({
          requestedModel,
          refreshModels: true,
          hydrateSelection: false,
          persistResolvedSelection: false,
          updateError: false,
        });
        models = Array.isArray(result?.availableModels) ? result.availableModels : models;
        modelName = result?.model || resolveModelName(requestedModel, models);
      }

      return { modelName, models };
    },

    hydrateModelState: async (model, options = {}) => {
      const api = getElectron();
      const {
        warmup = false,
        persist = false,
        refreshRuntime = true,
        forceRefresh = false,
      } = options;
      const syntheticModel = isSyntheticModel(model);
      const ggufModel = isGgufModel(model);

      if (!model) {
        set({
          currentModel: null,
          currentModelInfo: null,
          autoTuneResult: null,
          isWarmingUp: false,
          modelStatus: 'offline',
        });
        return { success: false, error: 'No model selected' };
      }

      set({
        currentModel: model,
        currentModelInfo: null,
        autoTuneResult: null,
        isWarmingUp: false,
        modelStatus: 'loading',
        error: null,
        llmError: null,
      });

      if (persist && api?.setSettings) {
        try {
          await api.setSettings('currentModel', model);
        } catch (error) {
          const message = error?.message || 'Failed to persist selected model';
          set({ modelStatus: 'offline', error: message, llmError: message });
          return { success: false, error: message };
        }
      }

      let info = null;
      let autoTuneResult = null;
      if (syntheticModel) {
        let npuStatus = null;
        try {
          npuStatus = await api?.getNpuStatus?.({ force: false });
        } catch {
          npuStatus = null;
        }
        info = buildSyntheticModelInfo(model, { npuStatus });
      } else if (ggufModel) {
        let backends = [];
        try {
          backends = await api?.getBackends?.();
        } catch {
          backends = [];
        }
        info = buildGgufModelInfo(model, { backends });
      } else {
        const [infoResult, tuneResult] = await Promise.allSettled([
          api?.getModelInfo?.({ name: model, forceRefresh }),
          api?.autoTuneModel?.(model),
        ]);

        info = infoResult?.status === 'fulfilled' && infoResult.value?.success
          ? infoResult.value
          : null;
        autoTuneResult = tuneResult?.status === 'fulfilled' && tuneResult.value?.success && tuneResult.value?.recommendation
          ? tuneResult.value.recommendation
          : null;
      }

      if (info) {
        console.log(`[Model] Metadata for "${model}":`, {
          family: info.family,
          size: info.parameterSize,
          quant: info.quantizationLevel,
          context: info.contextLength,
        });
      }
      if (autoTuneResult) {
        console.log(`[Model] Auto-tuned "${model}":`, autoTuneResult);
      }

      set({
        currentModel: model,
        currentModelInfo: info,
        autoTuneResult,
        modelStatus: 'online',
        error: null,
      });

      let warmupResult = null;
      if (warmup && api?.warmupModel) {
        set({ isWarmingUp: true, modelStatus: 'warming' });
        try {
          console.log(`[Model] Auto-warming up "${model}"...`);
          warmupResult = await api.warmupModel(model);
        } catch (error) {
          warmupResult = { success: false, error: error?.message || String(error) };
          console.warn('[Model] Warmup failed (will load on first use):', error?.message || error);
        } finally {
          set({
            isWarmingUp: false,
            modelStatus: 'online',
            llmLastWarmup: warmupResult,
          });
        }
      } else {
        // Finalize readiness explicitly when warmup is disabled or unavailable.
        set({ modelStatus: 'online' });
      }

      if (refreshRuntime) {
        await get().refreshLlmRuntime({
          requestedModel: model,
          refreshModels: false,
          hydrateSelection: false,
          persistResolvedSelection: false,
          updateError: false,
          skipStatus: true,
        });
      }

      return {
        success: true,
        model,
        info,
        autoTuneResult,
        warmup: warmupResult,
      };
    },

    initializeLlm: async (options = {}) => {
      const requestedModel = options.requestedModel ?? undefined;
      const warmup = options.warmup !== false;
      return get().refreshLlmRuntime({
        requestedModel,
        refreshModels: true,
        hydrateSelection: true,
        persistResolvedSelection: true,
        updateError: options.updateError !== false,
        warmup,
      });
    },

    refreshLlmRuntime: async (options = {}) => {
      try {
        return await syncLlmRuntime(options);
      } catch (error) {
        console.error('Failed to refresh LLM runtime:', error);
        const message = error?.message || 'Failed to connect to Ollama';
        set({
          availableModels: [],
          modelStatus: 'offline',
          llmBootstrapStatus: 'error',
          llmError: message,
          llmHealth: {
            ...DEFAULT_LLM_HEALTH,
            error: message,
            checkedAt: Date.now(),
          },
          error: options.updateError === false ? get().error : message,
        });
        return {
          success: false,
          error: message,
          availableModels: [],
          model: null,
        };
      }
    },

    setModel: async (requestedModel) => {
      const syncResult = await get().refreshLlmRuntime({
        requestedModel,
        refreshModels: true,
        hydrateSelection: false,
        persistResolvedSelection: false,
        updateError: false,
      });
      const model = syncResult?.model || null;

      if (!model) {
        const message = requestedModel
          ? `Selected model "${requestedModel}" is not available in Ollama`
          : 'No model selected';
        set({
          error: message,
          llmError: message,
        });
        return { success: false, error: 'Model not found' };
      }

      const result = await get().hydrateModelState(model, {
        warmup: true,
        persist: true,
        refreshRuntime: true,
      });

      return result?.success === false
        ? result
        : { success: true, model };
    },

    // Manual warmup for explicit GPU preloading
    warmupCurrentModel: async () => {
      const model = get().currentModel;
      const api = getElectron();
      if (!model || !api?.warmupModel) {
        return { success: false, error: 'No model selected or warmup not available' };
      }

      set({ isWarmingUp: true, modelStatus: 'warming' });
      try {
        const result = await api.warmupModel(model);
        set({ llmLastWarmup: result || null });
        await get().refreshLlmRuntime({
          requestedModel: model,
          refreshModels: false,
          hydrateSelection: false,
          persistResolvedSelection: false,
          updateError: false,
          skipStatus: true,
        });
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        set({ isWarmingUp: false, modelStatus: 'online' });
      }
    },

    setPreferredBackend: async (backendId) => {
      const api = getElectron();
      try {
        if (api?.setSettings) {
          await api.setSettings('preferredBackend', backendId);
        }
        const result = await api?.setBackend?.(backendId);
        set({ preferredBackend: backendId });
        await get().refreshLlmRuntime({
          requestedModel: get().currentModel,
          refreshModels: false,
          hydrateSelection: false,
          persistResolvedSelection: false,
          updateError: false,
          skipStatus: true,
        });
        return result || { success: true, backendId };
      } catch (error) {
        const message = error?.message || 'Failed to change backend';
        set({ llmError: message, error: message });
        return { success: false, error: message };
      }
    },

    setPerformanceProfile: async (profile) => {
      const api = getElectron();
      try {
        const result = await api?.setPerformanceProfile?.(profile);
        set({ performanceProfile: profile });
        await get().refreshLlmRuntime({
          requestedModel: get().currentModel,
          refreshModels: false,
          hydrateSelection: false,
          persistResolvedSelection: false,
          updateError: false,
          skipStatus: true,
        });
        return result || { success: true, profile };
      } catch (error) {
        const message = error?.message || 'Failed to change performance profile';
        set({ llmError: message, error: message });
        return { success: false, error: message };
      }
    },

    refreshModels: async () => {
      const previousModel = get().currentModel;
      const result = await get().refreshLlmRuntime({
        requestedModel: get().currentModel,
        refreshModels: true,
        hydrateSelection: false,
        persistResolvedSelection: true,
        updateError: true,
      });
      if (result?.model && result.model !== previousModel) {
        await get().hydrateModelState(result.model, {
          warmup: false,
          persist: false,
          refreshRuntime: false,
        });
      }
      return result;
    },
  };
};
