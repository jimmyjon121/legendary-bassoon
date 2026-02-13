import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  HardDrive,
  Cpu,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  Box,
  Loader,
  Wand2,
  Gauge,
  Download,
  Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ModelBrowser } from './ModelBrowser';

// Format icons
const FORMAT_ICONS = {
  gguf: Box,
  onnx: FileText,
  openvino: Zap,
  safetensors: FileText,
  bin: HardDrive
};

// Format colors
const FORMAT_COLORS = {
  gguf: 'bg-green-500/20 text-green-400 border-green-500/30',
  onnx: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  openvino: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  safetensors: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  bin: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
};

const CONVERSION_PRESETS = [
  {
    id: 'gguf-q4',
    label: 'GGUF (Q4_K_M)',
    description: 'Best balance for GPUs & NPUs',
    targetFormat: 'gguf',
    options: { quantization: 'q4_k_m' }
  },
  {
    id: 'gguf-q8',
    label: 'GGUF (Q8_0)',
    description: 'Higher quality, more VRAM',
    targetFormat: 'gguf',
    options: { quantization: 'q8_0' }
  },
  {
    id: 'openvino',
    label: 'OpenVINO IR',
    description: 'Prepare for Intel NPU acceleration',
    targetFormat: 'openvino',
    options: {}
  }
];

function ModelCard({ model, onSelect, onDelete, isSelected }) {
  const [showDetails, setShowDetails] = useState(false);
  const FormatIcon = FORMAT_ICONS[model.format] || FileText;
  const formatColor = FORMAT_COLORS[model.format] || FORMAT_COLORS.bin;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`
        p-4 rounded-lg border transition-all cursor-pointer
        ${isSelected 
          ? 'bg-workspace-casual/20 border-workspace-casual/50' 
          : 'bg-forge-bg border-forge-border hover:border-forge-hover'
        }
      `}
      onClick={() => onSelect?.(model)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg border ${formatColor}`}>
            <FormatIcon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-text-primary truncate" title={model.name}>
              {model.name}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`px-2 py-0.5 text-xs rounded border ${formatColor}`}>
                {model.formatName}
              </span>
              {model.quantization && (
                <span className="px-2 py-0.5 text-xs bg-forge-elevated text-text-muted rounded">
                  {model.quantization}
                </span>
              )}
              {model.parameters && (
                <span className="px-2 py-0.5 text-xs bg-forge-elevated text-text-muted rounded">
                  {model.parameters}B
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDetails(!showDetails);
            }}
            className="p-1 text-text-muted hover:text-text-secondary"
          >
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(model);
            }}
            className="p-1 text-text-muted hover:text-status-error"
            title="Delete model"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Details panel */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-forge-border text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-text-muted">Size:</span>
                <span className="text-text-secondary">{model.sizeFormatted}</span>
              </div>
              {model.estimatedVram && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Est. VRAM:</span>
                  <span className="text-text-secondary">{model.estimatedVram.formatted}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-muted">Backends:</span>
                <span className="text-text-secondary">{model.backends?.join(', ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Path:</span>
                <span className="text-text-secondary truncate max-w-[200px]" title={model.path}>
                  {model.filename}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ModelLibrary({ onSelectModel, onClose }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFormat, setFilterFormat] = useState('all');
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelsDirectory, setModelsDirectory] = useState('');
  const [stats, setStats] = useState(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showConvertPanel, setShowConvertPanel] = useState(false);
  const [convertingPreset, setConvertingPreset] = useState(null);
  const [conversionMessage, setConversionMessage] = useState(null);
  const [conversionError, setConversionError] = useState(null);
  const [autoTuneResult, setAutoTuneResult] = useState(null);
  const [autoTuneError, setAutoTuneError] = useState(null);
  const [autoTuneLoading, setAutoTuneLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState(null);
  const [benchmarkError, setBenchmarkError] = useState(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  // Load models on mount
  useEffect(() => {
    loadModels();
    loadDirectory();
  }, []);

  useEffect(() => {
    setShowConvertPanel(false);
    setConvertingPreset(null);
    setConversionMessage(null);
    setConversionError(null);
    setAutoTuneResult(null);
    setAutoTuneError(null);
    setAutoTuneLoading(false);
    setBenchmarkResult(null);
    setBenchmarkError(null);
    setBenchmarkLoading(false);
  }, [selectedModel?.id]);

  const loadDirectory = async () => {
    try {
      const dir = await window.electronAPI?.getSettings('modelsDirectory');
      setModelsDirectory(dir || '');
    } catch (error) {
      console.error('Failed to load models directory:', error);
    }
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // First try to get models from Ollama
      const ollamaModels = await window.electronAPI?.getModels();
      
      // Then scan local directory if configured
      const localModels = await window.electronAPI?.scanModels?.() || { models: [] };
      
      // Combine and format
      const allModels = [
        ...(ollamaModels || []).map(m => ({
          id: `ollama-${m.name}`,
          name: m.name,
          format: 'gguf',
          formatName: 'Ollama',
          size: m.size,
          sizeFormatted: formatBytes(m.size),
          backends: ['ollama'],
          source: 'ollama',
          modified: m.modified_at
        })),
        ...(localModels.models || [])
      ];

      setModels(allModels);
      setStats({
        total: allModels.length,
        ollama: ollamaModels?.length || 0,
        local: localModels.models?.length || 0
      });
    } catch (error) {
      console.error('Failed to load models:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    if (!modelsDirectory) {
      setError('Please configure a models directory first');
      return;
    }
    
    setScanning(true);
    try {
      await window.electronAPI?.scanModels?.(modelsDirectory);
      await loadModels();
    } catch (error) {
      setError(error.message);
    } finally {
      setScanning(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const folder = await window.electronAPI?.selectFolder();
      if (folder) {
        setModelsDirectory(folder);
        await window.electronAPI?.setSettings('modelsDirectory', folder);
        handleScan();
      }
    } catch (error) {
      setError(error.message);
    }
  };

  const handleDelete = async (model) => {
    if (model.source === 'ollama') {
      // Can't delete Ollama models from here
      return;
    }
    
    if (confirm(`Delete ${model.name}? This cannot be undone.`)) {
      try {
        await window.electronAPI?.deleteModel?.(model.id);
        await loadModels();
      } catch (error) {
        setError(error.message);
      }
    }
  };

  const handleSelect = (model) => {
    setSelectedModel(model);
    onSelectModel?.(model);
  };

  const handleConvertPreset = async (preset) => {
    if (!selectedModel?.path) {
      setConversionError('Conversion is only available for local files with a known path.');
      return;
    }
    if (!window.electronAPI?.convertModel) {
      setConversionError('Conversion service not available in this build.');
      return;
    }
    setConvertingPreset(preset.id);
    setConversionError(null);
    setConversionMessage(null);
    try {
      const res = await window.electronAPI.convertModel({
        sourcePath: selectedModel.path,
        targetFormat: preset.targetFormat,
        options: preset.options,
      });
      if (!res?.success) {
        throw new Error(res?.error || 'Conversion failed');
      }
      const suffix = res?.outputPath ? ` Saved to ${res.outputPath}` : '';
      setConversionMessage(`${res.message || 'Conversion complete.'}${suffix}`);
      await loadModels();
    } catch (error) {
      setConversionError(error.message);
    } finally {
      setConvertingPreset(null);
    }
  };

  const handleAutoTune = async () => {
    if (!selectedModel?.path) {
      setAutoTuneError('Auto-tune is only available for local models with a known file path.');
      return;
    }
    if (!window.electronAPI?.autoTuneModel) {
      setAutoTuneError('Auto-tune service not available in this build.');
      return;
    }
    setAutoTuneLoading(true);
    setAutoTuneError(null);
    try {
      const res = await window.electronAPI.autoTuneModel(selectedModel.path);
      if (res?.error) {
        throw new Error(res.error);
      }
      setAutoTuneResult(res);
    } catch (error) {
      setAutoTuneError(error.message);
    } finally {
      setAutoTuneLoading(false);
    }
  };

  const handleBenchmark = async () => {
    if (!selectedModel) return;
    if (!window.electronAPI?.sendToLLM) {
      setBenchmarkError('Benchmarking is only available in the desktop app.');
      return;
    }
    // For now, only benchmark Ollama-tagged models
    if (selectedModel.source && selectedModel.source !== 'ollama') {
      setBenchmarkError('Benchmarking currently supports Ollama models only.');
      return;
    }

    setBenchmarkLoading(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);

    try {
      const modelName = selectedModel.name;
      const start = performance.now();
      const response = await window.electronAPI.sendToLLM({
        model: modelName,
        messages: [{ role: 'user', content: 'Benchmark request: respond with a single short word, e.g. "OK". Do not explain, only reply with that word.' }],
        system: '',
        options: {
          temperature: 0,
          top_p: 1,
        },
      });
      const end = performance.now();
      const ms = Math.round(end - start);
      const text =
        typeof response === 'string'
          ? response
          : response?.response || response?.output || '';
      const tokens = text ? Math.max(1, Math.round(text.length / 4)) : 0;
      setBenchmarkResult({
        latencyMs: ms,
        tokens,
        model: modelName,
      });
    } catch (error) {
      console.error('Model benchmark failed:', error);
      setBenchmarkError(error.message || String(error));
    } finally {
      setBenchmarkLoading(false);
    }
  };

  // Filter models
  const filteredModels = models.filter(model => {
    const matchesSearch = !searchQuery || 
      model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      model.filename?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFormat = filterFormat === 'all' || model.format === filterFormat;
    
    return matchesSearch && matchesFormat;
  });

  // Get unique formats for filter
  const formats = [...new Set(models.map(m => m.format))];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-forge-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Model Library</h2>
          <p className="text-xs text-text-muted">
            {stats?.total || 0} models ({stats?.ollama || 0} Ollama, {stats?.local || 0} local)
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="p-4 space-y-3 border-b border-forge-border">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models..."
            className="input pl-9 w-full"
          />
        </div>

        {/* Filters and actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterFormat}
            onChange={(e) => setFilterFormat(e.target.value)}
            className="input py-1.5 text-sm"
          >
            <option value="all">All Formats</option>
            {formats.map(format => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="btn btn-secondary py-1.5"
          >
            {scanning ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Scan
          </button>

          <button
            onClick={handleSelectDirectory}
            className="btn btn-secondary py-1.5"
          >
            <FolderOpen size={14} />
            Set Folder
          </button>

          <button
            type="button"
            onClick={() => setShowBrowser(true)}
            className="btn btn-primary py-1.5 ml-auto"
          >
            <Download size={14} />
            Browse Remote Models
          </button>
        </div>

        {/* Current directory */}
        {modelsDirectory && (
          <div className="text-xs text-text-muted truncate">
            📁 {modelsDirectory}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-status-error/20 border border-status-error/30 rounded-lg text-sm text-status-error">
          {error}
        </div>
      )}

      {/* Models list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={24} className="animate-spin text-workspace-casual" />
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-12">
            <Box size={48} className="mx-auto text-text-muted mb-4" />
            <p className="text-text-secondary mb-2">No models found</p>
            <p className="text-xs text-text-muted">
              {searchQuery 
                ? 'Try a different search term'
                : 'Add models to your library or pull from Ollama'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filteredModels.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isSelected={selectedModel?.id === model.id}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer with selected model */}
      {selectedModel && (
        <div className="p-4 border-t border-forge-border bg-forge-bg space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-text-primary font-medium truncate">{selectedModel.name}</p>
              <p className="text-xs text-text-muted">
                {selectedModel.formatName} • {selectedModel.sizeFormatted}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedModel.source !== 'ollama' && selectedModel.path && (
                <button
                  type="button"
                  onClick={handleAutoTune}
                  className="btn btn-secondary text-xs"
                  disabled={autoTuneLoading}
                >
                  {autoTuneLoading ? (
                    <>
                      <Loader size={12} className="animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Gauge size={14} />
                      Auto‑Tune
                    </>
                  )}
                </button>
              )}
              {selectedModel.source !== 'ollama' && selectedModel.path && (
                <button
                  type="button"
                  onClick={() => setShowConvertPanel(!showConvertPanel)}
                  className="btn btn-secondary text-xs"
                >
                  <Wand2 size={14} />
                  Convert
                </button>
              )}
              {selectedModel.source === 'ollama' && (
                <button
                  type="button"
                  onClick={handleBenchmark}
                  className="btn btn-secondary text-xs"
                  disabled={benchmarkLoading}
                >
                  {benchmarkLoading ? (
                    <>
                      <Loader size={12} className="animate-spin" />
                      Benchmarking…
                    </>
                  ) : (
                    <>
                      <Activity size={14} />
                      Benchmark
                    </>
                  )}
                </button>
              )}
              <button onClick={() => onSelectModel?.(selectedModel)} className="btn btn-primary">
                Use Model
              </button>
            </div>
          </div>

          {autoTuneResult && (
            <div className="p-3 rounded-lg bg-forge-bg border border-forge-border space-y-1 text-[11px]">
              <div className="flex items-center gap-2 mb-1">
                <Gauge size={12} className="text-workspace-casual" />
                <span className="text-text-secondary font-medium">Recommended settings</span>
              </div>
              <p className="text-text-muted">
                Backend:{' '}
                <span className="text-text-secondary font-medium">
                  {autoTuneResult.backend || 'unknown'}
                </span>{' '}
                on{' '}
                <span className="text-text-secondary">
                  {autoTuneResult.device || 'hardware'}
                </span>
              </p>
              <p className="text-text-muted">
                Context:{' '}
                <span className="text-text-secondary">
                  {autoTuneResult.contextLength || '—'} tokens
                </span>{' '}
                • Threads:{' '}
                <span className="text-text-secondary">
                  {autoTuneResult.threads || '—'}
                </span>{' '}
                • Batch:{' '}
                <span className="text-text-secondary">
                  {autoTuneResult.batchSize || '—'}
                </span>
              </p>
              {autoTuneResult.model?.estimatedVramFormatted && (
                <p className="text-text-muted">
                  Est. VRAM for weights:{' '}
                  <span className="text-text-secondary">
                    {autoTuneResult.model.estimatedVramFormatted}
                  </span>
                </p>
              )}
              {Array.isArray(autoTuneResult.notes) && autoTuneResult.notes.length > 0 && (
                <ul className="mt-1 list-disc list-inside text-text-muted space-y-0.5">
                  {autoTuneResult.notes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {autoTuneError && (
            <div className="p-2 rounded bg-status-error/10 border border-status-error/30 text-[11px] text-status-error">
              {autoTuneError}
            </div>
          )}

          {benchmarkResult && (
            <div className="p-3 rounded-lg bg-forge-bg border border-forge-border space-y-1 text-[11px]">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={12} className="text-workspace-casual" />
                <span className="text-text-secondary font-medium">Last benchmark</span>
              </div>
              <p className="text-text-muted">
                Latency:{' '}
                <span className="text-text-secondary">
                  {benchmarkResult.latencyMs} ms
                </span>{' '}
                • Approx. tokens:{' '}
                <span className="text-text-secondary">
                  {benchmarkResult.tokens}
                </span>
              </p>
            </div>
          )}
          {benchmarkError && (
            <div className="p-2 rounded bg-status-error/10 border border-status-error/30 text-[11px] text-status-error">
              {benchmarkError}
            </div>
          )}

          {selectedModel.source !== 'ollama' && selectedModel.path && showConvertPanel && (
            <div className="p-3 border border-dashed border-forge-border rounded-lg space-y-2">
              <p className="text-[11px] text-text-muted">
                Create alternate versions for different hardware profiles:
              </p>
              <div className="flex flex-wrap gap-2">
                {CONVERSION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!!convertingPreset && convertingPreset !== preset.id}
                    onClick={() => handleConvertPreset(preset)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      convertingPreset === preset.id
                        ? 'border-workspace-casual text-workspace-casual bg-workspace-casual/10'
                        : 'border-forge-border text-text-secondary hover:border-workspace-casual/50'
                    }`}
                  >
                    {convertingPreset === preset.id ? (
                      <span className="flex items-center gap-2">
                        <Loader size={12} className="animate-spin" /> Converting…
                      </span>
                    ) : (
                      <span className="flex flex-col text-left">
                        <span className="font-medium">{preset.label}</span>
                        <span className="text-[10px] text-text-muted">{preset.description}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {conversionMessage && (
                <div className="text-[11px] text-status-success bg-status-success/10 border border-status-success/30 rounded px-2 py-1">
                  {conversionMessage}
                </div>
              )}
              {conversionError && (
                <div className="text-[11px] text-status-error bg-status-error/10 border border-status-error/30 rounded px-2 py-1">
                  {conversionError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Remote model browser */}
      <ModelBrowser
        isOpen={showBrowser}
        onClose={() => setShowBrowser(false)}
      />
    </div>
  );
}

// Helper function
function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default ModelLibrary;

