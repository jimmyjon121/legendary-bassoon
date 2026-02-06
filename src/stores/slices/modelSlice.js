// Model state management slice
// Handles model selection, availability, and status

export const createModelSlice = (set, get) => ({
  // State
  currentModel: null,
  availableModels: [],
  modelStatus: 'offline', // 'offline' | 'loading' | 'online' | 'warming'
  isWarmingUp: false,
  
  // Real metadata from Ollama /api/show (populated on model switch)
  currentModelInfo: null,
  // Auto-tuner recommendation (hardware vs model fit)
  autoTuneResult: null,

  // Actions
  setModel: async (model) => {
    set({ currentModel: model, modelStatus: 'loading', currentModelInfo: null, autoTuneResult: null });
    await window.electronAPI?.setSettings('currentModel', model);
    set({ modelStatus: 'online' });
    
    // ── 1. Query Ollama for REAL model metadata ──
    // This eliminates guessing from filenames: we get family, param size,
    // quantization, and context length straight from the model file.
    if (model && window.electronAPI?.getModelInfo) {
      try {
        const info = await window.electronAPI.getModelInfo(model);
        if (info?.success) {
          set({ currentModelInfo: info });
          console.log(`[Model] Metadata for "${model}":`, {
            family: info.family,
            size: info.parameterSize,
            quant: info.quantizationLevel,
            context: info.contextLength,
          });
        }
      } catch (error) {
        console.warn(`[Model] Metadata query skipped:`, error.message);
      }
    }
    
    // ── 2. Auto-tune: get hardware-optimized parameters ──
    if (model && window.electronAPI?.autoTuneModel) {
      try {
        const tuneResult = await window.electronAPI.autoTuneModel(model);
        if (tuneResult?.success && tuneResult.recommendation) {
          set({ autoTuneResult: tuneResult.recommendation });
          console.log(`[Model] Auto-tuned "${model}":`, tuneResult.recommendation);
        }
      } catch (error) {
        // Non-fatal: optimizer defaults will be used
        console.warn(`[Model] Auto-tune skipped:`, error.message);
      }
    }
    
    // ── 3. Auto-warmup: preload model to GPU ──
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


