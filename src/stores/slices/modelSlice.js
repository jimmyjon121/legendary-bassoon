// Model state management slice
// Handles model selection, availability, and status

export const createModelSlice = (set, get) => ({
  // State
  currentModel: null,
  availableModels: [],
  modelStatus: 'offline', // 'offline' | 'loading' | 'online' | 'warming'
  isWarmingUp: false,

  // Actions
  setModel: async (model) => {
    set({ currentModel: model, modelStatus: 'loading' });
    await window.electronAPI?.setSettings('currentModel', model);
    set({ modelStatus: 'online' });
    
    // Auto-warmup: preload model to GPU in the background
    // This ensures GPU is utilized immediately when user starts chatting
    if (model && window.electronAPI?.warmupModel) {
      set({ isWarmingUp: true, modelStatus: 'warming' });
      try {
        console.log(`[Model] Auto-warming up "${model}" to GPU...`);
        await window.electronAPI.warmupModel(model);
        console.log(`[Model] "${model}" loaded to GPU memory`);
      } catch (error) {
        // Non-fatal: model will load on first inference anyway
        console.warn(`[Model] Warmup failed (will load on first use):`, error.message);
      } finally {
        set({ isWarmingUp: false, modelStatus: 'online' });
      }
    }
  },
  
  // Manual warmup for explicit GPU preloading
  warmupCurrentModel: async () => {
    const model = get().currentModel;
    if (!model || !window.electronAPI?.warmupModel) {
      return { success: false, error: 'No model selected or warmup not available' };
    }
    
    set({ isWarmingUp: true });
    try {
      const result = await window.electronAPI.warmupModel(model);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      set({ isWarmingUp: false });
    }
  },

  refreshModels: async () => {
    try {
      const health = await window.electronAPI?.checkLLMHealth();
      if (!health?.healthy) {
        set({ 
          availableModels: [],
          modelStatus: 'offline',
          error: health?.error || 'Ollama backend is not available'
        });
        return;
      }
      
      const models = await window.electronAPI?.getModels() || [];
      set({ 
        availableModels: models,
        modelStatus: models.length > 0 ? 'online' : 'offline'
      });
    } catch (error) {
      console.error('Failed to refresh models:', error);
      set({ 
        availableModels: [],
        modelStatus: 'offline',
        error: error.message || 'Failed to connect to Ollama'
      });
    }
  },
});


