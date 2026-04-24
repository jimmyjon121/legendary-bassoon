/**
 * Adaptive Generation Engine
 *
 * Hardware-aware optimization with strict resource guardrails:
 * 1. Monitor GPU/RAM/NPU usage before generation
 * 2. Dynamically adjust context, batch, and offload options
 * 3. Keep acceleration enabled while preventing RAM runaway
 * 4. Prioritize responsiveness when multitasking
 */

import { create } from 'zustand';
import { api } from '../utils/electronAPI';

// Default generation profiles
// Tuned to preserve system responsiveness under normal multitasking.
const PROFILES = {
  performance: {
    name: 'Performance',
    contextLength: 8192,
    numPredict: 768,
    numBatch: 192,
    numGpu: -1,
    temperature: 0.7,
    flashAttention: true,
    kvCacheQuant: 'q8_0',
  },
  balanced: {
    name: 'Balanced',
    contextLength: 12288,
    numPredict: 1024,
    numBatch: 224,
    numGpu: -1,
    temperature: 0.7,
    flashAttention: true,
    kvCacheQuant: 'q8_0',
  },
  quality: {
    name: 'Quality',
    contextLength: 16384,
    numPredict: 1536,
    numBatch: 256,
    numGpu: -1,
    temperature: 0.8,
    flashAttention: true,
    kvCacheQuant: 'q4_0',
  },
  lowMemory: {
    name: 'Low Memory',
    contextLength: 4096,
    numPredict: 512,
    numBatch: 96,
    numGpu: 12,
    temperature: 0.7,
    flashAttention: true,
    kvCacheQuant: 'q4_0',
  },
};

export const useAdaptiveGeneration = create((set, get) => ({
  // Current profile
  currentProfile: 'balanced',
  customOptions: null,
  
  // Hardware snapshot (updated before generation)
  hardwareSnapshot: null,
  
  // Auto-adapt enabled
  autoAdapt: true,
  
  // Generation metrics
  metrics: {
    lastTokensPerSecond: 0,
    averageTokensPerSecond: 0,
    generationCount: 0,
  },

  // Set profile manually
  setProfile: (profileName) => {
    if (PROFILES[profileName]) {
      set({ currentProfile: profileName, customOptions: null });
    }
  },

  // Toggle auto-adaptation
  setAutoAdapt: (enabled) => set({ autoAdapt: enabled }),

  // Get optimal options based on current hardware state
  getOptimalOptions: async () => {
    const state = get();
    
    if (!state.autoAdapt) {
      return PROFILES[state.currentProfile] || PROFILES.balanced;
    }

    try {
      // Get fresh hardware stats
      const stats = await api.getHardwareStats();
      set({ hardwareSnapshot: stats });

      if (!stats || stats.error) {
        return PROFILES.balanced;
      }

      // User intent from the global performance system (Settings → Performance Profile)
      // speed | balanced | efficiency
      const perfIntent = await api.getPerformanceProfile();

      const { memory, gpus, npu } = stats;
      
      // Calculate available resources
      const ramAvailableGB = memory?.available || 8;
      const ramTotalGB = memory?.total || 16;
      const ramUsagePercent = memory?.usagePercent || 50;
      const gpu = gpus?.[0];
      const vramTotalMB = gpu?.vramTotal || 0;
      const vramUsedMB = gpu?.vramUsed || 0;
      const vramAvailableMB = vramTotalMB - vramUsedMB;
      const gpuUsage = gpu?.utilizationGpu || 0;
      const isNvidiaGpu = gpu?.name?.toLowerCase().includes('nvidia') || gpu?.name?.toLowerCase().includes('geforce') || gpu?.name?.toLowerCase().includes('rtx') || gpu?.name?.toLowerCase().includes('gtx');
      const hasNpu = npu?.detected || false;

      // Decision logic -- be AGGRESSIVE about GPU utilization
      let profile = 'balanced';
      let customOptions = null;

      // Critical memory pressure - switch to low memory mode
      if (ramUsagePercent > 90 || ramAvailableGB < 2) {
        profile = 'lowMemory';
      }
      // Lots of VRAM and RAM - use quality mode (max context)
      else if (vramAvailableMB > 8000 && ramAvailableGB > 8) {
        profile = 'quality';
      }
      // Decent VRAM available - balanced with generous context
      else if (vramAvailableMB > 4000 || ramAvailableGB > 16) {
        profile = 'balanced';
      }
      // GPU under heavy load from other apps
      else if (gpuUsage > 80 && vramAvailableMB < 2000) {
        profile = 'lowMemory';
      }
      // Default to performance for fast inference
      else {
        profile = 'performance';
      }

      // === USER INTENT OVERRIDE (connected to performance system) ===
      // Keep auto-adaptation, but bias the selected profile toward the user's preference.
      // - speed: prefer fastest (performance) unless under memory pressure
      // - efficiency: avoid max-context modes; prefer balanced/lowMemory
      if (perfIntent === 'speed' && profile !== 'lowMemory') {
        profile = 'performance';
      } else if (perfIntent === 'efficiency') {
        if (profile === 'quality') profile = 'balanced';
        if (profile === 'performance') profile = 'balanced';
      }

      // === VRAM-BASED FINE-TUNING ===
      // Keep acceleration aggressive but cap memory-heavy knobs.
      const baseProfile = PROFILES[profile];
      customOptions = { ...baseProfile };

      if (vramTotalMB > 0) {
        // Prefer full offload for dedicated GPUs.
        if (isNvidiaGpu || vramTotalMB >= 4000) {
          customOptions.numGpu = -1;
        }

        if (vramTotalMB >= 24000) {
          customOptions.contextLength = 16384;
          customOptions.numBatch = 256;
          customOptions.numPredict = 1536;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q8_0';
        } else if (vramTotalMB >= 16000) {
          customOptions.contextLength = 12288;
          customOptions.numBatch = 224;
          customOptions.numPredict = 1280;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q8_0';
        } else if (vramTotalMB >= 12000) {
          customOptions.contextLength = 10240;
          customOptions.numBatch = 192;
          customOptions.numPredict = 1024;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q4_0';
        } else if (vramTotalMB >= 8000) {
          customOptions.contextLength = 8192;
          customOptions.numBatch = 160;
          customOptions.numPredict = 768;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q4_0';
        } else if (vramTotalMB >= 6000) {
          customOptions.contextLength = 6144;
          customOptions.numBatch = 128;
          customOptions.numPredict = 512;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q4_0';
        } else if (vramTotalMB >= 4000) {
          customOptions.contextLength = 4096;
          customOptions.numBatch = 96;
          customOptions.numPredict = 256;
          customOptions.numGpu = -1;
          customOptions.flashAttention = true;
          customOptions.kvCacheQuant = 'q4_0';
        } else {
          customOptions.contextLength = 3072;
          customOptions.numBatch = 64;
          customOptions.numPredict = 256;
          customOptions.numGpu = 8;
        }
      } else if (ramTotalGB >= 32) {
        customOptions.contextLength = 8192;
        customOptions.numBatch = 128;
        customOptions.numGpu = 0;
      } else if (ramTotalGB >= 16) {
        customOptions.contextLength = 4096;
        customOptions.numBatch = 96;
        customOptions.numGpu = 0;
      }

      // Apply efficiency intent as a *final* conservative cap (don't fight hardware, just tone down).
      if (perfIntent === 'efficiency') {
        customOptions.numBatch = Math.min(customOptions.numBatch || 96, 128);
        customOptions.numPredict = Math.min(customOptions.numPredict || 512, 1024);
        customOptions.contextLength = Math.min(customOptions.contextLength || 4096, 8192);
      }

      // Hard global safety caps to avoid RAM starvation.
      customOptions.contextLength = Math.max(1024, Math.min(customOptions.contextLength || 4096, 16384));
      customOptions.numPredict = Math.max(64, Math.min(customOptions.numPredict || 512, 1536));
      customOptions.numBatch = Math.max(32, Math.min(customOptions.numBatch || 96, 256));

      // === NPU STATUS TRACKING ===
      if (hasNpu) {
        customOptions._npuAvailable = true;
        customOptions._npuActive = npu?.active || false;
      }

      set({ currentProfile: profile, customOptions });
      
      return customOptions || PROFILES[profile];
    } catch (error) {
      console.warn('Failed to get optimal options:', error);
      return PROFILES.balanced;
    }
  },

  // Build Ollama options object with all GPU/NPU optimizations
  buildOllamaOptions: async () => {
    const optimal = await get().getOptimalOptions();
    
    const options = {
      num_ctx: optimal.contextLength,
      num_predict: optimal.numPredict,
      num_batch: optimal.numBatch,
      num_gpu: optimal.numGpu,
      temperature: optimal.temperature,
    };

    // Flash attention: dramatically speeds up inference for long contexts
    // Supported in Ollama 0.4+ with compatible models
    if (optimal.flashAttention) {
      options.flash_attn = true;
    }

    // KV cache quantization: reduces VRAM usage for KV cache, allowing
    // larger contexts to fit in the same VRAM
    if (optimal.kvCacheQuant) {
      options.kv_cache_type = optimal.kvCacheQuant;
    }

    // Ensure num_thread is set for optimal CPU utilization
    // (for CPU-bound operations and layers that stay on CPU)
    try {
      const cpuCount = navigator?.hardwareConcurrency || 8;
      options.num_thread = Math.max(4, cpuCount - 2); // Leave 2 cores for the system
    } catch {
      options.num_thread = 6; // Safe default
    }

    return options;
  },

  // Record generation metrics
  recordGeneration: (tokensGenerated, durationMs) => {
    const tokensPerSecond = tokensGenerated / (durationMs / 1000);
    
    set(state => {
      const newCount = state.metrics.generationCount + 1;
      const newAverage = (
        (state.metrics.averageTokensPerSecond * state.metrics.generationCount) + tokensPerSecond
      ) / newCount;

      return {
        metrics: {
          lastTokensPerSecond: tokensPerSecond,
          averageTokensPerSecond: newAverage,
          generationCount: newCount,
        }
      };
    });
  },

  // Get current status string
  getStatusString: () => {
    const state = get();
    const profile = PROFILES[state.currentProfile];
    const snapshot = state.hardwareSnapshot;
    
    let status = `${profile?.name || 'Unknown'} mode`;
    
    if (snapshot) {
      const ramPct = snapshot.memory?.usagePercent || 0;
      const gpu = snapshot.gpus?.[0];
      
      if (gpu) {
        status += ` | GPU: ${gpu.utilizationGpu || 0}%`;
      }
      status += ` | RAM: ${ramPct.toFixed(0)}%`;
    }
    
    if (state.metrics.lastTokensPerSecond > 0) {
      status += ` | ${state.metrics.lastTokensPerSecond.toFixed(1)} tok/s`;
    }
    
    return status;
  },

  // Get all profiles for UI
  getProfiles: () => PROFILES,
}));

/**
 * Hook to wrap generation with adaptive optimization
 * 
 * Usage:
 * const { generateWithAdaptation } = useAdaptiveHook();
 * 
 * const response = await generateWithAdaptation(prompt, model);
 */
export async function generateWithAdaptation(prompt, model, ollamaEndpoint = 'http://127.0.0.1:11434') {
  const store = useAdaptiveGeneration.getState();
  const options = await store.buildOllamaOptions();
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${ollamaEndpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options,
      })
    });

    if (!response.ok) throw new Error('Generation failed');
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = (data.response?.length || 0) / 4;
    store.recordGeneration(estimatedTokens, duration);
    
    return data;
  } catch (error) {
    console.error('Adaptive generation failed:', error);
    throw error;
  }
}

export default useAdaptiveGeneration;



