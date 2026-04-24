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
    }

    setPreset((prev) => ({
      ...(prev || {}),
      [field]: normalizedValue,
      model_name: selectedModel,
    }));
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
