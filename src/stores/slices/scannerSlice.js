/**
 * Scanner Slice - Manages local model scanner state
 * Integrates with LocalModelScanner backend
 */

export const createScannerSlice = (set, get) => ({
  // State
  scannerSources: [],
  discoveredModels: [],
  scannerLoading: false,
  scannerInitialized: false,
  currentScanSource: null,
  scanResults: null,
  
  // Actions
  initializeScanner: async () => {
    if (get().scannerInitialized) return;
    
    set({ scannerLoading: true });
    
    try {
      // Load sources
      const sources = await window.electronAPI?.scannerGetSources?.() || [];
      set({ 
        scannerSources: sources,
        scannerInitialized: true,
        scannerLoading: false,
      });
      
      // Set up event listeners
      get().setupScannerListeners();
    } catch (error) {
      console.error('[ScannerSlice] Failed to initialize:', error);
      set({ scannerLoading: false });
    }
  },
  
  setupScannerListeners: () => {
    const api = window.electronAPI;
    if (!api) return;
    
    // Scan started
    api.onScannerStarted?.(() => {
      set({ scannerLoading: true, currentScanSource: null });
    });
    
    // Scanning source
    api.onScannerSource?.((data) => {
      set({ currentScanSource: data.source });
    });
    
    // Scan completed
    api.onScannerCompleted?.((results) => {
      set({ 
        scannerLoading: false, 
        currentScanSource: null,
        scanResults: results,
      });
      // Refresh models
      get().loadDiscoveredModels();
    });
    
    // Model discovered (during scan)
    api.onScannerModelDiscovered?.((model) => {
      set((state) => ({
        discoveredModels: [...state.discoveredModels, model],
      }));
    });
    
    // Model changed (from watcher)
    api.onScannerModelChanged?.((data) => {
      console.log('[ScannerSlice] Model changed:', data);
      // Trigger rescan
      get().scanAll({ shallow: true });
    });
    
    // Import progress
    api.onScannerImportProgress?.((data) => {
      set((state) => ({
        discoveredModels: state.discoveredModels.map(m =>
          m.path === data.modelPath
            ? { ...m, importProgress: data.progress }
            : m
        ),
      }));
    });
    
    // Move progress
    api.onScannerMoveProgress?.((data) => {
      set((state) => ({
        discoveredModels: state.discoveredModels.map(m =>
          m.path === data.modelPath
            ? { ...m, moveProgress: data.progress }
            : m
        ),
      }));
    });
  },
  
  // Refresh sources
  refreshSources: async () => {
    try {
      const sources = await window.electronAPI?.scannerGetSources?.() || [];
      set({ scannerSources: sources });
      return sources;
    } catch (error) {
      console.error('[ScannerSlice] Failed to refresh sources:', error);
      return [];
    }
  },
  
  // Scan all sources
  scanAll: async (options = {}) => {
    set({ scannerLoading: true, discoveredModels: [] });
    try {
      const results = await window.electronAPI?.scannerScanAll?.(options);
      return results;
    } catch (error) {
      console.error('[ScannerSlice] Scan failed:', error);
      set({ scannerLoading: false });
      return { error: error.message };
    }
  },
  
  // Load discovered models
  loadDiscoveredModels: async () => {
    try {
      const models = await window.electronAPI?.scannerGetAllModels?.() || [];
      set({ discoveredModels: models });
      return models;
    } catch (error) {
      console.error('[ScannerSlice] Failed to load models:', error);
      return [];
    }
  },
  
  // Get models by source
  getModelsBySource: async (sourceId) => {
    try {
      return await window.electronAPI?.scannerGetBySource?.(sourceId) || [];
    } catch (error) {
      console.error('[ScannerSlice] Failed to get models by source:', error);
      return [];
    }
  },
  
  // Get models by type
  getModelsByType: async (modelType) => {
    try {
      return await window.electronAPI?.scannerGetByType?.(modelType) || [];
    } catch (error) {
      console.error('[ScannerSlice] Failed to get models by type:', error);
      return [];
    }
  },
  
  // Add custom path
  addCustomPath: async (scanPath, options = {}) => {
    try {
      const result = await window.electronAPI?.scannerAddCustomPath?.(scanPath, options);
      if (result?.success) {
        await get().refreshSources();
      }
      return result;
    } catch (error) {
      console.error('[ScannerSlice] Failed to add custom path:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Remove custom path
  removeCustomPath: async (scanPath) => {
    try {
      const result = await window.electronAPI?.scannerRemoveCustomPath?.(scanPath);
      if (result?.success) {
        await get().refreshSources();
      }
      return result;
    } catch (error) {
      console.error('[ScannerSlice] Failed to remove custom path:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Import model (copy)
  importModel: async (modelPath, targetDir) => {
    try {
      const result = await window.electronAPI?.scannerImportModel?.(modelPath, targetDir);
      if (result?.success) {
        // Mark model as imported
        set((state) => ({
          discoveredModels: state.discoveredModels.map(m =>
            m.path === modelPath
              ? { ...m, imported: true, importedPath: result.importedPath }
              : m
          ),
        }));
      }
      return result;
    } catch (error) {
      console.error('[ScannerSlice] Failed to import model:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Link model (symlink)
  linkModel: async (modelPath, targetDir) => {
    try {
      const result = await window.electronAPI?.scannerLinkModel?.(modelPath, targetDir);
      if (result?.success) {
        set((state) => ({
          discoveredModels: state.discoveredModels.map(m =>
            m.path === modelPath
              ? { ...m, isLinked: true, linkedTo: result.linkedPath }
              : m
          ),
        }));
      }
      return result;
    } catch (error) {
      console.error('[ScannerSlice] Failed to link model:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Move model
  moveModel: async (modelPath, targetDir) => {
    try {
      const result = await window.electronAPI?.scannerMoveModel?.(modelPath, targetDir);
      if (result?.success) {
        set((state) => ({
          discoveredModels: state.discoveredModels.map(m =>
            m.path === modelPath
              ? { ...m, path: result.movedPath, moved: true }
              : m
          ),
        }));
      }
      return result;
    } catch (error) {
      console.error('[ScannerSlice] Failed to move model:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Start watching
  startWatching: async (sourceId) => {
    try {
      return await window.electronAPI?.scannerStartWatching?.(sourceId);
    } catch (error) {
      console.error('[ScannerSlice] Failed to start watching:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Stop watching
  stopWatching: async (sourceId) => {
    try {
      return await window.electronAPI?.scannerStopWatching?.(sourceId);
    } catch (error) {
      console.error('[ScannerSlice] Failed to stop watching:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Clear scanner
  clearScanner: async () => {
    try {
      await window.electronAPI?.scannerClear?.();
      set({ discoveredModels: [], scanResults: null });
      return { success: true };
    } catch (error) {
      console.error('[ScannerSlice] Failed to clear:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Selectors
  getDetectedSources: () => {
    const { scannerSources } = get();
    return scannerSources.filter(s => s.detected);
  },
  
  getModelsBySourceLocal: (sourceId) => {
    const { discoveredModels } = get();
    return discoveredModels.filter(m => m.source === sourceId);
  },
  
  getModelsByTypeLocal: (modelType) => {
    const { discoveredModels } = get();
    return discoveredModels.filter(m => m.modelType === modelType);
  },
  
  getScanStats: () => {
    const { discoveredModels } = get();
    const byType = {};
    const bySource = {};
    let totalSize = 0;
    
    for (const model of discoveredModels) {
      byType[model.modelType] = (byType[model.modelType] || 0) + 1;
      bySource[model.source] = (bySource[model.source] || 0) + 1;
      totalSize += model.size || 0;
    }
    
    return {
      total: discoveredModels.length,
      byType,
      bySource,
      totalSize,
    };
  },
});



