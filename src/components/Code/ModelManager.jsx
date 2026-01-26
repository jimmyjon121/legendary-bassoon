import React, { useState, useEffect, useCallback } from 'react';
import { Bot, HardDrive, Download, RefreshCw, Check, X, Zap, Server, FolderOpen, FolderSearch, CheckCircle, XCircle } from 'lucide-react';
import { detectLMStudioModels, checkLMStudioAPI } from '../../services/lmStudioDetector';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../utils/electronAPI';
import { ProgressBar, LoadingSpinner } from '../ui/ProgressBar';

export function ModelManager({ onClose }) {
  const [lmStudioModels, setLmStudioModels] = useState([]);
  const [lmStudioAPI, setLmStudioAPI] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importing, setImporting] = useState({}); // { [path]: { active: boolean, progress: number, message: string, stage: string } }
  const [activeTab, setActiveTab] = useState('ollama');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const {
    currentModel,
    availableModels,
    setModel,
    refreshModels,
  } = useAppStore((state) => ({
    currentModel: state.currentModel,
    availableModels: state.availableModels,
    setModel: state.setModel,
    refreshModels: state.refreshModels,
  }));

  const mergeModels = useCallback((existing, extra) => {
    const byPath = new Map();
    existing.forEach((m) => byPath.set(m.path, m));
    extra.forEach((m) => {
      if (!byPath.has(m.path)) byPath.set(m.path, m);
    });
    return Array.from(byPath.values());
  }, []);

  const loadLMStudioModels = useCallback(async () => {
    try {
      // Check if LM Studio API is running
      const apiStatus = await checkLMStudioAPI();
      setLmStudioAPI(apiStatus);
      
      // Detect downloaded models
      const detected = await detectLMStudioModels();
      setLmStudioModels(detected.models || []);
    } catch (err) {
      console.error('Failed to detect LM Studio models:', err);
    }
  }, []);

  const scanModelsInFolder = useCallback(async (rootPath) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use the dedicated model scanner IPC
      const result = await api.scanFolderForModels(rootPath);
      
      if (result.error) {
        setError(`Scan error: ${result.error}`);
        return;
      }
      
      const found = (result.models || []).map(m => ({
        ...m,
        quantization: 'Unknown',
        size: m.size ? `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB` : 'Unknown',
      }));
      
      if (found.length > 0) {
        setLmStudioModels((prev) => mergeModels(prev, found));
        setSuccessMessage(`Found ${found.length} model(s) in the selected folder!`);
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(`No model files found in ${rootPath}. Looking for .gguf, .bin, .safetensors, or .ggml files.`);
      }
    } catch (err) {
      console.error('Failed to scan folder for models:', err);
      setError(`Failed to scan folder: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [mergeModels]);

  const handleBrowseForModels = useCallback(async () => {
    try {
      const folder = await api.selectFolder({ title: 'Select LM Studio models folder' });
      if (!folder) return;
      await scanModelsInFolder(folder);
    } catch (err) {
      console.error('Failed to browse for models folder:', err);
      setError(`Failed to open folder: ${err.message}`);
    }
  }, [scanModelsInFolder]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await Promise.all([refreshModels(), loadLMStudioModels()]);
    setIsLoading(false);
  }, [refreshModels, loadLMStudioModels]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImportToOllama = async (model) => {
    const safeName = model.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Initialize progress state
    setImporting(prev => ({
      ...prev,
      [model.path]: { active: true, progress: 0, message: 'Starting import...', stage: 'starting' }
    }));
    setError(null);
    
    try {
      // Use the progress-enabled IPC call
      const result = await window.electronAPI?.createOllamaModelWithProgress(
        { name: safeName, path: model.path },
        (progress) => {
          // Update progress state
          setImporting(prev => ({
            ...prev,
            [model.path]: {
              active: progress.stage !== 'complete' && progress.stage !== 'error',
              progress: progress.progress,
              message: progress.message,
              stage: progress.stage,
            }
          }));
        }
      );

      if (result?.success) {
        setSuccessMessage(`Successfully imported ${safeName}!`);
        setTimeout(() => setSuccessMessage(null), 3000);
        await refreshModels();
        // Mark as complete
        setImporting(prev => ({
          ...prev,
          [model.path]: { active: false, progress: 100, message: 'Complete!', stage: 'complete' }
        }));
      } else {
        setError(`Import failed: ${result?.error || 'Unknown error'}`);
        setImporting(prev => ({
          ...prev,
          [model.path]: { active: false, progress: 0, message: result?.error, stage: 'error' }
        }));
      }
    } catch (err) {
      setError(`Import failed: ${err.message}`);
      setImporting(prev => ({
        ...prev,
        [model.path]: { active: false, progress: 0, message: err.message, stage: 'error' }
      }));
    }
  };

  const handleSelectModel = (modelName) => {
    setModel(modelName);
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const getImportStatus = (modelPath) => {
    return importing[modelPath] || { active: false, progress: 0, message: '', stage: '' };
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-forge-surface border border-forge-border rounded-xl w-[700px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-forge-border">
          <h2 className="text-lg font-semibold text-forge-text flex items-center gap-2">
            <Bot size={20} className="text-workspace-code" />
            Model Manager
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1.5 hover:bg-forge-bg/50 rounded text-forge-text-muted hover:text-forge-text"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-forge-bg/50 rounded text-forge-text-muted hover:text-forge-text">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-forge-border">
          <button
            onClick={() => setActiveTab('ollama')}
            className={`flex-1 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
              activeTab === 'ollama' 
                ? 'text-workspace-code border-b-2 border-workspace-code' 
                : 'text-forge-text-muted hover:text-forge-text'
            }`}
          >
            <Server size={14} />
            Ollama ({availableModels.length})
          </button>
          <button
            onClick={() => setActiveTab('lmstudio')}
            className={`flex-1 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 ${
              activeTab === 'lmstudio' 
                ? 'text-workspace-code border-b-2 border-workspace-code' 
                : 'text-forge-text-muted hover:text-forge-text'
            }`}
          >
            <HardDrive size={14} />
            LM Studio ({lmStudioModels.length})
          </button>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="mx-4 mt-4 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-sm text-emerald-400 flex items-center gap-2">
            <CheckCircle size={16} />
            {successMessage}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mt-4 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400 flex items-center gap-2">
            <XCircle size={16} />
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-forge-text-muted">
              <LoadingSpinner size={32} className="mb-4" />
              <p className="text-sm">Scanning for models...</p>
              <ProgressBar progress={-1} size="sm" className="w-48 mt-4" showPercentage={false} />
            </div>
          ) : activeTab === 'ollama' ? (
            <div className="space-y-2">
              {availableModels.length === 0 ? (
                <p className="text-center text-forge-text-muted py-8">
                  No Ollama models found. Pull models with `ollama pull model-name`
                </p>
              ) : (
                availableModels.map((model) => (
                  <div
                    key={model.name}
                    className={`p-3 rounded-lg border ${
                      currentModel === model.name 
                        ? 'border-workspace-code bg-workspace-code/10' 
                        : 'border-forge-border/50 hover:border-forge-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Bot size={20} className="text-forge-text-muted" />
                        <div>
                          <h3 className="font-medium text-forge-text">{model.name}</h3>
                          {model.size && (
                            <p className="text-xs text-forge-text-muted">
                              {formatSize(model.size)}
                              {model.modified_at && ` • Modified ${new Date(model.modified_at).toLocaleDateString()}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSelectModel(model.name)}
                        className={`px-3 py-1.5 rounded text-sm ${
                          currentModel === model.name
                            ? 'bg-workspace-code text-white'
                            : 'bg-forge-bg hover:bg-forge-border/50 text-forge-text'
                        }`}
                      >
                        {currentModel === model.name ? (
                          <span className="flex items-center gap-1"><Check size={14} /> Active</span>
                        ) : (
                          'Select'
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* LM Studio API Status */}
              <div className={`p-3 rounded-lg border ${lmStudioAPI?.running ? 'border-green-500/50 bg-green-500/10' : 'border-forge-border/50'}`}>
                <div className="flex items-center gap-2">
                  <Zap size={16} className={lmStudioAPI?.running ? 'text-green-400' : 'text-forge-text-muted'} />
                  <span className="text-sm">
                    {lmStudioAPI?.running 
                      ? `LM Studio API running at ${lmStudioAPI.endpoint}`
                      : 'LM Studio API not detected (start LM Studio with local server enabled)'
                    }
                  </span>
                </div>
              </div>

              {/* Downloaded Models */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-forge-text-muted flex items-center gap-2">
                    <FolderOpen size={14} />
                    Downloaded Models
                  </h3>
                  <button
                    type="button"
                    onClick={handleBrowseForModels}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg/60 hover:bg-forge-bg text-xs text-forge-text-muted hover:text-forge-text transition-colors"
                  >
                    <FolderSearch size={12} />
                    Browse folder
                  </button>
                </div>

                {lmStudioModels.length === 0 ? (
                  <p className="text-center text-forge-text-muted py-8">
                    No LM Studio models found. Click "Browse folder" to select your models directory.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lmStudioModels.map((model) => {
                      const status = getImportStatus(model.path);
                      
                      return (
                        <div
                          key={model.path}
                          className={`p-3 rounded-lg border transition-all ${
                            status.stage === 'complete' 
                              ? 'border-emerald-500/50 bg-emerald-500/5'
                              : status.stage === 'error'
                              ? 'border-red-500/50 bg-red-500/5'
                              : 'border-forge-border/50 hover:border-forge-border'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <HardDrive size={20} className={
                                status.stage === 'complete' ? 'text-emerald-400' :
                                status.stage === 'error' ? 'text-red-400' :
                                'text-forge-text-muted'
                              } />
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-forge-text truncate">{model.name}</h3>
                                <p className="text-xs text-forge-text-muted truncate">
                                  {model.size} • {model.quantization} • {model.filename}
                                </p>
                              </div>
                            </div>
                            
                            {status.active ? (
                              <div className="ml-3 w-32">
                                <LoadingSpinner size={14} text={`${status.progress}%`} />
                              </div>
                            ) : status.stage === 'complete' ? (
                              <span className="ml-3 flex items-center gap-1 text-xs text-emerald-400">
                                <CheckCircle size={14} /> Imported
                              </span>
                            ) : status.stage === 'error' ? (
                              <button
                                onClick={() => handleImportToOllama(model)}
                                className="ml-3 px-3 py-1.5 rounded text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center gap-1"
                              >
                                <RefreshCw size={14} /> Retry
                              </button>
                            ) : (
                              <button
                                onClick={() => handleImportToOllama(model)}
                                className="ml-3 px-3 py-1.5 rounded text-sm bg-workspace-code/20 hover:bg-workspace-code/30 text-workspace-code flex items-center gap-1"
                              >
                                <Download size={14} /> Import to Ollama
                              </button>
                            )}
                          </div>
                          
                          {/* Progress bar when importing */}
                          {status.active && (
                            <div className="mt-3">
                              <ProgressBar 
                                progress={status.progress} 
                                label={status.message}
                                size="sm"
                                variant="default"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-forge-border bg-forge-bg/30">
          <p className="text-xs text-forge-text-muted text-center">
            {activeTab === 'ollama' 
              ? 'Ollama models are ready to use. Select one to make it active.'
              : 'Import LM Studio models to Ollama to use them in DevForge.'
            }
          </p>
        </div>
      </div>
    </div>
  );
}

export default ModelManager;
