import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';

export function ModelPresets() {
  const { currentModel, availableModels, currentWorkspace } = useAppStore();
  const [selectedModel, setSelectedModel] = useState(currentModel || null);
  const [preset, setPreset] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const modelNames =
    availableModels?.map((m) =>
      typeof m === 'string' ? m : m.name || m.model || m.id,
    ) || [];

  useEffect(() => {
    if (!selectedModel && modelNames.length > 0) {
      setSelectedModel(modelNames[0]);
    }
  }, [modelNames, selectedModel]);

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
    setPreset((prev) => ({
      ...(prev || {}),
      [field]: value,
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
              {name}
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


