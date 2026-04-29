import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';

const PRESET_LIMITS = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  top_k: { min: 1, max: 2000 },
  context_length: { min: 256, max: 262144 },
};

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isSyntheticNpuModel(modelName = '') {
  return String(modelName || '').trim().toLowerCase().startsWith('npu:');
}

function formatModelOptionLabel(modelName = '') {
  const raw = String(modelName || '').trim();
  if (!isSyntheticNpuModel(raw)) return raw;
  const target = raw.slice(4).trim();
  const parts = target.split(/[\\/]/).filter(Boolean);
  const displayName = parts[parts.length - 1] || target || 'NPU model';
  return `${displayName} (OpenVINO)`;
}

const ALLOWED_DEVICE_PINS = new Set([
  'ollama-cuda',
  'ollama-cpu',
  'llamanode',
  'openvino-npu',
  'openvino-gpu',
  'openvino-hybrid',
  'llamacpp-vulkan',
]);

const DEVICE_PIN_OPTIONS = [
  { value: '', label: 'Auto (orchestrator picks)' },
  { value: 'ollama-cuda', label: 'NVIDIA GPU (Ollama CUDA)' },
  { value: 'ollama-cpu', label: 'CPU (Ollama)' },
  { value: 'llamanode', label: 'In-process llama.cpp' },
  { value: 'openvino-npu', label: 'Intel NPU (OpenVINO)' },
  { value: 'openvino-gpu', label: 'Intel iGPU (OpenVINO)' },
  { value: 'openvino-hybrid', label: 'Unified Brain (NPU + iGPU)' },
  { value: 'llamacpp-vulkan', label: 'Intel Arc (Vulkan)' },
];

const TASK_INTENT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'chat', label: 'Chat' },
  { value: 'code', label: 'Code' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'creative', label: 'Creative' },
  { value: 'research', label: 'Research' },
];

const KV_CACHE_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'q8_0', label: 'Q8' },
  { value: 'q4_0', label: 'Q4' },
  { value: 'f16', label: 'F16' },
];

function normalizeAdvancedOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

export function ModelPresets() {
  const currentModel = useAppStore((s) => s.currentModel);
  const availableModels = useAppStore((s) => s.availableModels);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const [selectedModel, setSelectedModel] = useState(currentModel || null);
  const [preset, setPreset] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const modelNames = React.useMemo(() => {
    const names = [];
    const push = (value) => {
      const normalized = String(value || '').trim();
      if (normalized && !names.includes(normalized)) {
        names.push(normalized);
      }
    };

    push(currentModel);
    (availableModels || []).forEach((model) => {
      push(typeof model === 'string' ? model : model?.name || model?.model || model?.id);
    });

    return names;
  }, [availableModels, currentModel]);

  useEffect(() => {
    if (!selectedModel && modelNames.length > 0) {
      setSelectedModel(modelNames[0]);
    }
  }, [modelNames, selectedModel]);

  useEffect(() => {
    if (currentModel && currentModel !== selectedModel) {
      setSelectedModel(currentModel);
    }
  }, [currentModel, selectedModel]);

  useEffect(() => {
    const load = async () => {
      if (!selectedModel || !window.electronAPI?.getModelPresets) return;
      setIsLoading(true);
      setError(null);
      try {
        const presets = await window.electronAPI.getModelPresets(
          selectedModel,
          currentWorkspace,
        );
        const active = presets?.find((p) => p.is_default) || presets?.[0] || null;
        setPreset(
          active || {
            model_name: selectedModel,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            context_length: null,
            system_prompt: '',
            task_intent: 'auto',
            advanced_options: {},
          },
        );
      } catch (err) {
        console.error('Failed to load model presets:', err);
        setError(err.message || String(err));
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [selectedModel, currentWorkspace]);

  const handleChange = (field, value) => {
    let normalizedValue = value;
    if (field === 'temperature') {
      normalizedValue = clampNumber(value, PRESET_LIMITS.temperature.min, PRESET_LIMITS.temperature.max, 0.7);
    } else if (field === 'top_p') {
      normalizedValue = clampNumber(value, PRESET_LIMITS.top_p.min, PRESET_LIMITS.top_p.max, 0.9);
    } else if (field === 'top_k') {
      normalizedValue = Math.round(
        clampNumber(value, PRESET_LIMITS.top_k.min, PRESET_LIMITS.top_k.max, 40),
      );
    } else if (field === 'context_length') {
      if (value == null || value === '') {
        normalizedValue = null;
      } else {
        normalizedValue = Math.round(
          clampNumber(value, PRESET_LIMITS.context_length.min, PRESET_LIMITS.context_length.max, 4096),
        );
      }
    } else if (field === 'system_prompt') {
      normalizedValue = String(value || '').slice(0, 8000);
    } else if (field === 'device_pin') {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      normalizedValue = trimmed && ALLOWED_DEVICE_PINS.has(trimmed) ? trimmed : null;
    } else if (field === 'task_intent') {
      const trimmed = typeof value === 'string' ? value.trim() : 'auto';
      normalizedValue = TASK_INTENT_OPTIONS.some((opt) => opt.value === trimmed) ? trimmed : 'auto';
    }

    setPreset((prev) => ({
      ...(prev || {}),
      [field]: normalizedValue,
      model_name: selectedModel,
    }));
  };

  const handleAdvancedChange = (field, value) => {
    let normalizedValue = value;
    if (['num_predict', 'num_batch', 'num_gpu', 'num_thread'].includes(field)) {
      if (value == null || value === '') {
        normalizedValue = null;
      } else {
        const limits = {
          num_predict: { min: 16, max: 8192, fallback: 1024 },
          num_batch: { min: 16, max: 2048, fallback: 128 },
          num_gpu: { min: -1, max: 999, fallback: -1 },
          num_thread: { min: 1, max: 256, fallback: 8 },
        }[field];
        normalizedValue = Math.round(clampNumber(value, limits.min, limits.max, limits.fallback));
      }
    } else if (field === 'repeat_penalty') {
      normalizedValue = value == null || value === ''
        ? null
        : clampNumber(value, 0.8, 2, 1.08);
    } else if (field === 'kv_cache_type') {
      normalizedValue = value || null;
    } else if (field === 'flash_attn') {
      normalizedValue = Boolean(value);
    } else if (field === 'softBackendPreference') {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      normalizedValue = trimmed && ALLOWED_DEVICE_PINS.has(trimmed) ? trimmed : null;
    }

    setPreset((prev) => {
      const advanced = normalizeAdvancedOptions(prev?.advanced_options);
      if (normalizedValue === null || normalizedValue === '') delete advanced[field];
      else advanced[field] = normalizedValue;
      return {
        ...(prev || {}),
        advanced_options: advanced,
        model_name: selectedModel,
      };
    });
  };

  const handleSave = async () => {
    if (!preset || !selectedModel || !window.electronAPI?.saveModelPreset) return;
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        ...preset,
        model_name: selectedModel,
        workspace: currentWorkspace,
        is_default: true,
      };
      const res = await window.electronAPI.saveModelPreset(payload);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save preset');
      }
      setPreset((prev) => ({ ...(prev || {}), id: res.id || prev?.id }));
    } catch (err) {
      console.error('Failed to save model preset:', err);
      setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    if (!preset?.id || !window.electronAPI?.deleteModelPreset) {
      setPreset(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.deleteModelPreset(preset.id);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to delete preset');
      }
      setPreset(null);
    } catch (err) {
      console.error('Failed to delete model preset:', err);
      setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!modelNames.length) {
    return null;
  }

  const canEdit = !!selectedModel;
  const advancedOptions = normalizeAdvancedOptions(preset?.advanced_options);

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Model Presets</h3>
        <span className="text-[11px] text-text-muted">
          Configure sampling for each model and workspace.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-text-secondary">Model</label>
        <select
          value={selectedModel || ''}
          onChange={(e) => setSelectedModel(e.target.value || null)}
          className="input text-xs max-w-xs"
        >
          {modelNames.map((name) => (
            <option key={name} value={name}>
              {formatModelOptionLabel(name)}
            </option>
          ))}
        </select>
      </div>

      {canEdit && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Temperature ({preset?.temperature?.toFixed(2) ?? 0.7})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={preset?.temperature ?? 0.7}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Top P ({preset?.top_p?.toFixed(2) ?? 0.9})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={preset?.top_p ?? 0.9}
              onChange={(e) => handleChange('top_p', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Top K ({preset?.top_k ?? 40})
            </label>
            <input
              type="number"
              min="1"
              max="200"
              value={preset?.top_k ?? 40}
              onChange={(e) => handleChange('top_k', parseInt(e.target.value || '40', 10))}
              className="input text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Context length (tokens)
            </label>
            <input
              type="number"
              min="0"
              step="256"
              value={preset?.context_length ?? ''}
              onChange={(e) =>
                handleChange(
                  'context_length',
                  e.target.value ? parseInt(e.target.value, 10) : null,
                )
              }
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-text-secondary mb-1">
          System prompt override
        </label>
        <textarea
          rows={3}
          value={preset?.system_prompt || ''}
          onChange={(e) => handleChange('system_prompt', e.target.value)}
          className="input text-xs resize-none h-20"
          placeholder="Optional override for the default workspace system prompt."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">
            Task intent
          </label>
          <select
            value={preset?.task_intent || 'auto'}
            onChange={(e) => handleChange('task_intent', e.target.value)}
            className="input text-xs"
          >
            {TASK_INTENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">
            Soft backend preference
          </label>
          <select
            value={advancedOptions.softBackendPreference || ''}
            onChange={(e) => handleAdvancedChange('softBackendPreference', e.target.value)}
            className="input text-xs"
          >
            {DEVICE_PIN_OPTIONS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-forge-border bg-forge-bg/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-medium text-text-primary">Advanced saved controls</h4>
          <button
            type="button"
            className="text-[10px] text-text-muted hover:text-text-primary"
            onClick={() => handleChange('advanced_options', {})}
          >
            Reset advanced
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Repeat penalty</label>
            <input
              type="number"
              min="0.8"
              max="2"
              step="0.01"
              value={advancedOptions.repeat_penalty ?? ''}
              onChange={(e) => handleAdvancedChange('repeat_penalty', e.target.value)}
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Max output tokens</label>
            <input
              type="number"
              min="16"
              step="64"
              value={advancedOptions.num_predict ?? ''}
              onChange={(e) => handleAdvancedChange('num_predict', e.target.value)}
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Batch size</label>
            <input
              type="number"
              min="16"
              step="16"
              value={advancedOptions.num_batch ?? ''}
              onChange={(e) => handleAdvancedChange('num_batch', e.target.value)}
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">GPU layers</label>
            <input
              type="number"
              min="-1"
              step="1"
              value={advancedOptions.num_gpu ?? ''}
              onChange={(e) => handleAdvancedChange('num_gpu', e.target.value)}
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">CPU threads</label>
            <input
              type="number"
              min="1"
              step="1"
              value={advancedOptions.num_thread ?? ''}
              onChange={(e) => handleAdvancedChange('num_thread', e.target.value)}
              className="input text-xs"
              placeholder="Auto"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">KV cache</label>
            <select
              value={advancedOptions.kv_cache_type || ''}
              onChange={(e) => handleAdvancedChange('kv_cache_type', e.target.value)}
              className="input text-xs"
            >
              {KV_CACHE_OPTIONS.map((opt) => (
                <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <label className="col-span-2 inline-flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={advancedOptions.flash_attn === true}
              onChange={(e) => handleAdvancedChange('flash_attn', e.target.checked)}
            />
            Request flash attention when the backend supports it
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">
          Device pin (per-model backend)
        </label>
        <select
          value={preset?.device_pin || ''}
          onChange={(e) => handleChange('device_pin', e.target.value)}
          className="input text-xs"
        >
          {DEVICE_PIN_OPTIONS.map((opt) => (
            <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-text-muted">
          Forces this model to a specific backend. Per-chat overrides in the chat composer still win for the current conversation.
        </p>
      </div>

      {error && (
        <div className="text-xs text-status-error bg-status-error/10 border border-status-error/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleClear}
          disabled={isLoading}
          className="btn btn-secondary text-xs"
        >
          Clear preset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading || !canEdit}
          className="btn btn-primary text-xs"
        >
          {isLoading ? 'Saving…' : 'Save preset'}
        </button>
      </div>
    </div>
  );
}

export default ModelPresets;
