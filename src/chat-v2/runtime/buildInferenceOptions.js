import { buildOptimizedOllamaOptionsWithInfo } from '../../core/modelResolver';
import { useAdaptiveGeneration } from '../../services/adaptiveGeneration';
import { useAppStore } from '../../stores/appStore';
import { useChatV2SessionStore } from '../../stores/chatV2SessionStore';
import { api } from '../../utils/electronAPI';
import { clampInferenceOptionsToModel } from './inferenceOptionsUtil';
import { mergePresetSystemPrompt } from './mergePresetSystemPrompt.js';

let _vaultProfileCache = { at: 0, value: null };
async function loadVaultProfile() {
  const now = Date.now();
  if (now - _vaultProfileCache.at < 30_000 && _vaultProfileCache.value !== null) {
    return _vaultProfileCache.value;
  }
  try {
    const res = await api.vaultGetProfile?.();
    const profile = res?.success ? res.profile : null;
    _vaultProfileCache = { at: now, value: profile };
    return profile;
  } catch (_) {
    _vaultProfileCache = { at: now, value: null };
    return null;
  }
}

function mergeVaultOverrides(options, profile) {
  if (!profile || !profile.inference_overrides) return options;
  const merged = { ...options };
  const overrides = profile.inference_overrides;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    merged[key] = value;
  }
  const corruption = profile.corruption || {};
  if (Number.isFinite(Number(corruption.escalation_rate))) {
    const bump = Math.min(0.2, Number(corruption.escalation_rate) * 0.05);
    if (Number.isFinite(Number(merged.temperature))) {
      merged.temperature = Math.min(2.0, Number(merged.temperature) + bump);
    }
  }
  if (Number.isFinite(Number(corruption.memory_bleed)) && Number.isFinite(Number(merged.num_ctx))) {
    const factor = 1 + Number(corruption.memory_bleed) * 0.5;
    merged.num_ctx = Math.floor(Number(merged.num_ctx) * factor);
  }
  return merged;
}

function resolveWorkspaceType(workspace) {
  const value = String(workspace || 'casual').trim().toLowerCase();
  if (value === 'code') return 'code';
  if (value === 'work') return 'work';
  if (value === 'creative') return 'creative';
  return 'casual';
}

function applyAutoTune(options, autoTuneResult) {
  const tuned = { ...options };
  if (!autoTuneResult || typeof autoTuneResult !== 'object') return tuned;

  if (Number.isFinite(Number(autoTuneResult.contextLength)) && autoTuneResult.contextLength > 0) {
    tuned.num_ctx = Math.min(Number(tuned.num_ctx || autoTuneResult.contextLength), Number(autoTuneResult.contextLength));
  }

  if (Number.isFinite(Number(autoTuneResult.batchSize)) && autoTuneResult.batchSize > 0) {
    tuned.num_batch = Number(autoTuneResult.batchSize);
  }

  if (typeof autoTuneResult.gpuLayers === 'number' && Number.isFinite(autoTuneResult.gpuLayers)) {
    tuned.num_gpu = autoTuneResult.gpuLayers;
  } else if (typeof autoTuneResult.gpuLayers === 'string') {
    const mode = autoTuneResult.gpuLayers.toLowerCase();
    // Ollama semantics: num_gpu = -1 => offload ALL layers to GPU; positive N =>
    // offload that many layers; 0 => CPU only.
    if (mode === 'all' || mode === 'most') tuned.num_gpu = -1;
    if (mode === 'partial') tuned.num_gpu = Math.max(8, Math.round((Number(tuned.num_ctx) || 4096) / 1024));
  }

  if (autoTuneResult.kvCachePrecision) {
    tuned.kv_cache_type = autoTuneResult.kvCachePrecision;
  }

  if (autoTuneResult.flashAttention) {
    tuned.flash_attn = true;
  }

  return tuned;
}

function applyAdaptive(options, adaptive) {
  const next = { ...options };
  if (!adaptive || typeof adaptive !== 'object') return next;

  if (Number.isFinite(Number(adaptive.num_ctx)) && adaptive.num_ctx > 0) {
    next.num_ctx = Math.min(Number(next.num_ctx || adaptive.num_ctx), Number(adaptive.num_ctx));
  }
  if (Number.isFinite(Number(adaptive.num_batch)) && adaptive.num_batch > 0) {
    next.num_batch = Math.min(Number(next.num_batch || adaptive.num_batch), Number(adaptive.num_batch));
  }
  // num_gpu: -1 means "offload all layers" (Ollama convention). Preserve it
  // intact; otherwise coerce to a finite integer.
  if (adaptive.num_gpu === -1) {
    next.num_gpu = -1;
  } else if (Number.isFinite(Number(adaptive.num_gpu))) {
    next.num_gpu = Number(adaptive.num_gpu);
  }
  if (Number.isFinite(Number(adaptive.num_thread)) && adaptive.num_thread > 0) {
    next.num_thread = Number(adaptive.num_thread);
  }
  if (adaptive.flash_attn) {
    next.flash_attn = true;
  }
  if (adaptive.kv_cache_type) {
    next.kv_cache_type = adaptive.kv_cache_type;
  }
  if (Number.isFinite(Number(adaptive.num_predict)) && adaptive.num_predict > 0) {
    next.num_predict = Number(adaptive.num_predict);
  }

  return next;
}

function applyPresetOverrides(options, activePreset) {
  if (!activePreset) return options;
  let next = { ...options };
  if (Number.isFinite(Number(activePreset.temperature))) next.temperature = Number(activePreset.temperature);
  if (Number.isFinite(Number(activePreset.top_p))) next.top_p = Number(activePreset.top_p);
  if (Number.isFinite(Number(activePreset.top_k))) next.top_k = Number(activePreset.top_k);
  if (Number.isFinite(Number(activePreset.context_length)) && activePreset.context_length > 0) {
    next.num_ctx = Number(activePreset.context_length);
  }
  next = mergePresetSystemPrompt(next, activePreset);
  const presetDevicePin = String(activePreset?.device_pin ?? '').trim();
  if (presetDevicePin) {
    next.forceBackend = presetDevicePin;
  }
  return next;
}

function applyUserContextOverride(options, sessionState = {}) {
  const next = { ...options };
  const userCtxPick = sessionState.contextLengthTokens;
  const hasUserContextOverride = Number.isFinite(Number(userCtxPick)) && Number(userCtxPick) > 0;
  if (hasUserContextOverride) {
    next.num_ctx = Math.floor(Number(userCtxPick));
  }
  return { options: next, hasUserContextOverride };
}

function applySessionBackendOverride(options, sessionState = {}) {
  const sessionBackendOverride = String(sessionState.backendOverride || '').trim();
  if (sessionBackendOverride) {
    options.forceBackend = sessionBackendOverride;
  }
  return { ...options };
}

function applyFastChatClamp(options, {
  workspaceType,
  hasExplicitPreset,
  hasUserContextOverride,
  fastChatEnabled,
} = {}) {
  const next = { ...options };
  if (fastChatEnabled && workspaceType === 'casual' && !hasExplicitPreset && !hasUserContextOverride) {
    if (Number.isFinite(Number(next.num_ctx))) {
      next.num_ctx = Math.min(Number(next.num_ctx), 4096);
    }
    if (Number.isFinite(Number(next.num_predict))) {
      next.num_predict = Math.min(Number(next.num_predict), 768);
    }
    if (Number.isFinite(Number(next.num_batch))) {
      next.num_batch = Math.min(Number(next.num_batch), 96);
    }
  }
  return next;
}

async function applyVaultOverrides(options, workspaceId) {
  if (String(workspaceId).toLowerCase() !== 'nsfw') return options;
  try {
    const profile = await loadVaultProfile();
    return mergeVaultOverrides(options, profile);
  } catch (_) {
    return options;
  }
}

function restoreNonClampedOptions(clamped, options) {
  const systemPrompt = String(options?.systemPrompt ?? '').trim();
  const forceBackend = String(options?.forceBackend ?? '').trim();
  const softBackendPreference = String(options?.softBackendPreference ?? '').trim();
  let result = clamped;
  if (systemPrompt) result = { ...result, systemPrompt };
  if (forceBackend) result = { ...result, forceBackend };
  if (softBackendPreference) result = { ...result, softBackendPreference };
  if (options?.experiencePlan && typeof options.experiencePlan === 'object') {
    result = {
      ...result,
      experiencePlan: {
        ...options.experiencePlan,
        effectiveOptions: clamped,
        summary: {
          ...(options.experiencePlan.summary || {}),
          context: clamped?.num_ctx || options.experiencePlan.summary?.context || null,
        },
      },
    };
  }
  return result;
}

function buildSessionPayload(sessionState = {}) {
  return {
    contextLengthTokens: sessionState.contextLengthTokens ?? null,
    backendOverride: sessionState.backendOverride || null,
    tuningMode: sessionState.tuningMode || 'auto',
    taskIntent: sessionState.taskIntent || 'auto',
    advancedOverrides: sessionState.advancedOverrides || {},
  };
}

async function resolveAutopilotOptions({
  appState,
  modelName,
  workspaceId,
  prompt = '',
  controls = {},
} = {}) {
  if (typeof api.resolveModelExperiencePlan !== 'function') return null;

  const sessionState = useChatV2SessionStore.getState();
  let lastKnownGood = null;
  try {
    if (typeof api.getLastKnownGoodModelLoad === 'function') {
      lastKnownGood = await api.getLastKnownGoodModelLoad({
        model: modelName,
        workspace: workspaceId,
      });
    }
  } catch (_) {
    lastKnownGood = null;
  }
  const result = await api.resolveModelExperiencePlan({
    model: modelName,
    workspace: workspaceId,
    prompt,
    modelInfo: appState.currentModelInfo || null,
    autoTuneResult: appState.autoTuneResult || null,
    performanceProfile: appState.performanceProfile || 'balanced',
    session: buildSessionPayload(sessionState),
    lastKnownGood,
    controls: {
      ...(controls && typeof controls === 'object' ? controls : {}),
      fastChatMode: Boolean(appState.fastChatMode),
    },
  });

  if (!result?.success || !result?.plan?.effectiveOptions) return null;
  const plan = result.plan;
  let options = { ...(plan.effectiveOptions || {}) };
  options = await applyVaultOverrides(options, workspaceId);
  const clamped = clampInferenceOptionsToModel(options, {
    modelInfo: appState.currentModelInfo || null,
    autoTuneResult: appState.autoTuneResult || null,
    fallback: 8192,
  }).options;

  return restoreNonClampedOptions(clamped, {
    systemPrompt: plan.systemPrompt || '',
    forceBackend: plan.explicitBackendPin || '',
    softBackendPreference: plan.softBackendPreference || '',
    experiencePlan: {
      ...plan,
      effectiveOptions: clamped,
      warnings: Array.isArray(result.warnings) ? result.warnings : plan.warnings || [],
      reasons: Array.isArray(result.reasons) ? result.reasons : plan.reasons || [],
    },
  });
}

export async function buildChatV2InferenceOptions({ model, workspace, prompt = '', controls = {} } = {}) {
  const appState = useAppStore.getState();
  const modelName = String(model || appState.currentModel || '').trim();
  if (!modelName) return {};

  const workspaceId = String(workspace || appState.currentWorkspace || 'casual').trim();
  const workspaceType = resolveWorkspaceType(workspaceId);
  let hasExplicitPreset = false;

  try {
    const autopilotOptions = await resolveAutopilotOptions({
      appState,
      modelName,
      workspaceId,
      prompt,
      controls,
    });
    if (autopilotOptions) return autopilotOptions;
  } catch (err) {
    console.warn('[ChatV2] Model Experience Autopilot failed; using legacy optimizer:', err?.message);
  }

  let options;
  try {
    options = buildOptimizedOllamaOptionsWithInfo(
      modelName,
      workspaceType,
      appState.currentModelInfo || null
    );
  } catch (err) {
    console.warn('[ChatV2] buildOptimizedOllamaOptionsWithInfo failed:', err?.message);
    options = { temperature: 0.7, num_ctx: 4096, num_predict: 2048 };
  }

  options = applyAutoTune(options, appState.autoTuneResult || null);

  try {
    const adaptiveOptions = await useAdaptiveGeneration.getState().buildOllamaOptions();
    options = applyAdaptive(options, adaptiveOptions);
  } catch (_) {
    // Non-blocking: defaults still work.
  }

  try {
    const presets = await api.getModelPresets(modelName, workspaceId);
    const activePreset = Array.isArray(presets) ? (presets.find((p) => p?.is_default) || presets[0]) : null;
    if (activePreset) {
      hasExplicitPreset = true;
      options = applyPresetOverrides(options, activePreset);
    }
  } catch (_) {
    // Non-blocking.
  }

  const sessionState = useChatV2SessionStore.getState();
  const userContextResult = applyUserContextOverride(options, sessionState);
  options = applySessionBackendOverride(userContextResult.options, sessionState);
  const hasUserContextOverride = userContextResult.hasUserContextOverride;

  // Fast chat mode (opt-in) caps casual workspace to snappy defaults for
  // lowest first-token latency. Off by default so long context works out of
  // the box; users who want LM-Studio-style snappy casual chat toggle it on
  // in Settings. Explicit user presets always win regardless of this flag.
  const fastChatEnabled = Boolean(appState.fastChatMode);
  options = applyFastChatClamp(options, {
    workspaceType,
    hasExplicitPreset,
    hasUserContextOverride,
    fastChatEnabled,
  });

  // Vault workspace: apply Abyssal Devourer profile overrides on top of
  // optimizer/preset choices. The profile is persisted in scripts/openvino-model.json
  // and edited via the Vault Safety settings.
  options = await applyVaultOverrides(options, workspaceId);

  const clamped = clampInferenceOptionsToModel(options, {
    modelInfo: appState.currentModelInfo || null,
    autoTuneResult: appState.autoTuneResult || null,
    fallback: 8192,
  }).options;
  return restoreNonClampedOptions(clamped, options);
}
