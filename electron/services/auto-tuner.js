/**
 * Auto-Tuner
 * Compute recommended backend and settings for a model given available hardware.
 *
 * This is a first-pass heuristic implementation. It uses:
 * - Model metadata from model-inspector (GGUF-focused)
 * - Hardware info from hardware-detection (CPU, GPU VRAM, NPU)
 */

const hardwareDetection = require('./hardware-detection');
const { inspectModel } = require('./model-inspector');

let cachedHardware = null;

async function getHardware() {
  if (cachedHardware) return cachedHardware;
  try {
    cachedHardware = await hardwareDetection.detectHardware();
  } catch (e) {
    cachedHardware = {
      cpu: { physicalCores: require('os').cpus().length, brand: 'Unknown CPU' },
      memory: {},
      gpus: [],
      npu: { detected: false },
      recommendations: { primary: 'cpu', backends: ['ollama-cpu'] },
    };
  }
  return cachedHardware;
}

function pickBestGpu(gpus) {
  if (!gpus || gpus.length === 0) return null;
  // Prefer NVIDIA for CUDA, else highest VRAM
  const nvidia = gpus.filter((g) => g.type === 'nvidia');
  if (nvidia.length) {
    return nvidia.reduce((best, g) => (g.vram > best.vram ? g : best), nvidia[0]);
  }
  return gpus.reduce((best, g) => (g.vram > best.vram ? g : best), gpus[0]);
}

function recommendContextLength(estimatedVramBytes, gpuVramMb) {
  if (!gpuVramMb || !estimatedVramBytes) {
    // Fallback when we don't know memory details
    return 8192;
  }

  const gpuBytes = gpuVramMb * 1024 * 1024;
  const ratio = gpuBytes / estimatedVramBytes;

  if (ratio >= 3) return 16384;
  if (ratio >= 1.5) return 8192;
  if (ratio >= 1.0) return 4096;
  return 2048;
}

function recommendThreads(cpu) {
  const physical = cpu?.physicalCores || cpu?.cores || require('os').cpus().length;
  if (physical <= 2) return physical;
  if (physical <= 4) return physical;
  // Leave a couple of cores free for system
  return Math.max(2, physical - 2);
}

function recommendBatchSize(estimatedVramBytes, gpuVramMb) {
  if (!gpuVramMb || !estimatedVramBytes) return 128;
  const gpuBytes = gpuVramMb * 1024 * 1024;
  const ratio = gpuBytes / estimatedVramBytes;
  if (ratio >= 3) return 512;
  if (ratio >= 1.5) return 256;
  if (ratio >= 1.0) return 192;
  return 128;
}

async function autoTuneModel(modelPath) {
  const [hardware, modelInfo] = await Promise.all([getHardware(), inspectModel(modelPath)]);

  const notes = [];
  const result = {
    model: {
      path: modelInfo.path,
      filename: modelInfo.filename,
      architecture: modelInfo.architecture,
      parametersB: modelInfo.parametersB,
      quantization: modelInfo.quantization,
      fileSizeFormatted: modelInfo.fileSizeFormatted,
      estimatedVramFormatted: modelInfo.estimatedVramFormatted,
    },
    hardware: {
      cpu: hardware.cpu,
      memory: hardware.memory,
      gpus: hardware.gpus,
      npu: hardware.npu,
    },
    preset: 'balanced',
    backend: null,
    device: null,
    gpuLayers: null,
    contextLength: null,
    threads: null,
    batchSize: null,
    kvCachePrecision: 'fp16',
    flashAttention: true,
    notes,
  };

  const paramsB = modelInfo.parametersB || 0;
  const estimatedVramBytes = modelInfo.estimatedVramBytes || null;
  const bestGpu = pickBestGpu(hardware.gpus);

  // Backend selection
  if (hardware.npu?.detected && paramsB && paramsB <= 3) {
    result.backend = 'openvino-npu';
    result.device = hardware.npu.name || 'Intel NPU';
    notes.push('Model is small enough for NPU; recommending OpenVINO NPU backend for efficiency.');
  } else if (bestGpu && bestGpu.capabilities?.cuda) {
    result.backend = 'ollama-cuda';
    result.device = bestGpu.name || 'NVIDIA GPU';
    notes.push('Detected NVIDIA GPU; recommending CUDA backend.');
  } else if (bestGpu && bestGpu.type === 'intel-arc') {
    result.backend = 'llamacpp-vulkan';
    result.device = bestGpu.name || 'Intel Arc GPU';
    notes.push('Detected Intel Arc GPU; recommending llama.cpp Vulkan backend.');
  } else {
    result.backend = 'ollama-cpu';
    result.device = hardware.cpu?.brand || 'CPU';
    notes.push('No suitable accelerator detected; falling back to CPU backend.');
  }

  // Context length
  const gpuVramMb = bestGpu?.vram || null;
  result.contextLength = recommendContextLength(estimatedVramBytes, gpuVramMb);

  // Threads
  result.threads = recommendThreads(hardware.cpu);

  // Batch size
  result.batchSize = recommendBatchSize(estimatedVramBytes, gpuVramMb);

  // GPU layers heuristic: if we don't know layer count, approximate by VRAM ratio
  if (gpuVramMb && estimatedVramBytes) {
    const gpuBytes = gpuVramMb * 1024 * 1024;
    const ratio = gpuBytes / estimatedVramBytes;
    if (ratio >= 1.0) {
      result.gpuLayers = 'all';
      notes.push('Estimated VRAM is sufficient for full GPU offload.');
    } else if (ratio >= 0.5) {
      result.gpuLayers = 'most';
      notes.push('Recommended to offload most layers to GPU; some will remain on CPU.');
    } else {
      result.gpuLayers = 'partial';
      notes.push('Limited VRAM; recommend partial offload or CPU-heavy configuration.');
    }
  }

  // Additional notes based on size
  if (paramsB >= 70) {
    notes.push('Very large model; expect slower responses and higher memory usage.');
  } else if (paramsB >= 13) {
    notes.push('Mid-to-large model; good balance of quality and performance on modern GPUs.');
  } else if (paramsB > 0) {
    notes.push('Small-to-medium model; should perform well on this hardware.');
  }

  return result;
}

module.exports = {
  autoTuneModel,
};

















