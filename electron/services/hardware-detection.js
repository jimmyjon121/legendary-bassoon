/**
 * Hardware Detection Service
 * Detects and monitors all available AI acceleration hardware
 */

let si = null;
try {
  si = require('systeminformation');
} catch (e) {
  // Graceful fallback: allow the module to load even if systeminformation is unavailable
  // so we can still provide basic OS stats.
  console.warn('systeminformation package not available, using OS fallbacks:', e.message);
  si = null;
}

const { exec } = require('child_process');
const os = require('os');

// Cache for hardware info (doesn't change during runtime)
let cachedHardware = null;
let lastStatsUpdate = 0;
let cachedStats = null;

// NPU server status cache with adaptive backoff.
// When the server is reachable we poll every 10s.
// When it's unreachable we back off to 60s to avoid ECONNREFUSED spam.
let cachedNpuServerStatus = null;
let lastNpuServerStatusAt = 0;
let npuServerPollInterval = 10000;       // current poll interval (ms)
const NPU_POLL_ONLINE  = 10000;          // 10s when server is online
const NPU_POLL_OFFLINE = 60000;          // 60s when server is offline
const NPU_POLL_FIRST   = 0;             // immediately on first call

/**
 * Detect all available hardware for AI acceleration
 */
async function detectHardware() {
  if (cachedHardware) {
    return cachedHardware;
  }

  // If systeminformation is available, use full detection
  if (si) {
    try {
      const [cpu, mem, graphics, system] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.graphics(),
        si.system()
      ]);

      // Parse GPUs
      const gpus = graphics.controllers.map((gpu, index) => ({
        index,
        name: gpu.model || gpu.name || 'Unknown GPU',
        vendor: gpu.vendor || 'Unknown',
        vram: gpu.vram || 0, // in MB
        vramDynamic: gpu.vramDynamic || false,
        driver: gpu.driverVersion || 'Unknown',
        bus: gpu.bus || 'Unknown',
        // Detect GPU type
        type: detectGpuType(gpu),
        // Capabilities
        capabilities: {
          cuda: gpu.vendor?.toLowerCase().includes('nvidia'),
          vulkan: true, // Most modern GPUs support Vulkan
          directml: true, // Windows 11 supports DirectML
          openvino: gpu.vendor?.toLowerCase().includes('intel')
        }
      }));

      // Detect NPU (Intel AI Boost)
      const npu = await detectNpu(cpu);

      // Build hardware profile
      cachedHardware = {
        cpu: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          cores: cpu.cores,
          physicalCores: cpu.physicalCores,
          speed: cpu.speed,
          speedMax: cpu.speedMax,
          // Check for Intel Core Ultra (has NPU)
          hasNpu: cpu.brand?.toLowerCase().includes('ultra') || npu.detected
        },
        memory: {
          total: Math.round(mem.total / (1024 * 1024 * 1024)), // GB
          available: Math.round(mem.available / (1024 * 1024 * 1024)), // GB
          used: Math.round(mem.used / (1024 * 1024 * 1024)) // GB
        },
        gpus,
        npu,
        system: {
          manufacturer: system.manufacturer,
          model: system.model,
          platform: os.platform(),
          arch: os.arch()
        },
        // Recommended backends based on hardware
        recommendations: generateRecommendations(gpus, npu, cpu)
      };

      return cachedHardware;
    } catch (error) {
      console.error('Systeminformation detection failed, falling back to OS stats:', error);
      // Fall through to fallback
    }
  }

  // Fallback: Use basic OS info so UI is never empty
  const cpus = os.cpus();
  const totalMem = os.totalmem();

  cachedHardware = {
    // Note: No error field to avoid forcing "unavailable" UI state
    cpu: { 
      manufacturer: 'Unknown',
      brand: cpus[0]?.model || 'Generic CPU',
      cores: cpus.length,
      physicalCores: Math.max(1, Math.floor(cpus.length / 2)),
      speed: cpus[0]?.speed || 0,
      speedMax: 0,
      hasNpu: false
    },
    memory: { 
      total: Math.round(totalMem / (1024 * 1024 * 1024)),
      available: Math.round(os.freemem() / (1024 * 1024 * 1024)),
      used: Math.round((totalMem - os.freemem()) / (1024 * 1024 * 1024))
    },
    gpus: [], // Cannot detect GPUs without systeminformation
    npu: { detected: false },
    system: {
      manufacturer: 'Unknown',
      model: 'Unknown',
      platform: os.platform(),
      arch: os.arch()
    },
    recommendations: { primary: 'cpu', backends: ['ollama-cpu'] }
  };

  return cachedHardware;
}

/**
 * Detect GPU type for backend selection
 */
function detectGpuType(gpu) {
  const vendor = (gpu.vendor || '').toLowerCase();
  const model = (gpu.model || '').toLowerCase();

  if (vendor.includes('nvidia')) {
    return 'nvidia';
  } else if (vendor.includes('intel')) {
    if (model.includes('arc')) {
      return 'intel-arc';
    }
    return 'intel-integrated';
  } else if (vendor.includes('amd')) {
    return 'amd';
  }
  return 'unknown';
}

/**
 * Detect Intel NPU (AI Boost).
 * Uses three strategies: CPU brand heuristic, Windows WMI query, and
 * OpenVINO device enumeration (the most reliable method).
 */
async function detectNpu(cpuInfo) {
  const result = {
    detected: false,
    name: null,
    driver: null,
    tops: null
  };

  // Intel Core Ultra CPUs have integrated NPU
  if (cpuInfo.brand?.toLowerCase().includes('ultra')) {
    result.detected = true;
    result.name = 'Intel AI Boost NPU';

    if (cpuInfo.brand.includes('285') || cpuInfo.brand.includes('288')) {
      result.tops = 45;
    } else if (cpuInfo.brand.includes('165') || cpuInfo.brand.includes('155')) {
      result.tops = 34;
    } else {
      result.tops = 10;
    }
  }

  // Try to detect via WMI on Windows
  if (process.platform === 'win32') {
    try {
      const wmiResult = await queryWmi();
      if (wmiResult.npuDetected) {
        result.detected = true;
        result.name = wmiResult.npuName || result.name;
        result.driver = wmiResult.npuDriver;
      }
    } catch (e) {
      // WMI query failed, continue to OpenVINO probe.
    }
  }

  // If still not detected, ask the NpuBridge (uses OpenVINO Core API).
  if (!result.detected) {
    try {
      const { getNpuBridge } = require('./npu-bridge');
      const npuBridge = getNpuBridge();
      const installation = await npuBridge.checkOpenVinoInstallation();
      if (installation?.installed) {
        const devices = await npuBridge.queryDevices({ force: true });
        if (devices?.npuAvailable) {
          result.detected = true;
          result.name = result.name || 'Intel NPU (OpenVINO)';
          const npuDevice = (devices.devices || []).find(
            (d) => /^NPU/i.test(String(d.id || ''))
          );
          if (npuDevice?.name) result.name = npuDevice.name;
        }
      }
    } catch (err) {
      console.warn('[HardwareDetection] OpenVINO NPU probe failed:', err?.message);
    }
  }

  return result;
}

/**
 * Query Windows WMI for NPU information
 */
function queryWmi() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ npuDetected: false });
      return;
    }

    // Query for Intel NPU device (use Get-CimInstance instead of deprecated Get-WmiObject)
    const command = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.Name -like '*NPU*' -or $_.Name -like '*Neural*' -or $_.Name -like '*AI Boost*' } | Select-Object Name | ConvertTo-Json"`;
    
    exec(command, { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve({ npuDetected: false });
        return;
      }

      try {
        const devices = JSON.parse(stdout);
        const npuDevice = Array.isArray(devices) ? devices[0] : devices;
        
        if (npuDevice && npuDevice.Name) {
          resolve({
            npuDetected: true,
            npuName: npuDevice.Name,
            npuDriver: npuDevice.DriverVersion
          });
        } else {
          resolve({ npuDetected: false });
        }
      } catch {
        resolve({ npuDetected: false });
      }
    });
  });
}

/**
 * Generate backend recommendations based on hardware
 */
function generateRecommendations(gpus, npu, cpu) {
  const recommendations = {
    primary: 'cpu',
    backends: [],
    notes: []
  };

  // Check for NVIDIA GPU (best for CUDA/Ollama)
  const nvidiaGpu = gpus.find(g => g.type === 'nvidia');
  if (nvidiaGpu) {
    recommendations.primary = 'cuda';
    recommendations.backends.push({
      id: 'ollama-cuda',
      name: 'Ollama (CUDA)',
      device: nvidiaGpu.name,
      priority: 1,
      bestFor: ['large-models', 'fast-inference']
    });
    recommendations.notes.push(`NVIDIA ${nvidiaGpu.name} detected - CUDA acceleration available`);
  }

  // Check for Intel Arc GPU (Vulkan/OpenVINO)
  const arcGpu = gpus.find(g => g.type === 'intel-arc');
  if (arcGpu) {
    recommendations.backends.push({
      id: 'llamacpp-vulkan',
      name: 'llama.cpp (Vulkan)',
      device: arcGpu.name,
      priority: nvidiaGpu ? 2 : 1,
      bestFor: ['medium-models', 'multi-gpu']
    });
    recommendations.backends.push({
      id: 'openvino-gpu',
      name: 'OpenVINO (Arc GPU)',
      device: arcGpu.name,
      priority: 3,
      bestFor: ['onnx-models', 'intel-optimized']
    });
    recommendations.notes.push(`Intel ${arcGpu.name} detected - Vulkan and OpenVINO available`);
  }

  // Check for NPU
  if (npu.detected) {
    recommendations.backends.push({
      id: 'openvino-npu',
      name: 'OpenVINO (NPU)',
      device: npu.name,
      priority: nvidiaGpu ? 4 : 2,
      bestFor: ['efficiency', 'battery-saving', 'small-models']
    });
    recommendations.notes.push(`Intel NPU detected (${npu.tops} TOPS) - Efficient inference available`);
  }

  // Always add CPU fallback
  recommendations.backends.push({
    id: 'ollama-cpu',
    name: 'Ollama (CPU)',
    device: cpu.brand,
    priority: 99,
    bestFor: ['fallback', 'compatibility']
  });

  // Set primary if not set
  if (!nvidiaGpu && !arcGpu && npu.detected) {
    recommendations.primary = 'npu';
  } else if (!nvidiaGpu && arcGpu) {
    recommendations.primary = 'vulkan';
  }

  // Sort backends by priority
  recommendations.backends.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// Track previous CPU times for accurate usage calculation
let previousCpuTimes = null;

// Cache Ollama stats separately (can update less frequently)
let cachedOllamaStats = null;
let lastOllamaStatsUpdate = 0;

// Cache nvidia-smi stats
let cachedNvidiaSmi = null;
let lastNvidiaSmiUpdate = 0;

/**
 * Query nvidia-smi directly for real GPU utilization and VRAM.
 * systeminformation's si.graphics() returns 0 for NVIDIA on Windows,
 * so nvidia-smi is the only reliable source.
 */
async function getNvidiaSmiStats() {
  const now = Date.now();
  if (cachedNvidiaSmi && (now - lastNvidiaSmiUpdate) < 2000) {
    return cachedNvidiaSmi;
  }

  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    exec(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 3000 },
      (error, stdout) => {
        if (error || !stdout?.trim()) {
          resolve(cachedNvidiaSmi || null);
          return;
        }
        try {
          const parts = stdout.trim().split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 3 && parts.every(v => Number.isFinite(v))) {
            cachedNvidiaSmi = {
              utilizationGpu: Math.round(parts[0]),
              vramUsed: Math.round(parts[1]),
              vramTotal: Math.round(parts[2]),
              temperature: parts.length >= 4 ? Math.round(parts[3]) : null,
              vramPercent: parts[2] > 0 ? Math.round((parts[1] / parts[2]) * 100) : 0,
            };
            lastNvidiaSmiUpdate = now;
          }
          resolve(cachedNvidiaSmi);
        } catch {
          resolve(cachedNvidiaSmi || null);
        }
      }
    );
  });
}

/**
 * Query Ollama for running models and their GPU memory usage
 * This gives us accurate VRAM usage from models loaded by Ollama
 */
async function getOllamaGpuStats(ollamaEndpoint = 'http://127.0.0.1:11434') {
  const now = Date.now();
  
  // Cache Ollama stats for 5 seconds (slower poll — endpoint can block when model is loading)
  if (cachedOllamaStats && (now - lastOllamaStatsUpdate) < 5000) {
    return cachedOllamaStats;
  }
  
  try {
    const http = require('http');
    const result = await new Promise((resolve, reject) => {
      const url = new URL(ollamaEndpoint + '/api/ps');
      const req = http.get({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 2000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    
    if (!result || !result.models) {
      cachedOllamaStats = { models: [], totalVram: 0 };
      lastOllamaStatsUpdate = now;
      return cachedOllamaStats;
    }
    
    const models = result.models.map(m => ({
      name: m.name || m.model,
      size: m.size || 0,
      sizeVram: m.size_vram || 0,
      digest: m.digest,
      details: m.details,
      gpuLayers: m.details?.parameter_size ? 
        Math.round((m.size_vram / m.size) * 100) : null
    }));
    
    const totalVram = models.reduce((sum, m) => sum + (m.sizeVram || 0), 0);
    
    cachedOllamaStats = {
      models,
      totalVram,
      totalVramMB: Math.round(totalVram / (1024 * 1024)),
      modelCount: models.length
    };
    lastOllamaStatsUpdate = now;
    
    return cachedOllamaStats;
  } catch (error) {
    console.warn('Failed to get Ollama GPU stats:', error.message);
    return cachedOllamaStats || { models: [], totalVram: 0 };
  }
}

/**
 * Get real-time hardware statistics
 */
async function getHardwareStats() {
  const now = Date.now();
  
  // Cache stats for 1 second to avoid excessive polling
  if (cachedStats && (now - lastStatsUpdate) < 1000) {
    return cachedStats;
  }

  // Ensure hardware is detected first (populates cachedHardware with GPU/NPU info)
  if (!cachedHardware) {
    try {
      await detectHardware();
    } catch (e) {
      console.warn('Initial hardware detection failed, stats may be incomplete:', e.message);
    }
  }

  // SIMPLIFIED: Use Node.js os module directly for faster, more reliable stats
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Calculate CPU usage by comparing with previous measurement
    let cpuUsage = 0;
    const currentTimes = {
      idle: 0,
      total: 0
    };
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        currentTimes.total += cpu.times[type];
      }
      currentTimes.idle += cpu.times.idle;
    });
    
    if (previousCpuTimes) {
      const idleDiff = currentTimes.idle - previousCpuTimes.idle;
      const totalDiff = currentTimes.total - previousCpuTimes.total;
      cpuUsage = Math.round(100 - (100 * idleDiff / totalDiff));
      cpuUsage = Math.max(0, Math.min(100, cpuUsage)); // Clamp to 0-100
    } else {
      cpuUsage = 0; // First measurement, no baseline
    }
    
    previousCpuTimes = currentTimes;
    
    // Get live GPU stats — prefer nvidia-smi (always accurate on NVIDIA/Windows)
    // then fall back to systeminformation.
    let gpuData = [];
    const nvidiaSmi = await getNvidiaSmiStats();

    if (cachedHardware?.gpus?.length) {
      const hasNvidia = cachedHardware.gpus.some(g => g.type === 'nvidia');

      if (hasNvidia && nvidiaSmi) {
        // nvidia-smi gave us authoritative data — use it for the NVIDIA GPU
        gpuData = cachedHardware.gpus.map((gpu) => {
          if (gpu.type === 'nvidia') {
            return {
              name: gpu.name,
              utilizationGpu: nvidiaSmi.utilizationGpu,
              utilizationMemory: nvidiaSmi.vramPercent,
              temperature: nvidiaSmi.temperature,
              vramUsed: nvidiaSmi.vramUsed,
              vramTotal: nvidiaSmi.vramTotal,
              vramPercent: nvidiaSmi.vramPercent,
            };
          }
          return {
            name: gpu.name,
            utilizationGpu: 0,
            utilizationMemory: 0,
            temperature: null,
            vramUsed: 0,
            vramTotal: Math.round(gpu.vram || 0),
            vramPercent: 0,
          };
        });
      } else {
        // No nvidia-smi — try systeminformation as fallback
        try {
          const graphics = await Promise.race([
            si ? si.graphics() : Promise.reject(new Error('no si')),
            new Promise((_, reject) => setTimeout(() => reject(new Error('GPU timeout')), 2000))
          ]);

          gpuData = graphics.controllers.map((gpu, i) => ({
            name: gpu.model || gpu.name || cachedHardware.gpus[i]?.name || 'GPU',
            utilizationGpu: Math.round(gpu.utilizationGpu || 0),
            utilizationMemory: Math.round(gpu.utilizationMemory || 0),
            temperature: gpu.temperatureGpu || null,
            vramUsed: Math.round(gpu.memoryUsed || 0),
            vramTotal: Math.round(gpu.vram || cachedHardware.gpus[i]?.vram || 0),
            vramPercent: gpu.vram ? Math.round((gpu.memoryUsed || 0) / gpu.vram * 100) : 0
          }));
        } catch {
          gpuData = cachedHardware.gpus.map(gpu => ({
            name: gpu.name,
            utilizationGpu: 0,
            utilizationMemory: 0,
            temperature: null,
            vramUsed: 0,
            vramTotal: Math.round(gpu.vram || 0),
            vramPercent: 0
          }));
        }
      }
    }
    
    const processes = { all: 0, list: [] }; // Skip process enumeration - too slow

    // Try to get CPU temperature with timeout
    let cpuTemp = null;
    try {
      const temps = await Promise.race([
        si.cpuTemperature(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Temp timeout')), 500))
      ]);
      cpuTemp = temps?.main || null;
    } catch {
      // Temperature monitoring not available
    }

    // Include NPU status if available
    let npuStatus = null;
    if (cachedHardware?.npu?.detected) {
      npuStatus = {
        detected: true,
        active: false,
        serverRunning: false,
        modelLoaded: false,
        name: cachedHardware.npu.name || 'Intel NPU',
        tops: cachedHardware.npu.tops || 45
      };
      
      // Check if OpenVINO server is running (with adaptive backoff)
      try {
        const sinceLastPoll = now - lastNpuServerStatusAt;
        if (cachedNpuServerStatus && sinceLastPoll < npuServerPollInterval) {
          // Use cached value
          Object.assign(npuStatus, cachedNpuServerStatus);
        } else {
          // Time to poll
          const http = require('http');
          const pollResult = await new Promise((resolve) => {
            try {
              const req = http.get('http://localhost:8081/status', { timeout: 1500 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                  try {
                    const status = JSON.parse(data);
                    resolve({
                      reachable: true,
                      serverRunning: status.server === 'running' || status.status === 'running',
                      modelLoaded: status.model_loaded === true || status.modelLoaded === true,
                      device: status.device || 'NPU',
                    });
                  } catch {
                    resolve({ reachable: false });
                  }
                });
              });
              req.on('error', () => resolve({ reachable: false }));
              req.on('timeout', () => { req.destroy(); resolve({ reachable: false }); });
            } catch {
              resolve({ reachable: false });
            }
          });

          if (pollResult.reachable) {
            // Server is up — poll more frequently
            npuServerPollInterval = NPU_POLL_ONLINE;
            const next = {
              serverRunning: pollResult.serverRunning,
              modelLoaded: pollResult.modelLoaded,
              device: pollResult.device,
              active: pollResult.modelLoaded,
            };
            Object.assign(npuStatus, next);
            cachedNpuServerStatus = next;
          } else {
            // Server is down — back off to avoid spamming ECONNREFUSED
            npuServerPollInterval = NPU_POLL_OFFLINE;
            cachedNpuServerStatus = {
              serverRunning: false,
              modelLoaded: false,
              device: 'NPU',
              active: false,
            };
            Object.assign(npuStatus, cachedNpuServerStatus);
          }
          lastNpuServerStatusAt = now;
        }
      } catch {
        // Total failure — just leave defaults
      }
    }

    // Get Ollama GPU stats (models loaded in GPU memory)
    let ollamaStats = null;
    try {
      ollamaStats = await getOllamaGpuStats();
    } catch {
      // Non-fatal
    }
    
    // Merge Ollama VRAM usage into GPU data
    if (ollamaStats && ollamaStats.totalVramMB > 0 && gpuData.length > 0) {
      // Add Ollama's VRAM usage to the first GPU (usually where models load)
      gpuData[0].ollamaVramUsed = ollamaStats.totalVramMB;
      gpuData[0].ollamaModels = ollamaStats.models;
      // If systeminformation didn't detect VRAM usage, use Ollama's data
      if (gpuData[0].vramUsed === 0) {
        gpuData[0].vramUsed = ollamaStats.totalVramMB;
        if (gpuData[0].vramTotal > 0) {
          gpuData[0].vramPercent = Math.round((ollamaStats.totalVramMB / gpuData[0].vramTotal) * 100);
        }
      }
    }

    cachedStats = {
      cpu: {
        usage: cpuUsage,
        temperature: cpuTemp,
        cores: cpus.map(() => cpuUsage) // All cores show same usage in simplified mode
      },
      memory: {
        total: Math.round(totalMem / (1024 * 1024 * 1024)),
        used: Math.round(usedMem / (1024 * 1024 * 1024)),
        available: Math.round(freeMem / (1024 * 1024 * 1024)),
        usagePercent: Math.round((usedMem / totalMem) * 100)
      },
      gpus: gpuData,
      npu: npuStatus,
      ollama: ollamaStats, // Include Ollama stats for UI display
      processes: {
        ai: [],
        total: 0
      },
      timestamp: now,
      simplified: true
    };

    lastStatsUpdate = now;
    return cachedStats;
  } catch (error) {
    console.error('Failed to get hardware stats:', error);
    
    // Fallback to basic OS stats
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      // Simple CPU load average (Unix-like systems)
      const loadAvg = os.loadavg();
      const cpuUsage = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100));
      
      return {
        cpu: {
          usage: cpuUsage || 0,
          temperature: null,
          cores: cpus.map(() => cpuUsage)
        },
        memory: {
          total: Math.round(totalMem / (1024 * 1024 * 1024)),
          used: Math.round(usedMem / (1024 * 1024 * 1024)),
          available: Math.round(freeMem / (1024 * 1024 * 1024)),
          usagePercent: Math.round((usedMem / totalMem) * 100)
        },
        gpus: cachedHardware?.gpus?.map(gpu => {
          if (gpu.type === 'nvidia' && cachedNvidiaSmi) {
            return {
              name: gpu.name,
              utilizationGpu: cachedNvidiaSmi.utilizationGpu,
              temperature: cachedNvidiaSmi.temperature,
              vramUsed: cachedNvidiaSmi.vramUsed,
              vramTotal: cachedNvidiaSmi.vramTotal,
              vramPercent: cachedNvidiaSmi.vramPercent,
            };
          }
          return {
            name: gpu.name,
            utilizationGpu: 0,
            temperature: null,
            vramUsed: 0,
            vramTotal: Math.round(gpu.vram || 0),
            vramPercent: 0,
          };
        }) || [],
        npu: cachedHardware?.npu?.detected ? {
          detected: true,
          active: false,
          serverRunning: false,
          modelLoaded: false,
          name: cachedHardware.npu.name || 'Intel NPU',
          tops: cachedHardware.npu.tops || 45
        } : null,
        processes: { ai: [], total: 0 },
        timestamp: now,
        fallback: true
      };
    } catch (fallbackError) {
      console.error('Fallback stats also failed:', fallbackError);
      return {
        error: 'Hardware monitoring unavailable',
        cpu: { usage: 0, temperature: null },
        memory: { total: 0, used: 0, available: 0, usagePercent: 0 },
        gpus: [],
        npu: null,
        timestamp: now
      };
    }
  }
}

/**
 * Get detailed GPU information
 */
async function getGpuInfo() {
  try {
    const graphics = await si.graphics();
    
    return graphics.controllers.map((gpu, index) => ({
      index,
      name: gpu.model || gpu.name || 'Unknown',
      vendor: gpu.vendor,
      vram: gpu.vram,
      vramDynamic: gpu.vramDynamic,
      driver: gpu.driverVersion,
      subDeviceId: gpu.subDeviceId,
      bus: gpu.bus,
      // Current state
      utilizationGpu: gpu.utilizationGpu,
      utilizationMemory: gpu.utilizationMemory,
      memoryUsed: gpu.memoryUsed,
      memoryFree: gpu.memoryFree,
      temperature: gpu.temperatureGpu,
      powerDraw: gpu.powerDraw,
      powerLimit: gpu.powerLimit,
      clockCore: gpu.clockCore,
      clockMemory: gpu.clockMemory,
      // Display info
      displays: graphics.displays.filter(d => d.connection === gpu.bus).map(d => ({
        model: d.model,
        resolution: `${d.currentResX}x${d.currentResY}`,
        refresh: d.currentRefreshRate
      }))
    }));
  } catch (error) {
    console.error('Failed to get GPU info:', error);
    return [];
  }
}

/**
 * Clear cached hardware info (useful after driver updates)
 */
function clearCache() {
  cachedHardware = null;
  cachedStats = null;
  lastStatsUpdate = 0;
  cachedNvidiaSmi = null;
  lastNvidiaSmiUpdate = 0;
  // Also reset NPU tracking caches
  cachedNpuServerStatus = null;
  lastNpuServerStatusAt = 0;
  npuServerPollInterval = NPU_POLL_FIRST;
  // If the NpuBridge singleton exists, clear its caches too
  try {
    const { getNpuBridge } = require('./npu-bridge');
    const bridge = getNpuBridge();
    if (bridge && typeof bridge.clearAllCaches === 'function') {
      bridge.clearAllCaches();
    }
  } catch {
    // Non-critical
  }
}

/**
 * Check if CUDA is available
 */
async function checkCudaAvailable() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve({ available: false, error: error.message });
        } else {
          resolve({ 
            available: true, 
            gpus: stdout.trim().split('\n').filter(g => g.trim())
          });
        }
      });
    } else {
      resolve({ available: false, error: 'Not Windows' });
    }
  });
}

/**
 * Check if Vulkan is available
 */
async function checkVulkanAvailable() {
  return new Promise((resolve) => {
    exec('vulkaninfo --summary', { timeout: 5000 }, (error, stdout) => {
      if (error) {
        // Vulkan might still be available, just vulkaninfo not installed
        resolve({ available: true, verified: false });
      } else {
        resolve({ available: true, verified: true, info: stdout.substring(0, 500) });
      }
    });
  });
}

// Non-blocking accessor for the most recent detection result. Returns null
// when `detectHardware()` has not yet been called (callers must handle null
// and avoid triggering detection from hot paths).
function getCachedHardware() {
  return cachedHardware;
}

module.exports = {
  detectHardware,
  getHardwareStats,
  getOllamaGpuStats,
  getNvidiaSmiStats,
  getGpuInfo,
  getCachedHardware,
  clearCache,
  checkCudaAvailable,
  checkVulkanAvailable
};

