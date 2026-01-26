/**
 * Installer Slice - Manages model installation state
 * Integrates with InstallerRegistry backend
 */

// Engine IDs (mirror from backend)
export const Engine = {
  OLLAMA: 'ollama',
  LLAMACPP: 'llamacpp',
  COMFYUI: 'comfyui',
  A1111: 'automatic1111',
  DIFFUSERS: 'diffusers',
  ONNX: 'onnx',
  OPENVINO: 'openvino',
  WHISPER: 'whisper',
  COQUI: 'coqui',
};

// Model types (mirror from backend)
export const ModelType = {
  LLM: 'llm',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  EMBEDDING: 'embedding',
  VISION: 'vision',
  LORA: 'lora',
  VAE: 'vae',
  CONTROLNET: 'controlnet',
};

export const createInstallerSlice = (set, get) => ({
  // State
  availableEngines: [],
  enginesLoading: false,
  installerInitialized: false,
  activeInstallations: [], // { modelInfo, engineId, status, progress }
  pendingDependencies: null, // { model, dependencies }
  
  // Actions
  initializeInstaller: async () => {
    if (get().installerInitialized) return;
    
    set({ enginesLoading: true });
    
    try {
      // Load available engines
      const engines = await window.electronAPI?.installerGetEngines?.() || [];
      set({ 
        availableEngines: engines,
        installerInitialized: true,
        enginesLoading: false,
      });
      
      // Set up event listeners
      get().setupInstallerListeners();
    } catch (error) {
      console.error('[InstallerSlice] Failed to initialize:', error);
      set({ enginesLoading: false });
    }
  },
  
  setupInstallerListeners: () => {
    const api = window.electronAPI;
    if (!api) return;
    
    // Installation started
    api.onInstallerStarted?.((data) => {
      set((state) => ({
        activeInstallations: [
          ...state.activeInstallations,
          { ...data, status: 'installing', progress: 0 },
        ],
      }));
    });
    
    // Installation progress
    api.onInstallerProgress?.((data) => {
      set((state) => ({
        activeInstallations: state.activeInstallations.map(inst =>
          inst.modelInfo?.name === data.modelInfo?.name
            ? { ...inst, ...data, status: 'installing' }
            : inst
        ),
      }));
    });
    
    // Installation completed
    api.onInstallerCompleted?.((data) => {
      set((state) => ({
        activeInstallations: state.activeInstallations.map(inst =>
          inst.modelInfo?.name === data.modelInfo?.name
            ? { ...inst, ...data, status: 'completed', progress: 100 }
            : inst
        ),
      }));
    });
    
    // Dependencies required
    api.onInstallerDependenciesRequired?.((data) => {
      set({ pendingDependencies: data });
    });
    
    // Uninstall completed
    api.onInstallerUninstallCompleted?.((data) => {
      // Optionally update some state
      console.log('[InstallerSlice] Uninstall completed:', data);
    });
  },
  
  // Get available engines
  refreshEngines: async () => {
    set({ enginesLoading: true });
    try {
      const engines = await window.electronAPI?.installerGetEngines?.() || [];
      set({ availableEngines: engines, enginesLoading: false });
      return engines;
    } catch (error) {
      console.error('[InstallerSlice] Failed to refresh engines:', error);
      set({ enginesLoading: false });
      return [];
    }
  },
  
  // Get engines for model type
  getEnginesForType: async (modelType) => {
    try {
      return await window.electronAPI?.installerGetEnginesForType?.(modelType) || [];
    } catch (error) {
      console.error('[InstallerSlice] Failed to get engines for type:', error);
      return [];
    }
  },
  
  // Get recommended engine
  getRecommendedEngine: async (modelInfo) => {
    try {
      return await window.electronAPI?.installerGetRecommendedEngine?.(modelInfo);
    } catch (error) {
      console.error('[InstallerSlice] Failed to get recommended engine:', error);
      return null;
    }
  },
  
  // Install a model
  installModel: async (filePath, modelInfo, options = {}) => {
    try {
      // Add to active installations optimistically
      set((state) => ({
        activeInstallations: [
          ...state.activeInstallations,
          { modelInfo, status: 'starting', progress: 0 },
        ],
      }));
      
      const result = await window.electronAPI?.installerInstall?.(filePath, modelInfo, options);
      
      if (!result?.success) {
        // Update status to error
        set((state) => ({
          activeInstallations: state.activeInstallations.map(inst =>
            inst.modelInfo?.name === modelInfo?.name
              ? { ...inst, status: 'error', error: result?.error }
              : inst
          ),
        }));
      }
      
      return result;
    } catch (error) {
      console.error('[InstallerSlice] Install failed:', error);
      set((state) => ({
        activeInstallations: state.activeInstallations.map(inst =>
          inst.modelInfo?.name === modelInfo?.name
            ? { ...inst, status: 'error', error: error.message }
            : inst
        ),
      }));
      throw error;
    }
  },
  
  // Validate a model
  validateModel: async (modelInfo, engineId) => {
    try {
      return await window.electronAPI?.installerValidate?.(modelInfo, engineId);
    } catch (error) {
      console.error('[InstallerSlice] Validation failed:', error);
      return { valid: false, error: error.message };
    }
  },
  
  // Run readiness check
  checkModelReadiness: async (modelInfo, engineId) => {
    try {
      return await window.electronAPI?.installerReadinessCheck?.(modelInfo, engineId);
    } catch (error) {
      console.error('[InstallerSlice] Readiness check failed:', error);
      return { ready: false, error: error.message };
    }
  },
  
  // Uninstall a model
  uninstallModel: async (modelInfo, engineId) => {
    try {
      const result = await window.electronAPI?.installerUninstall?.(modelInfo, engineId);
      return result;
    } catch (error) {
      console.error('[InstallerSlice] Uninstall failed:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Set engine path
  setEnginePath: async (engineId, enginePath) => {
    try {
      const result = await window.electronAPI?.installerSetEnginePath?.(engineId, enginePath);
      if (result?.success) {
        // Refresh engines after path change
        await get().refreshEngines();
      }
      return result;
    } catch (error) {
      console.error('[InstallerSlice] Set engine path failed:', error);
      return { success: false, error: error.message };
    }
  },
  
  // Clear pending dependencies
  clearPendingDependencies: () => {
    set({ pendingDependencies: null });
  },
  
  // Clear completed installations
  clearCompletedInstallations: () => {
    set((state) => ({
      activeInstallations: state.activeInstallations.filter(
        inst => inst.status !== 'completed' && inst.status !== 'error'
      ),
    }));
  },
  
  // Selectors
  getEngineById: (engineId) => {
    const { availableEngines } = get();
    return availableEngines.find(e => e.engineId === engineId);
  },
  
  getActiveInstallationsCount: () => {
    const { activeInstallations } = get();
    return activeInstallations.filter(inst => 
      inst.status === 'installing' || inst.status === 'starting'
    ).length;
  },
});



