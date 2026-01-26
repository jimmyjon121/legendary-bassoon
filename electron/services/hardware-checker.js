/**
 * HardwareChecker - Deep hardware analysis for model compatibility
 * 
 * Features:
 * - Detailed VRAM/RAM/disk detection
 * - Multi-GPU support with selection
 * - Quantization recommendations
 * - Estimated throughput/latency
 * - CPU capability flags (AVX, AVX2, AVX-512)
 * - NPU/accelerator detection
 */

const { EventEmitter } = require('events');
const os = require('os');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Model size estimates (in billions of parameters)
const MODEL_SIZES = {
  '1B': 1,
  '3B': 3,
  '7B': 7,
  '8B': 8,
  '13B': 13,
  '14B': 14,
  '30B': 30,
  '34B': 34,
  '70B': 70,
  '72B': 72,
  '180B': 180,
};

// Quantization VRAM requirements (GB per billion parameters)
const QUANT_VRAM_PER_B = {
  'FP16': 2.0,
  'Q8_0': 1.1,
  'Q6_K': 0.85,
  'Q5_K_M': 0.7,
  'Q5_K_S': 0.68,
  'Q4_K_M': 0.6,
  'Q4_K_S': 0.58,
  'Q4_0': 0.55,
  'Q3_K_M': 0.5,
  'Q3_K_S': 0.48,
  'Q2_K': 0.4,
  'IQ4_XS': 0.5,
  'IQ3_XXS': 0.4,
  'IQ2_XXS': 0.35,
};

// Base VRAM overhead for inference (GB)
const VRAM_OVERHEAD_GB = 0.5;

// Throughput estimates (tokens/second per TFLOPS)
const TOKENS_PER_TFLOPS = {
  'Q4_K_M': 8,
  'Q4_0': 9,
  'Q5_K_M': 6,
  'Q8_0': 4,
  'FP16': 2,
};

/**
 * HardwareChecker class
 */
class HardwareChecker extends EventEmitter {
  constructor() {
    super();
    this.cache = null;
    this.cacheExpiry = 60 * 1000; // 1 minute cache
    this.lastCheck = 0;
  }

  /**
   * Get comprehensive hardware info
   */
  async getHardwareInfo(forceRefresh = false) {
    if (!forceRefresh && this.cache && Date.now() - this.lastCheck < this.cacheExpiry) {
      return this.cache;
    }
    
    const info = {
      cpu: await this.getCpuInfo(),
      memory: this.getMemoryInfo(),
      gpus: await this.getGpuInfo(),
      disk: await this.getDiskInfo(),
      npu: await this.getNpuInfo(),
      platform: {
        os: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
      },
    };
    
    // Calculate overall capability
    info.capability = this.calculateCapability(info);
    
    this.cache = info;
    this.lastCheck = Date.now();
    
    return info;
  }

  /**
   * Get CPU information
   */
  async getCpuInfo() {
    const cpus = os.cpus();
    const cpu = cpus[0] || {};
    
    const info = {
      model: cpu.model || 'Unknown',
      cores: cpus.length,
      physicalCores: this.getPhysicalCores(),
      speed: cpu.speed || 0,
      architecture: os.arch(),
      features: await this.getCpuFeatures(),
    };
    
    return info;
  }

  getPhysicalCores() {
    try {
      if (process.platform === 'win32') {
        // Use PowerShell Get-CimInstance (wmic is deprecated)
        const result = execSync('powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_Processor).NumberOfCores"', { encoding: 'utf-8' });
        const match = result.match(/\d+/);
        return match ? parseInt(match[0], 10) : os.cpus().length / 2;
      } else if (process.platform === 'darwin') {
        const result = execSync('sysctl -n hw.physicalcpu', { encoding: 'utf-8' });
        return parseInt(result.trim(), 10);
      } else {
        const result = execSync('lscpu | grep "Core(s) per socket"', { encoding: 'utf-8' });
        const match = result.match(/\d+/);
        return match ? parseInt(match[0], 10) : os.cpus().length / 2;
      }
    } catch (e) {
      return Math.floor(os.cpus().length / 2);
    }
  }

  async getCpuFeatures() {
    const features = {
      avx: false,
      avx2: false,
      avx512: false,
      fma: false,
      neon: false, // ARM
    };
    
    try {
      if (process.platform === 'win32') {
        // Windows: check via CPU model string and registry
        const cpuModel = os.cpus()[0]?.model || '';
        // Most modern CPUs support AVX2
        features.avx = cpuModel.includes('Intel') || cpuModel.includes('AMD');
        features.avx2 = cpuModel.includes('Intel') || cpuModel.includes('AMD');
        // AVX-512 only on specific Intel CPUs
        if (cpuModel.includes('Xeon') || cpuModel.includes('i9')) {
          features.avx512 = true;
        }
      } else if (process.platform === 'linux') {
        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
        features.avx = cpuinfo.includes(' avx ') || cpuinfo.includes(' avx\n');
        features.avx2 = cpuinfo.includes(' avx2 ');
        features.avx512 = cpuinfo.includes('avx512');
        features.fma = cpuinfo.includes(' fma ');
      } else if (process.platform === 'darwin') {
        const result = execSync('sysctl -a | grep machdep.cpu.features', { encoding: 'utf-8' });
        features.avx = result.includes('AVX');
        features.avx2 = result.includes('AVX2');
        // Check for Apple Silicon
        if (os.arch() === 'arm64') {
          features.neon = true;
          features.avx = false;
          features.avx2 = false;
        }
      }
    } catch (e) {
      // Default assumptions based on architecture
      if (os.arch() === 'x64') {
        features.avx = true;
        features.avx2 = true;
      } else if (os.arch() === 'arm64') {
        features.neon = true;
      }
    }
    
    return features;
  }

  /**
   * Get memory information
   */
  getMemoryInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      total: totalMem,
      totalGB: Math.round(totalMem / (1024 * 1024 * 1024) * 10) / 10,
      free: freeMem,
      freeGB: Math.round(freeMem / (1024 * 1024 * 1024) * 10) / 10,
      used: totalMem - freeMem,
      usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    };
  }

  /**
   * Get GPU information
   */
  async getGpuInfo() {
    const gpus = [];
    
    // Try nvidia-smi first
    try {
      const nvidiaGpus = await this.getNvidiaGpus();
      gpus.push(...nvidiaGpus);
    } catch (e) {
      // No NVIDIA GPUs or nvidia-smi not available
    }
    
    // Try AMD (rocm-smi)
    try {
      const amdGpus = await this.getAmdGpus();
      gpus.push(...amdGpus);
    } catch (e) {
      // No AMD GPUs
    }
    
    // Try Intel (for Arc GPUs)
    try {
      const intelGpus = await this.getIntelGpus();
      gpus.push(...intelGpus);
    } catch (e) {
      // No Intel discrete GPUs
    }
    
    // Calculate total VRAM
    const totalVram = gpus.reduce((sum, gpu) => sum + gpu.vramTotal, 0);
    const freeVram = gpus.reduce((sum, gpu) => sum + gpu.vramFree, 0);
    
    return {
      count: gpus.length,
      devices: gpus,
      totalVram,
      totalVramGB: Math.round(totalVram / (1024 * 1024 * 1024) * 10) / 10,
      freeVram,
      freeVramGB: Math.round(freeVram / (1024 * 1024 * 1024) * 10) / 10,
      hasCuda: gpus.some(g => g.vendor === 'nvidia'),
      hasRocm: gpus.some(g => g.vendor === 'amd'),
    };
  }

  async getNvidiaGpus() {
    return new Promise((resolve, reject) => {
      exec('nvidia-smi --query-gpu=index,name,memory.total,memory.free,memory.used,temperature.gpu,utilization.gpu,power.draw,compute_cap --format=csv,noheader,nounits', (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        const gpus = [];
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          const parts = line.split(', ').map(p => p.trim());
          if (parts.length >= 9) {
            gpus.push({
              index: parseInt(parts[0], 10),
              name: parts[1],
              vendor: 'nvidia',
              vramTotal: parseInt(parts[2], 10) * 1024 * 1024,
              vramFree: parseInt(parts[3], 10) * 1024 * 1024,
              vramUsed: parseInt(parts[4], 10) * 1024 * 1024,
              temperature: parseInt(parts[5], 10),
              utilization: parseInt(parts[6], 10),
              powerDraw: parseFloat(parts[7]),
              computeCapability: parts[8],
              cudaSupport: true,
              // Estimate TFLOPS based on common GPUs
              estimatedTflops: this.estimateNvidiaTflops(parts[1]),
            });
          }
        }
        
        resolve(gpus);
      });
    });
  }

  estimateNvidiaTflops(gpuName) {
    // Rough TFLOPS estimates for common GPUs (FP16)
    const tflopsMap = {
      '4090': 165,
      '4080': 97,
      '4070': 74,
      '4060': 44,
      '3090': 71,
      '3080': 59,
      '3070': 40,
      '3060': 26,
      'A100': 312,
      'A6000': 77,
      'A5000': 54,
      'A4000': 38,
      'V100': 125,
      'T4': 65,
    };
    
    for (const [key, tflops] of Object.entries(tflopsMap)) {
      if (gpuName.includes(key)) return tflops;
    }
    
    return 20; // Conservative default
  }

  async getAmdGpus() {
    return new Promise((resolve, reject) => {
      exec('rocm-smi --showmeminfo vram --json', (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        try {
          const data = JSON.parse(stdout);
          const gpus = [];
          
          for (const [id, info] of Object.entries(data)) {
            gpus.push({
              index: parseInt(id.replace('card', ''), 10),
              name: info.name || 'AMD GPU',
              vendor: 'amd',
              vramTotal: info['vram Total Memory (B)'] || 0,
              vramFree: (info['vram Total Memory (B)'] || 0) - (info['vram Total Used Memory (B)'] || 0),
              vramUsed: info['vram Total Used Memory (B)'] || 0,
              rocmSupport: true,
            });
          }
          
          resolve(gpus);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async getIntelGpus() {
    // Intel Arc GPU detection
    return new Promise((resolve) => {
      // Try Windows DXDiag or Linux intel_gpu_top
      if (process.platform === 'win32') {
        exec('dxdiag /t dxdiag_output.txt && type dxdiag_output.txt | findstr /i "Arc"', (error, stdout) => {
          if (!error && stdout.includes('Arc')) {
            resolve([{
              index: 0,
              name: 'Intel Arc',
              vendor: 'intel',
              vramTotal: 8 * 1024 * 1024 * 1024, // Assume 8GB
              vramFree: 6 * 1024 * 1024 * 1024,
              oneapiSupport: true,
            }]);
          } else {
            resolve([]);
          }
        });
      } else {
        resolve([]);
      }
    });
  }

  /**
   * Get disk information
   */
  async getDiskInfo() {
    const { getDriveInfo } = require('./storage-service');
    
    try {
      const drives = await getDriveInfo();
      const totalSpace = drives.reduce((sum, d) => sum + d.total, 0);
      const freeSpace = drives.reduce((sum, d) => sum + d.free, 0);
      
      return {
        drives,
        totalSpace,
        totalSpaceGB: Math.round(totalSpace / (1024 * 1024 * 1024)),
        freeSpace,
        freeSpaceGB: Math.round(freeSpace / (1024 * 1024 * 1024)),
      };
    } catch (error) {
      return {
        drives: [],
        totalSpace: 0,
        freeSpace: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get NPU information
   */
  async getNpuInfo() {
    const npu = {
      detected: false,
      type: null,
      capabilities: [],
    };
    
    // Check for Intel NPU (Windows)
    if (process.platform === 'win32') {
      try {
        // Use PowerShell Get-CimInstance (wmic is deprecated)
        const result = execSync('powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.Name -match \'NPU|Neural|AI Boost\' } | Select-Object -ExpandProperty Name"', { encoding: 'utf-8' });
        if (result && (result.includes('Neural') || result.includes('NPU') || result.includes('AI Boost'))) {
          npu.detected = true;
          npu.type = 'intel-npu';
          npu.capabilities = ['int8', 'fp16'];
        }
      } catch (e) {
        // No NPU
      }
    }
    
    // Check for Apple Neural Engine
    if (process.platform === 'darwin' && os.arch() === 'arm64') {
      npu.detected = true;
      npu.type = 'apple-neural-engine';
      npu.capabilities = ['fp16', 'int8', 'coreml'];
    }
    
    return npu;
  }

  /**
   * Calculate overall capability score
   */
  calculateCapability(info) {
    let score = 0;
    let tier = 'basic';
    
    // GPU scoring
    if (info.gpus.totalVramGB >= 24) {
      score += 50;
      tier = 'high-end';
    } else if (info.gpus.totalVramGB >= 12) {
      score += 35;
      tier = 'mid-range';
    } else if (info.gpus.totalVramGB >= 8) {
      score += 20;
      tier = 'entry';
    } else if (info.gpus.totalVramGB >= 4) {
      score += 10;
    }
    
    // RAM scoring
    if (info.memory.totalGB >= 64) {
      score += 20;
    } else if (info.memory.totalGB >= 32) {
      score += 15;
    } else if (info.memory.totalGB >= 16) {
      score += 10;
    }
    
    // CPU scoring
    if (info.cpu.features.avx512) {
      score += 10;
    } else if (info.cpu.features.avx2) {
      score += 7;
    }
    
    if (info.cpu.physicalCores >= 8) {
      score += 10;
    } else if (info.cpu.physicalCores >= 4) {
      score += 5;
    }
    
    // NPU bonus
    if (info.npu.detected) {
      score += 5;
    }
    
    return {
      score,
      tier,
      maxModelSize: this.getMaxModelSize(info),
      recommendedQuant: this.getRecommendedQuant(info),
    };
  }

  /**
   * Get maximum recommended model size
   */
  getMaxModelSize(info) {
    const vramGB = info.gpus.freeVramGB || 0;
    const ramGB = info.memory.freeGB || 0;
    
    // GPU-based limits
    if (vramGB >= 40) return '70B';
    if (vramGB >= 20) return '34B';
    if (vramGB >= 12) return '13B';
    if (vramGB >= 8) return '8B';
    if (vramGB >= 6) return '7B';
    if (vramGB >= 4) return '3B';
    
    // Fall back to RAM for CPU inference
    if (ramGB >= 64) return '34B (CPU)';
    if (ramGB >= 32) return '13B (CPU)';
    if (ramGB >= 16) return '7B (CPU)';
    
    return '3B';
  }

  /**
   * Get recommended quantization
   */
  getRecommendedQuant(info) {
    const vramGB = info.gpus.freeVramGB || 0;
    
    if (vramGB >= 24) return 'Q5_K_M';
    if (vramGB >= 12) return 'Q4_K_M';
    if (vramGB >= 8) return 'Q4_K_S';
    if (vramGB >= 6) return 'Q4_0';
    if (vramGB >= 4) return 'Q3_K_M';
    
    return 'Q2_K';
  }

  /**
   * Check if a specific model can run
   */
  canRunModel(modelInfo, hardware = null) {
    const hw = hardware || this.cache;
    if (!hw) return { canRun: false, reason: 'Hardware info not available' };
    
    const { sizeB, quant = 'Q4_K_M' } = modelInfo;
    const vramNeeded = this.estimateVramNeeded(sizeB, quant);
    const availableVram = hw.gpus.freeVramGB || 0;
    const availableRam = hw.memory.freeGB || 0;
    
    // GPU inference
    if (availableVram >= vramNeeded) {
      return {
        canRun: true,
        method: 'gpu',
        vramNeeded,
        vramAvailable: availableVram,
        estimatedSpeed: this.estimateThroughput(hw, sizeB, quant),
      };
    }
    
    // CPU inference (needs more RAM)
    const ramNeeded = vramNeeded * 1.5; // CPU needs more memory
    if (availableRam >= ramNeeded) {
      return {
        canRun: true,
        method: 'cpu',
        ramNeeded,
        ramAvailable: availableRam,
        estimatedSpeed: this.estimateCpuThroughput(hw, sizeB, quant),
        warning: 'CPU inference will be slower than GPU',
      };
    }
    
    return {
      canRun: false,
      reason: `Insufficient memory. Need ${vramNeeded.toFixed(1)} GB VRAM or ${ramNeeded.toFixed(1)} GB RAM`,
      vramNeeded,
      vramAvailable: availableVram,
      ramNeeded,
      ramAvailable: availableRam,
      recommendations: this.getModelRecommendations(hw, sizeB),
    };
  }

  /**
   * Estimate VRAM needed for a model
   */
  estimateVramNeeded(sizeB, quant = 'Q4_K_M') {
    const bytesPerParam = QUANT_VRAM_PER_B[quant] || QUANT_VRAM_PER_B['Q4_K_M'];
    return (sizeB * bytesPerParam) + VRAM_OVERHEAD_GB;
  }

  /**
   * Estimate throughput (tokens/second)
   */
  estimateThroughput(hw, sizeB, quant = 'Q4_K_M') {
    const totalTflops = hw.gpus.devices.reduce((sum, gpu) => sum + (gpu.estimatedTflops || 20), 0);
    const tokensPerTflop = TOKENS_PER_TFLOPS[quant] || 6;
    
    // Rough estimate: larger models are slower
    const sizeMultiplier = 7 / sizeB;
    
    return Math.round(totalTflops * tokensPerTflop * sizeMultiplier);
  }

  /**
   * Estimate CPU throughput
   */
  estimateCpuThroughput(hw, sizeB, quant = 'Q4_K_M') {
    const cores = hw.cpu.physicalCores || 4;
    const hasAvx2 = hw.cpu.features.avx2;
    
    // Base tokens/second per core
    let baseTokens = hasAvx2 ? 2 : 1;
    
    // Scale with cores (diminishing returns)
    const effectiveCores = Math.min(cores, 8);
    let tokens = baseTokens * effectiveCores;
    
    // Adjust for model size
    tokens *= (7 / sizeB);
    
    return Math.round(tokens);
  }

  /**
   * Get model recommendations for hardware
   */
  getModelRecommendations(hw, targetSizeB = null) {
    const recommendations = [];
    const vramGB = hw.gpus.freeVramGB || 0;
    const ramGB = hw.memory.freeGB || 0;
    
    for (const [quant, bytesPerB] of Object.entries(QUANT_VRAM_PER_B)) {
      for (const [label, sizeB] of Object.entries(MODEL_SIZES)) {
        const vramNeeded = (sizeB * bytesPerB) + VRAM_OVERHEAD_GB;
        
        if (vramNeeded <= vramGB) {
          recommendations.push({
            size: label,
            sizeB,
            quant,
            vramNeeded: Math.round(vramNeeded * 10) / 10,
            method: 'gpu',
            estimatedSpeed: this.estimateThroughput(hw, sizeB, quant),
          });
        } else if (vramNeeded * 1.5 <= ramGB) {
          recommendations.push({
            size: label,
            sizeB,
            quant,
            ramNeeded: Math.round(vramNeeded * 1.5 * 10) / 10,
            method: 'cpu',
            estimatedSpeed: this.estimateCpuThroughput(hw, sizeB, quant),
          });
        }
      }
    }
    
    // Sort by size (largest first) then by quality
    recommendations.sort((a, b) => {
      if (b.sizeB !== a.sizeB) return b.sizeB - a.sizeB;
      return (QUANT_VRAM_PER_B[b.quant] || 0) - (QUANT_VRAM_PER_B[a.quant] || 0);
    });
    
    // Take top 5
    return recommendations.slice(0, 5);
  }

  /**
   * Get precheck result for a download
   */
  async precheck(modelInfo) {
    const hw = await this.getHardwareInfo();
    const compatibility = this.canRunModel(modelInfo, hw);
    
    return {
      hardware: hw,
      compatibility,
      warnings: this.getWarnings(hw, modelInfo),
      recommendations: compatibility.canRun ? [] : compatibility.recommendations,
    };
  }

  getWarnings(hw, modelInfo) {
    const warnings = [];
    
    if (hw.memory.usedPercent > 80) {
      warnings.push('High system memory usage. Close other applications for best performance.');
    }
    
    if (hw.gpus.count === 0) {
      warnings.push('No GPU detected. Model will run on CPU (slower).');
    }
    
    if (hw.disk.freeSpaceGB < 20) {
      warnings.push('Low disk space. Consider freeing up space before downloading large models.');
    }
    
    return warnings;
  }
}

// Singleton
let checkerInstance = null;

function getHardwareChecker() {
  if (!checkerInstance) {
    checkerInstance = new HardwareChecker();
  }
  return checkerInstance;
}

module.exports = {
  HardwareChecker,
  getHardwareChecker,
  MODEL_SIZES,
  QUANT_VRAM_PER_B,
};



