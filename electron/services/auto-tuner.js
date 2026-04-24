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
    // Fallback when we don't know memory details -- still be generous
    return 16384;
  }

  const gpuBytes = gpuVramMb * 1024 * 1024;
  const ratio = gpuBytes / estimatedVramBytes;

  // Be AGGRESSIVE with context -- users have powerful hardware, use it!
  // With flash attention and KV cache quantization, we can fit much more
  if (ratio >= 6) return 131072;  // 128K -- monster VRAM headroom
  if (ratio >= 4) return 65536;   // 64K
  if (ratio >= 2.5) return 32768; // 32K
  if (ratio >= 1.5) return 16384; // 16K
  if (ratio >= 1.0) return 8192;  // 8K -- tight but workable
  return 4096;                     // 4K -- very constrained
}

function recommendThreads(cpu) {
  const physical = cpu?.physicalCores || cpu?.cores || require('os').cpus().length;
  if (physical <= 2) return physical;
  if (physical <= 4) return physical;
  // Leave a couple of cores free for system
  return Math.max(2, physical - 2);
}

function recommendBatchSize(estimatedVramBytes, gpuVramMb) {
  if (!gpuVramMb || !estimatedVramBytes) return 256;
  const gpuBytes = gpuVramMb * 1024 * 1024;
  const ratio = gpuBytes / estimatedVramBytes;
  // Larger batch = faster prompt processing. Push it!
  if (ratio >= 4) return 1024;  // Lots of headroom, max throughput
  if (ratio >= 2.5) return 512;
  if (ratio >= 1.5) return 512;
  if (ratio >= 1.0) return 256;
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

  // Backend selection -- route to the best accelerator for this model
  if (hardware.npu?.detected && paramsB && paramsB <= 7) {
    // NPU can handle up to ~7B models efficiently (with quantization)
    // For ≤3B, NPU is ideal. For 3-7B, NPU is still competitive.
    result.backend = 'openvino-npu';
    result.device = hardware.npu.name || 'Intel NPU';
    if (paramsB <= 3) {
      notes.push('Small model ideal for NPU; recommending OpenVINO NPU backend for maximum efficiency.');
    } else {
      notes.push('Model fits in NPU memory with quantization; recommending NPU for power-efficient inference.');
    }
  } else if (bestGpu && bestGpu.capabilities?.cuda) {
    result.backend = 'ollama-cuda';
    result.device = bestGpu.name || 'NVIDIA GPU';
    notes.push(`Detected NVIDIA GPU (${bestGpu.vram || 'unknown'}MB VRAM); recommending CUDA backend for maximum speed.`);
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

  // GPU layers heuristic: normalize to numeric Ollama-compatible values so the
  // renderer and main process do not need to maintain separate mappings.
  if (gpuVramMb && estimatedVramBytes) {
    const gpuBytes = gpuVramMb * 1024 * 1024;
    const ratio = gpuBytes / estimatedVramBytes;
    if (ratio >= 1.0) {
      result.gpuLayers = -1;
      notes.push('Estimated VRAM is sufficient for full GPU offload.');
    } else if (ratio >= 0.5) {
      result.gpuLayers = 33;
      notes.push('Recommended to offload most layers to GPU; some will remain on CPU.');
    } else {
      result.gpuLayers = 15;
      notes.push('Limited VRAM; recommend partial offload or CPU-heavy configuration.');
    }
  }

  // Flash attention and KV cache quantization recommendations
  // These are critical for maximizing performance on modern hardware
  if (bestGpu && bestGpu.capabilities?.cuda) {
    result.flashAttention = true;
    notes.push('Flash attention enabled for faster inference with long contexts.');
    
    // KV cache quantization: q8_0 is a good default, q4_0 for very tight VRAM
    if (gpuVramMb && estimatedVramBytes) {
      const ratio = (gpuVramMb * 1024 * 1024) / estimatedVramBytes;
      if (ratio >= 2.0) {
        result.kvCachePrecision = 'q8_0'; // Plenty of room, use higher quality
        notes.push('KV cache at q8_0 precision for quality (ample VRAM headroom).');
      } else {
        result.kvCachePrecision = 'q4_0'; // Tight, use aggressive quantization
        notes.push('KV cache at q4_0 to maximize context window in available VRAM.');
      }
    } else {
      result.kvCachePrecision = 'q8_0';
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

















