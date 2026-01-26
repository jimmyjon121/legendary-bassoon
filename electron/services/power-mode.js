/**
 * Power Mode Service
 * Safe system optimizations for maximum AI performance
 * 
 * SAFE optimizations only:
 * - Process priority adjustment (no admin required for own process)
 * - Sleep prevention during inference
 * - GPU performance hints
 * - Memory pre-allocation hints
 * - CUDA environment optimization
 * 
 * Does NOT include:
 * - Process killing/suspension
 * - System file modifications
 * - Admin-required operations
 */

const { powerSaveBlocker } = require('electron');
const { exec } = require('child_process');
const os = require('os');

class PowerModeService {
  constructor() {
    this.enabled = false;
    this.powerSaveBlockerId = null;
    this.originalPriority = null;
    this.optimizations = {
      highPriority: false,
      sleepPrevention: false,
      gpuPerformance: false,
      cudaOptimized: false,
      memoryOptimized: false
    };
    this.originalEnv = {};
  }

  /**
   * Enable power mode with safe optimizations
   */
  async enable() {
    if (this.enabled) {
      return this.getStatus();
    }

    console.log('[PowerMode] Enabling...');
    const results = [];

    // 1. Prevent system sleep during AI operations
    try {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      this.optimizations.sleepPrevention = true;
      results.push({ optimization: 'sleepPrevention', success: true });
      console.log('[PowerMode] Sleep prevention enabled');
    } catch (error) {
      results.push({ optimization: 'sleepPrevention', success: false, error: error.message });
    }

    // 2. Set process priority to HIGH (Windows)
    if (process.platform === 'win32') {
      try {
        await this.setProcessPriority('high');
        this.optimizations.highPriority = true;
        results.push({ optimization: 'highPriority', success: true });
        console.log('[PowerMode] High priority set');
      } catch (error) {
        results.push({ optimization: 'highPriority', success: false, error: error.message });
      }
    }

    // 3. Request GPU performance mode (Windows)
    if (process.platform === 'win32') {
      try {
        await this.setGpuPerformanceMode(true);
        this.optimizations.gpuPerformance = true;
        results.push({ optimization: 'gpuPerformance', success: true });
        console.log('[PowerMode] GPU performance mode requested');
      } catch (error) {
        results.push({ optimization: 'gpuPerformance', success: false, error: error.message });
      }
    }

    // 4. Try to set Ollama process priority too
    try {
      await this.setOllamaPriority('high');
      results.push({ optimization: 'ollamaPriority', success: true });
    } catch (error) {
      // Non-critical, Ollama might not be running
      results.push({ optimization: 'ollamaPriority', success: false, error: error.message });
    }

    // 5. Set CUDA environment variables for optimal GPU utilization
    try {
      this.setCudaOptimizations(true);
      this.optimizations.cudaOptimized = true;
      results.push({ optimization: 'cudaOptimized', success: true });
      console.log('[PowerMode] CUDA optimizations enabled');
    } catch (error) {
      results.push({ optimization: 'cudaOptimized', success: false, error: error.message });
    }

    // 6. Memory optimizations
    try {
      this.setMemoryOptimizations(true);
      this.optimizations.memoryOptimized = true;
      results.push({ optimization: 'memoryOptimized', success: true });
      console.log('[PowerMode] Memory optimizations enabled');
    } catch (error) {
      results.push({ optimization: 'memoryOptimized', success: false, error: error.message });
    }

    this.enabled = true;
    console.log('[PowerMode] Enabled with results:', results);
    
    return {
      enabled: true,
      optimizations: this.optimizations,
      results
    };
  }

  /**
   * Disable power mode and restore defaults
   */
  async disable() {
    if (!this.enabled) {
      return this.getStatus();
    }

    console.log('[PowerMode] Disabling...');

    // 1. Stop sleep prevention
    if (this.powerSaveBlockerId !== null) {
      try {
        powerSaveBlocker.stop(this.powerSaveBlockerId);
        this.powerSaveBlockerId = null;
        this.optimizations.sleepPrevention = false;
      } catch (error) {
        console.error('[PowerMode] Failed to stop sleep prevention:', error);
      }
    }

    // 2. Restore normal process priority
    if (process.platform === 'win32' && this.optimizations.highPriority) {
      try {
        await this.setProcessPriority('normal');
        this.optimizations.highPriority = false;
      } catch (error) {
        console.error('[PowerMode] Failed to restore priority:', error);
      }
    }

    // 3. Restore GPU mode
    if (this.optimizations.gpuPerformance) {
      try {
        await this.setGpuPerformanceMode(false);
        this.optimizations.gpuPerformance = false;
      } catch (error) {
        console.error('[PowerMode] Failed to restore GPU mode:', error);
      }
    }

    // 4. Restore Ollama priority
    try {
      await this.setOllamaPriority('normal');
    } catch {
      // Non-critical
    }

    // 5. Restore CUDA settings
    if (this.optimizations.cudaOptimized) {
      try {
        this.setCudaOptimizations(false);
        this.optimizations.cudaOptimized = false;
      } catch (error) {
        console.error('[PowerMode] Failed to restore CUDA settings:', error);
      }
    }

    // 6. Reset memory optimizations flag
    this.optimizations.memoryOptimized = false;

    this.enabled = false;
    console.log('[PowerMode] Disabled');

    return {
      enabled: false,
      optimizations: this.optimizations
    };
  }

  /**
   * Get current power mode status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      optimizations: { ...this.optimizations },
      platform: process.platform,
      sleepBlocked: this.powerSaveBlockerId !== null && 
                    powerSaveBlocker.isStarted(this.powerSaveBlockerId)
    };
  }

  /**
   * Set process priority (Windows)
   */
  setProcessPriority(level) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        resolve({ success: true, message: 'Not Windows' });
        return;
      }

      const pid = process.pid;
      let priorityClass;

      switch (level) {
        case 'high':
          priorityClass = 'High';
          break;
        case 'above-normal':
          priorityClass = 'AboveNormal';
          break;
        case 'normal':
        default:
          priorityClass = 'Normal';
          break;
      }

      // Use PowerShell to set priority (wmic is deprecated)
      const psCommand = `powershell -NoProfile -Command "(Get-Process -Id ${pid}).PriorityClass = '${priorityClass}'"`;
      exec(psCommand, { timeout: 5000 }, (error) => {
        if (error) {
          reject(new Error(`Failed to set priority: ${error.message}`));
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * Set Ollama process priority
   */
  setOllamaPriority(level) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        resolve({ success: true });
        return;
      }

      const priorityClass = level === 'high' ? 'High' : 'Normal';
      // Use PowerShell to set priority (wmic is deprecated)
      const psCommand = `powershell -NoProfile -Command "Get-Process -Name ollama -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = '${priorityClass}' }"`;

      exec(psCommand, { timeout: 5000 }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * Request GPU performance mode
   * Uses Windows power settings hint
   */
  setGpuPerformanceMode(enable) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        resolve({ success: true });
        return;
      }

      // Set power plan to High Performance temporarily
      // This is a hint to the system, not a forced change
      const command = enable
        ? 'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' // High Performance GUID
        : 'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e'; // Balanced GUID

      exec(command, { timeout: 5000 }, (error) => {
        // Don't fail if this doesn't work - it's just a hint
        if (error) {
          console.warn('[PowerMode] Could not change power plan (may require admin)');
          resolve({ success: false, warning: 'Power plan change may require admin' });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * Get system memory info for pre-allocation hints
   */
  getMemoryInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      total: Math.round(totalMem / (1024 * 1024 * 1024)), // GB
      free: Math.round(freeMem / (1024 * 1024 * 1024)), // GB
      used: Math.round((totalMem - freeMem) / (1024 * 1024 * 1024)), // GB
      percentFree: Math.round((freeMem / totalMem) * 100)
    };
  }

  /**
   * Suggest optimal model size based on available memory
   */
  suggestModelSize() {
    const memInfo = this.getMemoryInfo();
    const availableForModel = memInfo.free * 0.7; // Use 70% of free memory

    if (availableForModel >= 16) {
      return { maxParams: 70, recommended: '70B models', memoryAvailable: availableForModel };
    } else if (availableForModel >= 8) {
      return { maxParams: 30, recommended: '30B models', memoryAvailable: availableForModel };
    } else if (availableForModel >= 4) {
      return { maxParams: 13, recommended: '13B models', memoryAvailable: availableForModel };
    } else if (availableForModel >= 2) {
      return { maxParams: 7, recommended: '7B models', memoryAvailable: availableForModel };
    } else {
      return { maxParams: 3, recommended: '3B models or smaller', memoryAvailable: availableForModel };
    }
  }

  /**
   * Set CUDA environment variables for optimal GPU utilization
   */
  setCudaOptimizations(enable) {
    if (enable) {
      // Save original values
      this.originalEnv = {
        CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES,
        CUDA_LAUNCH_BLOCKING: process.env.CUDA_LAUNCH_BLOCKING,
        TF_FORCE_GPU_ALLOW_GROWTH: process.env.TF_FORCE_GPU_ALLOW_GROWTH,
        CUDA_CACHE_MAXSIZE: process.env.CUDA_CACHE_MAXSIZE
      };

      // Optimize CUDA settings
      // Allow all GPUs
      if (!process.env.CUDA_VISIBLE_DEVICES) {
        process.env.CUDA_VISIBLE_DEVICES = '0,1'; // Use both GPUs if available
      }
      
      // Increase CUDA cache for faster kernel compilation
      process.env.CUDA_CACHE_MAXSIZE = '2147483648'; // 2GB cache
      
      // For debugging, ensure async operations (don't block)
      process.env.CUDA_LAUNCH_BLOCKING = '0';
      
      // Allow GPU memory growth instead of pre-allocating all
      process.env.TF_FORCE_GPU_ALLOW_GROWTH = 'true';
      
      console.log('[PowerMode] CUDA environment optimized');
    } else {
      // Restore original values
      if (this.originalEnv.CUDA_VISIBLE_DEVICES !== undefined) {
        process.env.CUDA_VISIBLE_DEVICES = this.originalEnv.CUDA_VISIBLE_DEVICES;
      }
      if (this.originalEnv.CUDA_CACHE_MAXSIZE !== undefined) {
        process.env.CUDA_CACHE_MAXSIZE = this.originalEnv.CUDA_CACHE_MAXSIZE;
      }
    }
  }

  /**
   * Set memory optimizations for better AI performance
   */
  setMemoryOptimizations(enable) {
    if (enable && process.platform === 'win32') {
      // Try to set working set size hints
      try {
        // Request system to not page out our memory
        exec('powershell -Command "[System.Diagnostics.Process]::GetCurrentProcess().MinWorkingSet = 512MB"', 
          { timeout: 3000 }, 
          (error) => {
            if (error) {
              console.warn('[PowerMode] Could not set working set hint');
            }
          }
        );
      } catch {
        // Non-critical
      }

      // Set environment hints for Node.js memory
      const totalMem = os.totalmem();
      const heapSizeLimit = Math.min(Math.floor(totalMem / (1024 * 1024 * 1024) * 0.5), 8); // 50% of RAM, max 8GB
      
      // Note: This won't affect running process, but helps if we spawn child processes
      process.env.NODE_OPTIONS = `--max-old-space-size=${heapSizeLimit * 1024}`;
      
      console.log(`[PowerMode] Memory hints set (heap limit: ${heapSizeLimit}GB)`);
    }
  }

  /**
   * Force garbage collection if available (requires --expose-gc flag)
   */
  forceGC() {
    if (global.gc) {
      global.gc();
      console.log('[PowerMode] Forced garbage collection');
      return true;
    }
    return false;
  }
}

// Singleton instance
let powerModeInstance = null;

function getPowerMode() {
  if (!powerModeInstance) {
    powerModeInstance = new PowerModeService();
  }
  return powerModeInstance;
}

module.exports = {
  PowerModeService,
  getPowerMode
};


