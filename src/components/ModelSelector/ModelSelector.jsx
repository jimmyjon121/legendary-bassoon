import React, { useEffect, useRef, useMemo } from 'react';
import { X, Search, RefreshCw, Check, Cpu, HardDrive, FolderSearch, Loader, Zap, Code, MessageSquare, Sparkles, BookOpen, Bot } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion } from 'framer-motion';
import { ErrorBoundary } from '../ErrorBoundary';
import { parseModelName } from '../../services/modelOptimizer';

const AGENTIC_FAMILY_HINTS = [
  'qwen',
  'llama',
  'mistral',
  'mixtral',
  'deepseek',
  'gemma',
  'phi',
  'command-r',
  'nemotron',
];

const AGENTIC_SIGNAL_TERMS = [
  'agent',
  'tool',
  'function',
  'search',
  'research',
  'reasoning',
  'analysis',
  'instruct',
  'coder',
  'long context',
  '128k',
  '200k',
];

function getAgenticModelScore(modelName = '') {
  const parsed = parseModelName(modelName || '');
  const name = String(modelName || '').toLowerCase();
  const family = String(parsed?.family || '').toLowerCase();
  const combined = `${name} ${family}`;
  let score = 0;

  for (const term of AGENTIC_SIGNAL_TERMS) {
    if (combined.includes(term)) score += 1;
  }
  for (const hint of AGENTIC_FAMILY_HINTS) {
    if (combined.includes(hint)) {
      score += 2;
      break;
    }
  }
  if (name.includes('code') || name.includes('coder')) score += 1;
  if (name.includes('instruct')) score += 1;
  if (name.includes('r1') || name.includes('reason')) score += 2;

  return score;
}

export function ModelSelector({ onClose }) {
  const {
    currentModel,
    availableModels,
    modelStatus,
    error,
    setModel,
    refreshModels
  } = useAppStore();
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const isResearchWorkspace = currentWorkspace === 'research';

  const [searchQuery, setSearchQuery] = React.useState('');
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [localError, setLocalError] = React.useState(null);
  const [modelTab, setModelTab] = React.useState(isResearchWorkspace ? 'agentic' : 'all');
  const [localModels, setLocalModels] = React.useState([]);
  const [isLoadingLocal, setIsLoadingLocal] = React.useState(true);
  const [isCreatingFromLocal, setIsCreatingFromLocal] = React.useState(false);
  const [creatingModelName, setCreatingModelName] = React.useState(null);
  const [lmStudioModels, setLmStudioModels] = React.useState([]);
  const [isScanningLMStudio, setIsScanningLMStudio] = React.useState(false);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setLocalError(null);
    try {
      await refreshModels();
      // Also check health
      const health = await window.electronAPI?.checkLLMHealth();
      if (!health?.healthy) {
        setLocalError(health?.error || 'Ollama backend is not available. Make sure Ollama is running on http://localhost:11434');
      }
    } catch (error) {
      console.error('Failed to refresh models:', error);
      setLocalError(error.message || 'Failed to connect to Ollama. Make sure it is running.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load local GGUF models from the model manager
  useEffect(() => {
    const loadLocalModels = async () => {
      try {
        const ggufModels = await window.electronAPI?.getModelsByFormat?.('gguf');
        setLocalModels(ggufModels || []);
      } catch (error) {
        console.error('Failed to load local models:', error);
      } finally {
        setIsLoadingLocal(false);
      }
    };

    loadLocalModels();
  }, []);

  // Scan LM Studio models
  const scanLMStudio = async () => {
    setIsScanningLMStudio(true);
    try {
      const result = await window.electronAPI?.scanLMStudioModels();
      if (result?.models) {
        setLmStudioModels(result.models);
      }
    } catch (error) {
      console.error('Failed to scan LM Studio:', error);
    } finally {
      setIsScanningLMStudio(false);
    }
  };

  // Auto-scan LM Studio on mount
  useEffect(() => {
    scanLMStudio();
  }, []);

  useEffect(() => {
    if (isResearchWorkspace) {
      setModelTab('agentic');
    }
  }, [isResearchWorkspace]);

  const handleUseLocalModel = async (model) => {
    setIsCreatingFromLocal(true);
    setCreatingModelName(model.name || model.filename);
    setLocalError(null);

    try {
      const baseName = (model.name || model.filename || 'local-model')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-');
      // Use a flat name without slashes so it matches Ollama tags output
      const ollamaName = `local-${baseName}`;

      const res = await window.electronAPI?.createOllamaModelFromFile({
        name: ollamaName,
        path: model.path,
      });

      if (!res?.success) {
        throw new Error(res?.error || 'Failed to create Ollama model from local file');
      }

      // Refresh Ollama models and select the newly created one
      await refreshModels();
      const finalName = res.name || ollamaName;
      setModel(finalName);
      onClose();
    } catch (error) {
      console.error('Failed to use local model:', error);
      setLocalError(error.message || 'Failed to create model from local file');
    } finally {
      setIsCreatingFromLocal(false);
      setCreatingModelName(null);
    }
  };

  const agenticModelCount = useMemo(
    () => availableModels.filter((model) => getAgenticModelScore(model?.name || '') >= 3).length,
    [availableModels]
  );

  const filteredModels = useMemo(() => {
    const query = searchQuery.toLowerCase();
    let list = availableModels
      .filter((model) => model.name?.toLowerCase().includes(query))
      .map((model) => ({
        model,
        score: getAgenticModelScore(model?.name || ''),
      }));

    if (modelTab === 'agentic') {
      list = list.filter((entry) => entry.score >= 3);
    }

    if (modelTab === 'agentic' || isResearchWorkspace) {
      list.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.model?.name || '').localeCompare(String(b.model?.name || ''));
      });
    }

    return list;
  }, [availableModels, isResearchWorkspace, modelTab, searchQuery]);

  const filteredLocalModels = localModels.filter(model => {
    const query = searchQuery.toLowerCase();
    return (
      !query ||
      model.name?.toLowerCase().includes(query) ||
      model.filename?.toLowerCase().includes(query)
    );
  });

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  // Get model type info for display
  const getModelTypeInfo = useMemo(() => (modelName) => {
    const parsed = parseModelName(modelName);
    const typeConfig = {
      code: { icon: Code, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Code' },
      chat: { icon: MessageSquare, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Chat' },
      creative: { icon: Sparkles, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Creative' },
      instruct: { icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Instruct' },
    };
    
    // Determine type from family
    const familyTypes = {
      codellama: 'code', 'deepseek-coder': 'code', starcoder: 'code', 
      codegemma: 'code', qwen2coder: 'code', deepseek: 'code',
      nous: 'creative', hermes: 'creative', openhermes: 'creative', 
      dolphin: 'creative', neural: 'creative',
      zephyr: 'instruct', openchat: 'instruct', orca: 'instruct',
      wizard: 'instruct', command: 'instruct',
    };
    
    const modelType = familyTypes[parsed.family] || 'chat';
    return { ...typeConfig[modelType], parsed };
  }, []);

  return (
    <ErrorBoundary scope="ModelSelector">
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-md"
      >
        <div className="m-4 rounded-xl bg-forge-surface border border-forge-border shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-workspace-casual" />
            <h3 className="font-medium text-text-primary">Select Model</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
              title="Refresh models"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-forge-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-9 py-2 text-sm"
              autoFocus
            />
          </div>
          <div className="mt-2 flex items-center gap-1 rounded-lg border border-forge-border bg-forge-bg p-1">
            {[
              { id: 'all', label: 'All Models' },
              { id: 'agentic', label: 'Agentic Research' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setModelTab(tab.id)}
                className={`h-7 px-2.5 rounded-md text-[11px] transition-colors ${
                  modelTab === tab.id
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {isResearchWorkspace && (
            <p className="mt-1 text-[11px] text-sky-300/85">
              Research workspace active: agentic models are prioritized.
            </p>
          )}
        </div>

        {/* Error Display */}
        {(localError || error) && (
          <div className="mx-3 mt-3 p-3 bg-status-error/10 border border-status-error/30 rounded-lg">
            <p className="text-xs text-status-error font-medium">Connection Error</p>
            <p className="text-xs text-text-muted mt-1">{localError || error}</p>
          </div>
        )}

        {/* Models List */}
        <div className="max-h-80 overflow-y-auto">
          {/* Ollama models section */}
          <div className="p-2">
            <p className="text-xs font-semibold text-text-muted mb-1">
              {modelTab === 'agentic' ? 'Agentic Research Models' : 'Ollama Models'}
            </p>
            {filteredModels.length === 0 ? (
              <div className="p-4 text-center border border-dashed border-forge-border rounded-lg">
                <Cpu size={24} className="mx-auto text-text-muted mb-2" />
                <p className="text-xs text-text-secondary">
                  {modelTab === 'agentic' ? 'No agentic research models found' : 'No Ollama models found'}
                </p>
                <p className="text-[11px] text-text-muted mt-1">
                  {modelTab === 'agentic'
                    ? 'Try another search or switch to All Models.'
                    : 'Make sure Ollama is running and has models installed'}
                </p>
                <button
                  onClick={handleRefresh}
                  className="btn btn-secondary mt-3 text-xs"
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredModels.map((entry) => {
                  const model = entry.model;
                  const typeInfo = getModelTypeInfo(model.name);
                  const TypeIcon = typeInfo.icon;
                  const isAgentic = entry.score >= 3;
                  return (
                    <button
                      key={model.name}
                      onClick={() => {
                        setModel(model.name);
                        onClose();
                      }}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                        transition-colors text-left
                        ${currentModel === model.name 
                          ? 'bg-workspace-casual/20 border border-workspace-casual/30' 
                          : 'hover:bg-forge-hover border border-transparent'
                        }
                      `}
                    >
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${typeInfo.bg} border border-forge-border flex items-center justify-center`}>
                        <TypeIcon size={18} className={typeInfo.color} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {model.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {isAgentic && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium flex items-center gap-1">
                              <Bot size={10} />
                              Agentic
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeInfo.bg} ${typeInfo.color} font-medium`}>
                            {typeInfo.label}
                          </span>
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <HardDrive size={10} />
                            {formatSize(model.size)}
                          </span>
                          {typeInfo.parsed.size && (
                            <span className="text-xs text-text-muted">
                              {typeInfo.parsed.size}
                            </span>
                          )}
                          {typeInfo.parsed.quantization && (
                            <span className="text-[10px] text-text-muted opacity-70">
                              {typeInfo.parsed.quantization}
                            </span>
                          )}
                        </div>
                      </div>

                      {currentModel === model.name && (
                        <Check size={16} className="text-workspace-casual flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* LM Studio models section */}
          <div className="p-2 border-t border-forge-border/60 mt-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-text-muted flex items-center gap-1">
                <span className="text-base">🗂️</span> LM Studio Models
              </p>
              <button
                onClick={scanLMStudio}
                disabled={isScanningLMStudio}
                className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
                title="Rescan LM Studio folders"
              >
                {isScanningLMStudio ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <FolderSearch size={12} />
                )}
              </button>
            </div>
            {isScanningLMStudio ? (
              <div className="p-3 text-center text-xs text-text-muted">
                <Loader size={14} className="animate-spin mx-auto mb-1" />
                Scanning LM Studio folders...
              </div>
            ) : lmStudioModels.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">
                No LM Studio models found. Models are typically in <code className="bg-forge-bg px-1 rounded">~/.lmstudio/models</code>
              </div>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {lmStudioModels
                  .filter(m => !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((model, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleUseLocalModel({ 
                      path: model.path, 
                      name: model.name,
                      filename: model.name 
                    })}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg
                      transition-colors text-left hover:bg-forge-hover border border-transparent
                    `}
                    disabled={isCreatingFromLocal}
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center">
                      <span className="text-sm">🗂️</span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">
                        {model.name}
                      </p>
                      <p className="text-[11px] text-text-muted truncate flex items-center gap-1">
                        <span>{model.sizeFormatted}</span>
                        <span className="opacity-50">•</span>
                        <span>{model.parentFolder}</span>
                      </p>
                    </div>

                    <span className="text-[11px] text-blue-400 flex-shrink-0">
                      {isCreatingFromLocal && creatingModelName === model.name
                        ? 'Creating…'
                        : 'Use'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Local GGUF models section */}
          <div className="p-2 border-t border-forge-border/60 mt-1">
            <p className="text-xs font-semibold text-text-muted mb-1">DevForge Imported Models</p>
            {isLoadingLocal ? (
              <div className="p-4 text-center text-xs text-text-muted">
                Loading local models…
              </div>
            ) : filteredLocalModels.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">
                No imported models. Go to Settings → LLM Backend to import models.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredLocalModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleUseLocalModel(model)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg
                      transition-colors text-left hover:bg-forge-hover border border-transparent
                    `}
                    disabled={isCreatingFromLocal}
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-forge-elevated border border-forge-border flex items-center justify-center">
                      <Cpu size={16} className="text-workspace-casual" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">
                        {model.name || model.filename}
                      </p>
                      <p className="text-[11px] text-text-muted truncate">
                        GGUF • {model.sizeFormatted}
                      </p>
                    </div>

                    <span className="text-[11px] text-workspace-casual flex-shrink-0">
                      {isCreatingFromLocal && creatingModelName === (model.name || model.filename)
                        ? 'Creating…'
                        : 'Use via Ollama'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-forge-border bg-forge-bg/50">
          <p className="text-xs text-text-muted text-center">
            {availableModels.length} Ollama • {agenticModelCount} agentic picks • {lmStudioModels.length} LM Studio • {localModels.length} imported
          </p>
        </div>
        </div>
      </motion.div>
    </ErrorBoundary>
  );
}
