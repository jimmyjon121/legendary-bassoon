import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  FolderSearch,
  HardDrive,
  Download,
  Copy,
  Move,
  Link,
  FileText,
  Folder,
  FolderOpen,
  Check,
  X,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  AlertCircle,
  Info,
  Package,
  Cpu
} from 'lucide-react';

// Format icons mapping
const FORMAT_ICONS = {
  gguf: '🦙',
  onnx: '🔷',
  openvino: '🔶',
  safetensors: '🤗',
  pytorch: '🔥',
  bin: '📦'
};

// Import method options
const IMPORT_METHODS = [
  { id: 'copy', name: 'Copy', icon: Copy, description: 'Copy file to DevForge folder (keeps original)' },
  { id: 'move', name: 'Move', icon: Move, description: 'Move file to DevForge folder (removes original)' },
  { id: 'reference', name: 'Reference', icon: Link, description: 'Use file from original location (no copy)' }
];

const CONVERSION_PRESETS = [
  { id: 'gguf-q4', label: 'GGUF (Q4_K_M)', targetFormat: 'gguf', options: { quantization: 'q4_k_m' } },
  { id: 'gguf-q8', label: 'GGUF (Q8_0)', targetFormat: 'gguf', options: { quantization: 'q8_0' } },
  { id: 'openvino', label: 'OpenVINO IR', targetFormat: 'openvino', options: {} },
];

export function ModelFinder({ onClose, onImportComplete }) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [commonLocations, setCommonLocations] = useState([]);
  const [selectedModels, setSelectedModels] = useState(new Set());
  const [importMethod, setImportMethod] = useState('copy');
  const [expandedLocations, setExpandedLocations] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [diskSpace, setDiskSpace] = useState(null);
  const [modelsDirectory, setModelsDirectory] = useState(null);
  const [error, setError] = useState(null);
  const [finderConvertingPreset, setFinderConvertingPreset] = useState(null);
  const [finderConversionMessage, setFinderConversionMessage] = useState(null);
  const [finderConversionError, setFinderConversionError] = useState(null);

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  const singleSelectedModel = useMemo(() => {
    if (selectedModels.size !== 1) return null;
    const id = Array.from(selectedModels)[0];
    return scanResults?.models?.find((m) => m.id === id) || null;
  }, [selectedModels, scanResults]);

  useEffect(() => {
    setFinderConvertingPreset(null);
    setFinderConversionMessage(null);
    setFinderConversionError(null);
  }, [singleSelectedModel?.id]);

  const loadInitialData = async () => {
    try {
      if (window.electronAPI) {
        console.log('[ModelFinder] Loading initial data...');
        
        const locations = await window.electronAPI.getCommonModelLocations();
        console.log('[ModelFinder] Common locations:', locations);
        setCommonLocations(locations || []);
        
        const space = await window.electronAPI.getModelsDiskSpace();
        console.log('[ModelFinder] Disk space:', space);
        setDiskSpace(space);
        
        const dir = await window.electronAPI.getSettings('modelsDirectory');
        console.log('[ModelFinder] Models directory:', dir);
        setModelsDirectory(dir);
      } else {
        console.warn('[ModelFinder] Electron API not available');
      }
    } catch (error) {
      console.error('[ModelFinder] Failed to load initial data:', error);
    }
  };

  // Scan system for models
  const scanSystem = async () => {
    setIsScanning(true);
    setError(null);
    
    try {
      if (window.electronAPI) {
        console.log('[ModelFinder] Starting scan...');
        const results = await window.electronAPI.scanSystemForModels();
        console.log('[ModelFinder] Scan results:', results);
        
        if (results?.error) {
          setError(results.error);
        } else {
          setScanResults(results);
          
          // Auto-expand locations with models
          if (results?.locations) {
            setExpandedLocations(new Set(results.locations.map(l => l.path)));
          }
        }
      } else {
        setError('Electron API not available - are you running in the Electron app?');
      }
    } catch (error) {
      console.error('[ModelFinder] Scan error:', error);
      setError('Failed to scan system: ' + error.message);
    } finally {
      setIsScanning(false);
    }
  };

  // Toggle model selection
  const toggleModelSelection = (modelId) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
  };

  // Select all models in a location
  const selectAllInLocation = (location) => {
    const newSelected = new Set(selectedModels);
    location.models.forEach(m => newSelected.add(m.id));
    setSelectedModels(newSelected);
  };

  // Deselect all models in a location
  const deselectAllInLocation = (location) => {
    const newSelected = new Set(selectedModels);
    location.models.forEach(m => newSelected.delete(m.id));
    setSelectedModels(newSelected);
  };

  // Toggle location expansion
  const toggleLocation = (path) => {
    const newExpanded = new Set(expandedLocations);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedLocations(newExpanded);
  };

  // Import selected models
  const importModels = async () => {
    if (selectedModels.size === 0) {
      setError('No models selected');
      return;
    }
    
    console.log('[ModelFinder] Starting import, method:', importMethod, 'selected:', selectedModels.size);
    
    // Check if models directory is set (not needed for reference)
    if (!modelsDirectory && importMethod !== 'reference') {
      console.log('[ModelFinder] No models directory, prompting user...');
      try {
        const result = await window.electronAPI?.browseForModelsDirectory();
        if (result?.canceled) {
          console.log('[ModelFinder] User canceled directory selection');
          return;
        }
        if (result?.directory) {
          setModelsDirectory(result.directory);
          console.log('[ModelFinder] Directory set to:', result.directory);
        }
      } catch (err) {
        console.error('[ModelFinder] Failed to get directory:', err);
        setError('Failed to select directory: ' + err.message);
        return;
      }
    }
    
    setImporting(true);
    setImportProgress({ current: 0, total: selectedModels.size, results: [] });
    setError(null);
    
    try {
      const modelPaths = [];
      scanResults?.models?.forEach(m => {
        if (selectedModels.has(m.id)) {
          modelPaths.push(m.path);
        }
      });
      
      console.log('[ModelFinder] Importing paths:', modelPaths);
      
      if (window.electronAPI) {
        const results = await window.electronAPI.bulkImportModels(modelPaths, { method: importMethod });
        console.log('[ModelFinder] Import results:', results);
        
        setImportProgress({
          current: selectedModels.size,
          total: selectedModels.size,
          results,
          complete: true
        });
        
        // Show success/failure message
        if (results?.success?.length > 0) {
          onImportComplete?.(results.success.length);
        }
        
        if (results?.failed?.length > 0) {
          const failedPaths = results.failed.map(f => f.error || f.path).join(', ');
          setError(`Some imports failed: ${failedPaths}`);
        }
      } else {
        setError('Import not available - running in browser mode');
      }
    } catch (error) {
      console.error('[ModelFinder] Import error:', error);
      setError('Failed to import models: ' + error.message);
    } finally {
      setImporting(false);
    }
  };

  // Browse for specific files
  const browseForFiles = async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.browseForModelFiles();
        if (result?.files?.length > 0) {
          // Add these to scan results
          const newModels = result.files.map((f, i) => ({
            id: `browse-${Date.now()}-${i}`,
            path: f,
            filename: f.split(/[/\\]/).pop(),
            format: detectFormat(f),
            sizeFormatted: 'Unknown',
            isManuallyAdded: true
          }));
          
          setScanResults(prev => ({
            ...prev,
            models: [...(prev?.models || []), ...newModels],
            locations: [
              ...(prev?.locations || []),
              {
                path: 'Manually Selected',
                models: newModels,
                count: newModels.length
              }
            ]
          }));
          
          // Auto-select the new models
          newModels.forEach(m => selectedModels.add(m.id));
          setSelectedModels(new Set(selectedModels));
        }
      }
    } catch (error) {
      setError('Failed to browse for files: ' + error.message);
    }
  };

  const handleFinderConvert = async (preset) => {
    if (!singleSelectedModel?.path) {
      setFinderConversionError('Select a single model with a valid file path to convert.');
      return;
    }
    if (!window.electronAPI?.convertModel) {
      setFinderConversionError('Conversion service unavailable.');
      return;
    }
    setFinderConvertingPreset(preset.id);
    setFinderConversionError(null);
    setFinderConversionMessage(null);
    try {
      const res = await window.electronAPI.convertModel({
        sourcePath: singleSelectedModel.path,
        targetFormat: preset.targetFormat,
        options: preset.options,
      });
      if (!res?.success) {
        throw new Error(res?.error || 'Conversion failed');
      }
      setFinderConversionMessage(res.message || 'Conversion complete.');
    } catch (error) {
      setFinderConversionError(error.message);
    } finally {
      setFinderConvertingPreset(null);
    }
  };

  // Detect format from path
  const detectFormat = (filePath) => {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'gguf') return 'gguf';
    if (ext === 'onnx') return 'onnx';
    if (ext === 'safetensors') return 'safetensors';
    if (ext === 'pt' || ext === 'pth') return 'pytorch';
    if (ext === 'bin') return 'bin';
    return 'unknown';
  };

  // Set models directory
  const chooseModelsDirectory = async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.browseForModelsDirectory();
        if (!result?.canceled && result?.directory) {
          setModelsDirectory(result.directory);
        }
      }
    } catch (error) {
      setError('Failed to set models directory: ' + error.message);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-forge-surface border border-forge-border rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-workspace-code/20">
              <FolderSearch className="w-5 h-5 text-workspace-code" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Model Finder</h2>
              <p className="text-sm text-text-muted">Find and import AI models from your system</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-forge-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="px-6 py-4 border-b border-forge-border bg-forge-bg/50">
            <div className="flex items-center gap-4">
              {/* Scan Button */}
              <button
                onClick={scanSystem}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-workspace-code text-white hover:bg-workspace-code/90 transition-colors disabled:opacity-50"
              >
                {isScanning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                {isScanning ? 'Scanning...' : 'Scan System'}
              </button>

              {/* Browse Button */}
              <button
                onClick={browseForFiles}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-forge-elevated border border-forge-border hover:bg-forge-hover transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Browse Files
              </button>

              <div className="flex-1" />

              {/* Models Directory */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-muted">Save to:</span>
                <button
                  onClick={chooseModelsDirectory}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-forge-elevated border border-forge-border hover:bg-forge-hover transition-colors max-w-[200px]"
                >
                  <Folder className="w-4 h-4 text-text-muted flex-shrink-0" />
                  <span className="text-text-secondary truncate">
                    {modelsDirectory ? modelsDirectory.split(/[/\\]/).pop() : 'Choose folder...'}
                  </span>
                </button>
              </div>
            </div>

            {/* Disk Space Info */}
            {diskSpace && (
              <div className="mt-3 flex items-center gap-4 text-sm">
                <HardDrive className="w-4 h-4 text-text-muted" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-text-muted">Disk Space</span>
                    <span className="text-text-secondary">
                      {diskSpace.freeFormatted} free of {diskSpace.totalFormatted}
                    </span>
                  </div>
                  <div className="h-1.5 bg-forge-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        diskSpace.percentUsed > 90 ? 'bg-status-error' :
                        diskSpace.percentUsed > 70 ? 'bg-status-warning' :
                        'bg-status-success'
                      }`}
                      style={{ width: `${diskSpace.percentUsed}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 p-4 rounded-lg bg-status-error/10 border border-status-error/30 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0" />
                <p className="text-sm text-status-error">{error}</p>
                <button onClick={() => setError(null)} className="ml-auto">
                  <X className="w-4 h-4 text-status-error" />
                </button>
              </div>
            )}

            {!scanResults && !isScanning && (
              <div className="text-center py-12">
                <FolderSearch className="w-16 h-16 text-text-muted mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  Find AI Models on Your System
                </h3>
                <p className="text-text-muted max-w-md mx-auto mb-6">
                  Click "Scan System" to search common locations for GGUF, ONNX, SafeTensors, and other AI model files.
                </p>
                
                {/* Common Locations Preview */}
                {commonLocations.length > 0 && (
                  <div className="max-w-md mx-auto text-left">
                    <p className="text-sm text-text-muted mb-2">Will search:</p>
                    <div className="space-y-1">
                      {commonLocations.filter(l => l.exists).slice(0, 5).map((loc, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <Folder className="w-4 h-4 text-text-muted" />
                          <span className="text-text-secondary">{loc.name}</span>
                          <Check className="w-3 h-3 text-status-success ml-auto" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isScanning && (
              <div className="text-center py-12">
                <RefreshCw className="w-12 h-12 text-workspace-code mx-auto mb-4 animate-spin" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  Scanning your system...
                </h3>
                <p className="text-text-muted">
                  Looking for AI models in common locations
                </p>
              </div>
            )}

            {scanResults && !isScanning && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-forge-elevated border border-forge-border">
                  <div className="flex items-center gap-4">
                    <Package className="w-8 h-8 text-workspace-code" />
                    <div>
                      <p className="text-lg font-semibold text-text-primary">
                        {scanResults.totalCount || 0} models found
                      </p>
                      <p className="text-sm text-text-muted">
                        {scanResults.totalSizeFormatted} total • {scanResults.locations?.length || 0} locations
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-text-muted">Selected</p>
                    <p className="text-lg font-semibold text-workspace-code">
                      {selectedModels.size}
                    </p>
                  </div>
                </div>

                {/* Locations */}
                {scanResults.locations?.map((location) => (
                  <div key={location.path} className="border border-forge-border rounded-lg overflow-hidden">
                    {/* Location Header */}
                    <button
                      onClick={() => toggleLocation(location.path)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-forge-elevated hover:bg-forge-hover transition-colors"
                    >
                      {expandedLocations.has(location.path) ? (
                        <ChevronDown className="w-4 h-4 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                      <Folder className="w-5 h-5 text-workspace-work" />
                      <div className="flex-1 text-left">
                        <p className="font-medium text-text-primary">{location.path.split(/[/\\]/).pop()}</p>
                        <p className="text-xs text-text-muted truncate">{location.path}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-forge-bg text-xs text-text-secondary">
                        {location.count} models • {location.sizeFormatted}
                      </span>
                    </button>

                    {/* Models List */}
                    <AnimatePresence>
                      {expandedLocations.has(location.path) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          {/* Select All */}
                          <div className="px-4 py-2 bg-forge-bg/50 border-t border-forge-border flex items-center gap-2">
                            <button
                              onClick={() => selectAllInLocation(location)}
                              className="text-xs text-workspace-code hover:underline"
                            >
                              Select all
                            </button>
                            <span className="text-text-muted">•</span>
                            <button
                              onClick={() => deselectAllInLocation(location)}
                              className="text-xs text-text-muted hover:text-text-secondary"
                            >
                              Deselect all
                            </button>
                          </div>

                          {/* Model Items */}
                          <div className="divide-y divide-forge-border">
                            {location.models.map((model) => (
                              <div
                                key={model.id}
                                className={`flex items-center gap-3 px-4 py-3 hover:bg-forge-hover/50 transition-colors cursor-pointer ${
                                  selectedModels.has(model.id) ? 'bg-workspace-code/10' : ''
                                }`}
                                onClick={() => toggleModelSelection(model.id)}
                              >
                                {/* Checkbox */}
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                  selectedModels.has(model.id)
                                    ? 'bg-workspace-code border-workspace-code'
                                    : 'border-forge-border'
                                }`}>
                                  {selectedModels.has(model.id) && (
                                    <Check className="w-3 h-3 text-white" />
                                  )}
                                </div>

                                {/* Format Icon */}
                                <span className="text-lg">{FORMAT_ICONS[model.format] || '📄'}</span>

                                {/* Model Info */}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-text-primary truncate">
                                    {model.name || model.filename}
                                  </p>
                                  <div className="flex items-center gap-2 text-xs text-text-muted">
                                    <span className="uppercase">{model.format}</span>
                                    {model.quantization && (
                                      <>
                                        <span>•</span>
                                        <span>{model.quantization}</span>
                                      </>
                                    )}
                                    {model.parameters && (
                                      <>
                                        <span>•</span>
                                        <span>{model.parameters}B params</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Size */}
                                <span className="text-sm text-text-muted">
                                  {model.sizeFormatted}
                                </span>

                                {/* Open in Explorer */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.electronAPI?.openInExplorer(model.path);
                                  }}
                                  className="p-1.5 rounded hover:bg-forge-bg transition-colors"
                                  title="Show in Explorer"
                                >
                                  <ExternalLink className="w-4 h-4 text-text-muted" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

                {scanResults.locations?.length === 0 && (
                  <div className="text-center py-8">
                    <Info className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-50" />
                    <p className="text-text-muted">No models found in common locations</p>
                    <button
                      onClick={browseForFiles}
                      className="mt-4 text-workspace-code hover:underline"
                    >
                      Browse for files manually
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer with Import Options */}
          {selectedModels.size > 0 && (
            <div className="px-6 py-4 border-t border-forge-border bg-forge-elevated">
              {singleSelectedModel && (
                <div className="mb-4 p-3 rounded-lg border border-dashed border-forge-border bg-forge-bg/40">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs text-text-muted">Convert selected model</p>
                      <p className="text-sm text-text-primary font-medium">
                        {singleSelectedModel.name || singleSelectedModel.filename}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONVERSION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={
                          !!finderConvertingPreset && finderConvertingPreset !== preset.id
                        }
                        onClick={() => handleFinderConvert(preset)}
                        className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                          finderConvertingPreset === preset.id
                            ? 'border-workspace-code text-workspace-code bg-workspace-code/10'
                            : 'border-forge-border text-text-secondary hover:border-workspace-code/50'
                        }`}
                      >
                        {finderConvertingPreset === preset.id ? 'Converting…' : preset.label}
                      </button>
                    ))}
                  </div>
                  {finderConversionMessage && (
                    <div className="mt-2 text-[11px] text-status-success">{finderConversionMessage}</div>
                  )}
                  {finderConversionError && (
                    <div className="mt-2 text-[11px] text-status-error">{finderConversionError}</div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4">
                {/* Import Method Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted">Import method:</span>
                  <div className="flex rounded-lg border border-forge-border overflow-hidden">
                    {IMPORT_METHODS.map((method) => (
                      <button
                        key={method.id}
                        onClick={() => setImportMethod(method.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                          importMethod === method.id
                            ? 'bg-workspace-code text-white'
                            : 'bg-forge-bg hover:bg-forge-hover text-text-secondary'
                        }`}
                        title={method.description}
                      >
                        <method.icon className="w-4 h-4" />
                        {method.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1" />

                {/* Import Button */}
                <button
                  onClick={importModels}
                  disabled={importing}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-status-success text-white hover:bg-status-success/90 transition-colors disabled:opacity-50"
                >
                  {importing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Import {selectedModels.size} Model{selectedModels.size !== 1 ? 's' : ''}
                </button>
              </div>

              {/* Import Progress */}
              {importProgress && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-text-muted">
                      {importProgress.complete ? 'Import complete' : 'Importing...'}
                    </span>
                    <span className="text-text-secondary">
                      {importProgress.current} / {importProgress.total}
                    </span>
                  </div>
                  <div className="h-2 bg-forge-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-status-success rounded-full transition-all"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                  {importProgress.complete && importProgress.results && (
                    <div className="mt-2 text-sm">
                      <span className="text-status-success">
                        ✓ {importProgress.results.success?.length || 0} imported
                      </span>
                      {importProgress.results.failed?.length > 0 && (
                        <span className="text-status-error ml-4">
                          ✗ {importProgress.results.failed.length} failed
                        </span>
                      )}
                      {importProgress.results.skipped?.length > 0 && (
                        <span className="text-text-muted ml-4">
                          ○ {importProgress.results.skipped.length} skipped
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ModelFinder;

