/**
 * llama.cpp Bridge
 * 
 * Interface for local llama.cpp inference and QLoRA training.
 * Supports hot-loading adapters for personalized inference.
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Configuration
const CONFIG = {
  // Default paths - user can override in settings
  llamaCppPath: null, // Will be detected or set
  modelsDir: null,    // Will use userData/models
  adaptersDir: null,  // Will use userData/adapters
  
  // Inference defaults
  defaultContextSize: 4096,
  defaultThreads: Math.max(1, os.cpus().length - 2),
  defaultBatchSize: 512,
  
  // Training defaults
  trainRank: 32,        // LoRA rank (lower = smaller adapter)
  trainAlpha: 64,       // LoRA alpha scaling
  trainEpochs: 1,       // Usually 1-3 for micro-adapters
  trainBatchSize: 4,
  trainLearningRate: 1e-4,
};

let isInitialized = false;
let llamaCppBinary = null;
let currentProcess = null;
let loadedAdapters = new Map();

/**
 * Initialize the llama.cpp bridge
 */
async function initialize(userDataPath) {
  CONFIG.modelsDir = path.join(userDataPath, 'models', 'llama');
  CONFIG.adaptersDir = path.join(userDataPath, 'adapters');
  
  // Ensure directories exist
  await fs.mkdir(CONFIG.modelsDir, { recursive: true });
  await fs.mkdir(CONFIG.adaptersDir, { recursive: true });
  
  // Detect llama.cpp binary
  llamaCppBinary = await detectLlamaCpp();
  
  if (llamaCppBinary) {
    console.log('[LlamaBridge] Found llama.cpp at:', llamaCppBinary);
    isInitialized = true;
  } else {
    console.warn('[LlamaBridge] llama.cpp not found - training features unavailable');
  }
  
  return {
    initialized: isInitialized,
    binaryPath: llamaCppBinary,
    modelsDir: CONFIG.modelsDir,
    adaptersDir: CONFIG.adaptersDir,
  };
}

/**
 * Detect llama.cpp binary location
 */
async function detectLlamaCpp() {
  const possiblePaths = [
    // User-specified path (from settings)
    CONFIG.llamaCppPath,
    // Common installation locations
    path.join(os.homedir(), 'llama.cpp', 'main'),
    path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'main'),
    '/usr/local/bin/llama-cli',
    '/usr/local/bin/llama.cpp',
    // Windows paths
    path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'main.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'llama.cpp', 'main.exe'),
  ].filter(Boolean);
  
  for (const binaryPath of possiblePaths) {
    try {
      await fs.access(binaryPath);
      return binaryPath;
    } catch {
      continue;
    }
  }
  
  // Try to find via PATH
  return new Promise((resolve) => {
    exec('which llama-cli || which llama.cpp || where llama-cli.exe', (error, stdout) => {
      if (!error && stdout.trim()) {
        resolve(stdout.trim().split('\n')[0]);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Check if llama.cpp is available
 */
function isAvailable() {
  return isInitialized && llamaCppBinary !== null;
}

/**
 * List available base models
 */
async function listModels() {
  if (!CONFIG.modelsDir) return [];
  
  try {
    const files = await fs.readdir(CONFIG.modelsDir);
    const models = [];
    
    for (const file of files) {
      if (file.endsWith('.gguf')) {
        const stat = await fs.stat(path.join(CONFIG.modelsDir, file));
        models.push({
          name: file.replace('.gguf', ''),
          path: path.join(CONFIG.modelsDir, file),
          size: stat.size,
          modified: stat.mtime,
        });
      }
    }
    
    return models;
  } catch {
    return [];
  }
}

/**
 * List available adapters
 */
async function listAdapters() {
  if (!CONFIG.adaptersDir) return [];
  
  try {
    const files = await fs.readdir(CONFIG.adaptersDir);
    const adapters = [];
    
    for (const file of files) {
      if (file.endsWith('.bin') || file.endsWith('.gguf')) {
        const stat = await fs.stat(path.join(CONFIG.adaptersDir, file));
        
        // Try to load metadata
        let metadata = {};
        const metaPath = path.join(CONFIG.adaptersDir, file.replace(/\.(bin|gguf)$/, '.meta.json'));
        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          metadata = JSON.parse(metaContent);
        } catch {
          // No metadata file
        }
        
        adapters.push({
          name: file.replace(/\.(bin|gguf)$/, ''),
          path: path.join(CONFIG.adaptersDir, file),
          size: stat.size,
          modified: stat.mtime,
          metadata,
        });
      }
    }
    
    return adapters;
  } catch {
    return [];
  }
}

/**
 * Load an adapter for inference
 */
async function loadAdapter(adapterName) {
  const adapterPath = path.join(CONFIG.adaptersDir, `${adapterName}.bin`);
  
  try {
    await fs.access(adapterPath);
    loadedAdapters.set(adapterName, {
      path: adapterPath,
      loadedAt: new Date(),
    });
    
    console.log('[LlamaBridge] Loaded adapter:', adapterName);
    return { success: true, adapter: adapterName };
  } catch {
    return { success: false, error: `Adapter not found: ${adapterName}` };
  }
}

/**
 * Unload an adapter
 */
function unloadAdapter(adapterName) {
  if (loadedAdapters.has(adapterName)) {
    loadedAdapters.delete(adapterName);
    console.log('[LlamaBridge] Unloaded adapter:', adapterName);
    return { success: true };
  }
  return { success: false, error: 'Adapter not loaded' };
}

/**
 * Get currently loaded adapters
 */
function getLoadedAdapters() {
  return Array.from(loadedAdapters.entries()).map(([name, info]) => ({
    name,
    ...info,
  }));
}

/**
 * Run inference with llama.cpp
 */
async function inference(params) {
  if (!isAvailable()) {
    return { error: 'llama.cpp not available' };
  }
  
  const {
    model,
    prompt,
    systemPrompt,
    maxTokens = 512,
    temperature = 0.7,
    topP = 0.9,
    adapter = null,
  } = params;
  
  const modelPath = path.join(CONFIG.modelsDir, `${model}.gguf`);
  
  // Build command args
  const args = [
    '-m', modelPath,
    '-p', systemPrompt ? `[INST] ${systemPrompt}\n\n${prompt} [/INST]` : prompt,
    '-n', String(maxTokens),
    '--temp', String(temperature),
    '--top-p', String(topP),
    '-t', String(CONFIG.defaultThreads),
    '-c', String(CONFIG.defaultContextSize),
    '--no-mmap', // Safer for Windows
  ];
  
  // Add adapter if specified
  if (adapter && loadedAdapters.has(adapter)) {
    args.push('--lora', loadedAdapters.get(adapter).path);
  }
  
  return new Promise((resolve) => {
    let output = '';
    let error = '';
    
    currentProcess = spawn(llamaCppBinary, args, { windowsHide: true });
    
    currentProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    currentProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    currentProcess.on('close', (code) => {
      currentProcess = null;
      
      if (code === 0) {
        resolve({
          success: true,
          output: output.trim(),
          tokensGenerated: output.split(/\s+/).length, // Rough estimate
        });
      } else {
        resolve({
          success: false,
          error: error || `Process exited with code ${code}`,
        });
      }
    });
    
    currentProcess.on('error', (err) => {
      currentProcess = null;
      resolve({
        success: false,
        error: err.message,
      });
    });
  });
}

/**
 * Stop current inference
 */
function stopInference() {
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    return { success: true };
  }
  return { success: false, error: 'No process running' };
}

/**
 * Train a QLoRA adapter from friction data
 */
async function trainAdapter(params) {
  if (!isAvailable()) {
    return { error: 'llama.cpp not available' };
  }
  
  const {
    baseModel,
    adapterName,
    trainingData, // Array of { prompt, completion, weight } objects
    config = {},
  } = params;
  
  // Merge with defaults
  const trainConfig = {
    rank: config.rank || CONFIG.trainRank,
    alpha: config.alpha || CONFIG.trainAlpha,
    epochs: config.epochs || CONFIG.trainEpochs,
    batchSize: config.batchSize || CONFIG.trainBatchSize,
    learningRate: config.learningRate || CONFIG.trainLearningRate,
  };
  
  // Save training data to temp file
  const dataPath = path.join(CONFIG.adaptersDir, `${adapterName}_data.jsonl`);
  const dataContent = trainingData.map(d => JSON.stringify(d)).join('\n');
  await fs.writeFile(dataPath, dataContent, 'utf-8');
  
  const modelPath = path.join(CONFIG.modelsDir, `${baseModel}.gguf`);
  const outputPath = path.join(CONFIG.adaptersDir, `${adapterName}.bin`);
  
  // Note: Actual llama.cpp training requires finetune binary
  // This is a placeholder that shows the expected interface
  
  const trainBinary = llamaCppBinary.replace(/main(\.exe)?$/, 'finetune$1');
  
  try {
    await fs.access(trainBinary);
  } catch {
    // Clean up and return error
    await fs.unlink(dataPath).catch(() => {});
    return {
      success: false,
      error: 'llama.cpp finetune binary not found. QLoRA training requires llama.cpp compiled with training support.',
    };
  }
  
  const args = [
    '--model-base', modelPath,
    '--train-data', dataPath,
    '--lora-out', outputPath,
    '--lora-r', String(trainConfig.rank),
    '--lora-alpha', String(trainConfig.alpha),
    '--epochs', String(trainConfig.epochs),
    '--batch', String(trainConfig.batchSize),
    '--adam-alpha', String(trainConfig.learningRate),
    '--threads', String(CONFIG.defaultThreads),
  ];
  
  return new Promise((resolve) => {
    let output = '';
    let error = '';
    
    const trainProcess = spawn(trainBinary, args, { windowsHide: true });
    
    trainProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('[LlamaTrain]', data.toString().trim());
    });
    
    trainProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    trainProcess.on('close', async (code) => {
      // Clean up training data
      await fs.unlink(dataPath).catch(() => {});
      
      if (code === 0) {
        // Save metadata
        const metadata = {
          baseModel,
          created: new Date().toISOString(),
          config: trainConfig,
          samplesCount: trainingData.length,
        };
        const metaPath = path.join(CONFIG.adaptersDir, `${adapterName}.meta.json`);
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
        
        resolve({
          success: true,
          adapterPath: outputPath,
          metadata,
        });
      } else {
        resolve({
          success: false,
          error: error || `Training exited with code ${code}`,
          output,
        });
      }
    });
    
    trainProcess.on('error', async (err) => {
      await fs.unlink(dataPath).catch(() => {});
      resolve({
        success: false,
        error: err.message,
      });
    });
  });
}

/**
 * Delete an adapter
 */
async function deleteAdapter(adapterName) {
  const adapterPath = path.join(CONFIG.adaptersDir, `${adapterName}.bin`);
  const metaPath = path.join(CONFIG.adaptersDir, `${adapterName}.meta.json`);
  
  // Unload if loaded
  unloadAdapter(adapterName);
  
  try {
    await fs.unlink(adapterPath);
    await fs.unlink(metaPath).catch(() => {}); // Meta may not exist
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get system info for training
 */
async function getSystemInfo() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  
  // Try to detect GPU (basic detection)
  let gpuInfo = null;
  try {
    const si = require('systeminformation');
    const graphics = await si.graphics();
    gpuInfo = graphics.controllers.map(c => ({
      model: c.model,
      vram: c.vram,
      vendor: c.vendor,
    }));
  } catch {
    // systeminformation not available
  }
  
  return {
    cpu: {
      model: cpus[0]?.model,
      cores: cpus.length,
      speed: cpus[0]?.speed,
    },
    memory: {
      total: totalMemory,
      free: freeMemory,
      used: totalMemory - freeMemory,
    },
    gpu: gpuInfo,
    platform: os.platform(),
    arch: os.arch(),
  };
}

module.exports = {
  initialize,
  isAvailable,
  listModels,
  listAdapters,
  loadAdapter,
  unloadAdapter,
  getLoadedAdapters,
  inference,
  stopInference,
  trainAdapter,
  deleteAdapter,
  getSystemInfo,
  CONFIG,
};




