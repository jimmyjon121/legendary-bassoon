/**
 * InstallerRegistry - Manages model installation across different engines
 * 
 * Features:
 * - Engine-specific installers (Ollama, llama.cpp, ComfyUI, etc.)
 * - Dependency graph for models (VAE, LoRA, etc.)
 * - Post-install validation and readiness checks
 * - Format-specific handling (GGUF, safetensors, ONNX, etc.)
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { spawn } = require('child_process');

// Model types
const ModelType = {
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

// Engine IDs
const Engine = {
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

// File formats
const Format = {
  GGUF: 'gguf',
  SAFETENSORS: 'safetensors',
  PYTORCH: 'pytorch',
  ONNX: 'onnx',
  OPENVINO: 'openvino',
  BIN: 'bin',
};

// Engine capability matrix
const ENGINE_CAPABILITIES = {
  [Engine.OLLAMA]: {
    modelTypes: [ModelType.LLM, ModelType.VISION, ModelType.EMBEDDING],
    formats: [Format.GGUF],
    features: ['streaming', 'quantization', 'multimodal'],
    installMethod: 'ollama-pull',
  },
  [Engine.LLAMACPP]: {
    modelTypes: [ModelType.LLM, ModelType.EMBEDDING],
    formats: [Format.GGUF],
    features: ['streaming', 'quantization', 'gpu-offload'],
    installMethod: 'file-copy',
  },
  [Engine.COMFYUI]: {
    modelTypes: [ModelType.IMAGE, ModelType.VIDEO, ModelType.LORA, ModelType.VAE, ModelType.CONTROLNET],
    formats: [Format.SAFETENSORS, Format.PYTORCH],
    features: ['workflows', 'lora', 'controlnet'],
    installMethod: 'file-copy',
  },
  [Engine.A1111]: {
    modelTypes: [ModelType.IMAGE, ModelType.LORA, ModelType.VAE, ModelType.CONTROLNET],
    formats: [Format.SAFETENSORS, Format.PYTORCH],
    features: ['extensions', 'lora', 'controlnet'],
    installMethod: 'file-copy',
  },
  [Engine.WHISPER]: {
    modelTypes: [ModelType.AUDIO],
    formats: [Format.PYTORCH, Format.ONNX],
    features: ['transcription', 'translation'],
    installMethod: 'file-copy',
  },
  [Engine.OPENVINO]: {
    modelTypes: [ModelType.LLM, ModelType.IMAGE, ModelType.AUDIO],
    formats: [Format.OPENVINO],
    features: ['npu-acceleration', 'quantization'],
    installMethod: 'file-copy',
  },
};

// Base Installer class
class BaseInstaller {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.options = options;
    this.capabilities = ENGINE_CAPABILITIES[engine] || {};
  }

  /**
   * Check if this installer can handle the given model
   */
  canInstall(modelInfo) {
    const { modelType, format } = modelInfo;
    return (
      this.capabilities.modelTypes?.includes(modelType) &&
      this.capabilities.formats?.includes(format)
    );
  }

  /**
   * Get required dependencies for a model
   */
  getDependencies(modelInfo) {
    // Override in subclasses
    return [];
  }

  /**
   * Install a model
   */
  async install(filePath, modelInfo, progressCallback) {
    throw new Error('install() must be implemented by subclass');
  }

  /**
   * Validate installation
   */
  async validate(modelInfo) {
    throw new Error('validate() must be implemented by subclass');
  }

  /**
   * Perform readiness check (can the model be used?)
   */
  async readinessCheck(modelInfo) {
    throw new Error('readinessCheck() must be implemented by subclass');
  }

  /**
   * Uninstall a model
   */
  async uninstall(modelInfo) {
    throw new Error('uninstall() must be implemented by subclass');
  }
}

// Ollama Installer
class OllamaInstaller extends BaseInstaller {
  constructor(options = {}) {
    super(Engine.OLLAMA, options);
    this.endpoint = options.endpoint || 'http://localhost:11434';
  }

  async install(filePath, modelInfo, progressCallback) {
    const { name, modelType } = modelInfo;
    
    // For Ollama, we can either pull from registry or create from GGUF file
    if (filePath) {
      // Create model from local GGUF file
      return this._createFromFile(filePath, name, progressCallback);
    } else if (name) {
      // Pull from Ollama registry
      return this._pullFromRegistry(name, progressCallback);
    }
    
    throw new Error('Either filePath or name is required for Ollama installation');
  }

  async _pullFromRegistry(modelName, progressCallback) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = new URL(`${this.endpoint}/api/pull`);
      
      const postData = JSON.stringify({ name: modelName, stream: true });
      
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let buffer = '';
        
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (progressCallback) {
                progressCallback({
                  status: data.status,
                  completed: data.completed || 0,
                  total: data.total || 0,
                  progress: data.total ? Math.round((data.completed / data.total) * 100) : 0,
                });
              }
              if (data.error) {
                reject(new Error(data.error));
                return;
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        });
        
        res.on('end', () => {
          resolve({ success: true, name: modelName });
        });
        
        res.on('error', reject);
      });
      
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  async _createFromFile(filePath, modelName, progressCallback) {
    // Read GGUF file and create Modelfile
    const modelfilePath = path.join(path.dirname(filePath), 'Modelfile');
    const modelfileContent = `FROM ${filePath}`;
    
    await fsPromises.writeFile(modelfilePath, modelfileContent);
    
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = new URL(`${this.endpoint}/api/create`);
      
      const postData = JSON.stringify({ 
        name: modelName, 
        modelfile: modelfileContent,
        stream: true 
      });
      
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let buffer = '';
        
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (progressCallback) {
                progressCallback({ status: data.status });
              }
              if (data.error) {
                reject(new Error(data.error));
                return;
              }
            } catch (e) {
              // Skip
            }
          }
        });
        
        res.on('end', async () => {
          // Cleanup Modelfile
          await fsPromises.unlink(modelfilePath).catch(() => {});
          resolve({ success: true, name: modelName });
        });
        
        res.on('error', reject);
      });
      
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  async validate(modelInfo) {
    try {
      const http = require('http');
      const url = new URL(`${this.endpoint}/api/show`);
      
      return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ name: modelInfo.name });
        
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ valid: true, details: JSON.parse(data) });
            } else {
              resolve({ valid: false, error: 'Model not found' });
            }
          });
        });
        
        req.on('error', () => resolve({ valid: false, error: 'Ollama not available' }));
        req.write(postData);
        req.end();
      });
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async readinessCheck(modelInfo) {
    const validation = await this.validate(modelInfo);
    if (!validation.valid) {
      return { ready: false, error: validation.error };
    }
    
    // Try a simple generation to confirm model works
    try {
      const http = require('http');
      const url = new URL(`${this.endpoint}/api/generate`);
      
      return new Promise((resolve) => {
        const postData = JSON.stringify({ 
          model: modelInfo.name,
          prompt: 'test',
          stream: false,
          options: { num_predict: 1 }
        });
        
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ready: true });
            } else {
              resolve({ ready: false, error: 'Model failed to generate' });
            }
          });
        });
        
        req.on('error', () => resolve({ ready: false, error: 'Generation test failed' }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ ready: false, error: 'Generation test timed out' });
        });
        req.write(postData);
        req.end();
      });
    } catch (error) {
      return { ready: false, error: error.message };
    }
  }

  async uninstall(modelInfo) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = new URL(`${this.endpoint}/api/delete`);
      
      const postData = JSON.stringify({ name: modelInfo.name });
      
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `HTTP ${res.statusCode}` });
        }
      });
      
      req.on('error', () => resolve({ success: false, error: 'Ollama not available' }));
      req.write(postData);
      req.end();
    });
  }
}

// File Copy Installer (for ComfyUI, A1111, etc.)
class FileCopyInstaller extends BaseInstaller {
  constructor(engine, options = {}) {
    super(engine, options);
    this.targetDir = options.targetDir;
    this.subdirectories = options.subdirectories || {};
  }

  async install(filePath, modelInfo, progressCallback) {
    const { modelType, filename } = modelInfo;
    
    // Determine target directory based on model type
    const subdir = this.subdirectories[modelType] || '';
    const targetDir = path.join(this.targetDir, subdir);
    const targetPath = path.join(targetDir, filename || path.basename(filePath));
    
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });
    
    // Copy file with progress
    const stats = await fsPromises.stat(filePath);
    const totalBytes = stats.size;
    let copiedBytes = 0;
    
    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(targetPath);
    
    return new Promise((resolve, reject) => {
      readStream.on('data', (chunk) => {
        copiedBytes += chunk.length;
        if (progressCallback) {
          progressCallback({
            status: 'copying',
            completed: copiedBytes,
            total: totalBytes,
            progress: Math.round((copiedBytes / totalBytes) * 100),
          });
        }
      });
      
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => {
        resolve({
          success: true,
          installedPath: targetPath,
        });
      });
      
      readStream.pipe(writeStream);
    });
  }

  async validate(modelInfo) {
    const targetPath = modelInfo.installedPath;
    if (!targetPath) {
      return { valid: false, error: 'No installed path specified' };
    }
    
    try {
      const stats = await fsPromises.stat(targetPath);
      return {
        valid: true,
        size: stats.size,
        modifiedAt: stats.mtime,
      };
    } catch (error) {
      return { valid: false, error: 'File not found' };
    }
  }

  async readinessCheck(modelInfo) {
    // For file-based installations, just check if the file exists
    const validation = await this.validate(modelInfo);
    return { ready: validation.valid, error: validation.error };
  }

  async uninstall(modelInfo) {
    const targetPath = modelInfo.installedPath;
    if (!targetPath) {
      return { success: false, error: 'No installed path specified' };
    }
    
    try {
      await fsPromises.unlink(targetPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// ComfyUI Installer
class ComfyUIInstaller extends FileCopyInstaller {
  constructor(options = {}) {
    super(Engine.COMFYUI, {
      ...options,
      subdirectories: {
        [ModelType.IMAGE]: 'checkpoints',
        [ModelType.LORA]: 'loras',
        [ModelType.VAE]: 'vae',
        [ModelType.CONTROLNET]: 'controlnet',
        [ModelType.EMBEDDING]: 'embeddings',
      },
    });
  }

  getDependencies(modelInfo) {
    const deps = [];
    
    // Many SD models need a VAE
    if (modelInfo.modelType === ModelType.IMAGE) {
      if (modelInfo.requiresVae !== false) {
        deps.push({
          type: ModelType.VAE,
          name: 'default-vae',
          optional: true,
        });
      }
    }
    
    return deps;
  }
}

// A1111 Installer
class A1111Installer extends FileCopyInstaller {
  constructor(options = {}) {
    super(Engine.A1111, {
      ...options,
      subdirectories: {
        [ModelType.IMAGE]: 'models/Stable-diffusion',
        [ModelType.LORA]: 'models/Lora',
        [ModelType.VAE]: 'models/VAE',
        [ModelType.CONTROLNET]: 'models/ControlNet',
        [ModelType.EMBEDDING]: 'embeddings',
      },
    });
  }

  getDependencies(modelInfo) {
    const deps = [];
    
    if (modelInfo.modelType === ModelType.IMAGE && modelInfo.requiresVae !== false) {
      deps.push({
        type: ModelType.VAE,
        name: 'default-vae',
        optional: true,
      });
    }
    
    return deps;
  }
}

/**
 * InstallerRegistry - Main registry for all installers
 */
class InstallerRegistry extends EventEmitter {
  constructor() {
    super();
    this.installers = new Map();
    this.enginePaths = new Map();
    this.ollamaEndpoint = 'http://localhost:11434';
  }

  /**
   * Initialize the registry with detected engines
   */
  async initialize(config = {}) {
    this.ollamaEndpoint = config.ollamaEndpoint || this.ollamaEndpoint;
    
    // Register default installers
    this.registerInstaller(Engine.OLLAMA, new OllamaInstaller({
      endpoint: this.ollamaEndpoint,
    }));
    
    // Detect and register other engines
    await this._detectEngines(config);
    
    console.log('[InstallerRegistry] Initialized with engines:', [...this.installers.keys()]);
  }

  /**
   * Detect available engines on the system
   */
  async _detectEngines(config) {
    // Check for ComfyUI
    const comfyPaths = config.comfyuiPath ? [config.comfyuiPath] : [
      path.join(process.env.USERPROFILE || '', 'ComfyUI'),
      'C:\\ComfyUI',
      '/opt/ComfyUI',
      path.join(process.env.HOME || '', 'ComfyUI'),
    ];
    
    for (const comfyPath of comfyPaths) {
      const modelsPath = path.join(comfyPath, 'models');
      if (fs.existsSync(modelsPath)) {
        this.enginePaths.set(Engine.COMFYUI, comfyPath);
        this.registerInstaller(Engine.COMFYUI, new ComfyUIInstaller({
          targetDir: modelsPath,
        }));
        break;
      }
    }
    
    // Check for A1111
    const a1111Paths = config.a1111Path ? [config.a1111Path] : [
      path.join(process.env.USERPROFILE || '', 'stable-diffusion-webui'),
      'C:\\stable-diffusion-webui',
      '/opt/stable-diffusion-webui',
      path.join(process.env.HOME || '', 'stable-diffusion-webui'),
    ];
    
    for (const a1111Path of a1111Paths) {
      const modelsPath = path.join(a1111Path, 'models');
      if (fs.existsSync(modelsPath)) {
        this.enginePaths.set(Engine.A1111, a1111Path);
        this.registerInstaller(Engine.A1111, new A1111Installer({
          targetDir: a1111Path,
        }));
        break;
      }
    }
    
    // Register llama.cpp installer
    if (config.llamacppPath) {
      this.enginePaths.set(Engine.LLAMACPP, config.llamacppPath);
      this.registerInstaller(Engine.LLAMACPP, new FileCopyInstaller(Engine.LLAMACPP, {
        targetDir: path.join(config.llamacppPath, 'models'),
      }));
    }
  }

  /**
   * Register an installer
   */
  registerInstaller(engineId, installer) {
    this.installers.set(engineId, installer);
    this.emit('installer:registered', { engineId });
  }

  /**
   * Get installer for a specific engine
   */
  getInstaller(engineId) {
    return this.installers.get(engineId);
  }

  /**
   * Get available engines for a model type
   */
  getEnginesForModelType(modelType) {
    const engines = [];
    for (const [engineId, installer] of this.installers) {
      if (installer.capabilities.modelTypes?.includes(modelType)) {
        engines.push({
          engineId,
          capabilities: installer.capabilities,
        });
      }
    }
    return engines;
  }

  /**
   * Get recommended engine for a model
   */
  getRecommendedEngine(modelInfo) {
    const { modelType, format } = modelInfo;
    
    // Priority: Ollama for LLMs with GGUF
    if (modelType === ModelType.LLM && format === Format.GGUF) {
      if (this.installers.has(Engine.OLLAMA)) {
        return Engine.OLLAMA;
      }
      if (this.installers.has(Engine.LLAMACPP)) {
        return Engine.LLAMACPP;
      }
    }
    
    // ComfyUI preferred for image models
    if ([ModelType.IMAGE, ModelType.LORA, ModelType.VAE, ModelType.CONTROLNET].includes(modelType)) {
      if (this.installers.has(Engine.COMFYUI)) {
        return Engine.COMFYUI;
      }
      if (this.installers.has(Engine.A1111)) {
        return Engine.A1111;
      }
    }
    
    // Find any compatible engine
    for (const [engineId, installer] of this.installers) {
      if (installer.canInstall(modelInfo)) {
        return engineId;
      }
    }
    
    return null;
  }

  /**
   * Install a model using the appropriate installer
   */
  async install(filePath, modelInfo, options = {}) {
    const engineId = options.engine || this.getRecommendedEngine(modelInfo);
    
    if (!engineId) {
      throw new Error(`No compatible engine found for model type: ${modelInfo.modelType}`);
    }
    
    const installer = this.installers.get(engineId);
    if (!installer) {
      throw new Error(`Installer not found for engine: ${engineId}`);
    }
    
    // Check dependencies first
    const deps = installer.getDependencies(modelInfo);
    const missingDeps = [];
    
    for (const dep of deps) {
      if (!dep.optional) {
        // Check if dependency is installed
        const depValidation = await installer.validate({
          ...dep,
          name: dep.name,
        });
        if (!depValidation.valid) {
          missingDeps.push(dep);
        }
      }
    }
    
    if (missingDeps.length > 0) {
      this.emit('install:dependencies-required', {
        model: modelInfo,
        dependencies: missingDeps,
      });
      
      if (!options.ignoreDependencies) {
        throw new Error(`Missing dependencies: ${missingDeps.map(d => d.name).join(', ')}`);
      }
    }
    
    // Perform installation
    this.emit('install:started', { modelInfo, engineId });
    
    const result = await installer.install(filePath, modelInfo, (progress) => {
      this.emit('install:progress', { modelInfo, engineId, ...progress });
    });
    
    if (result.success) {
      this.emit('install:completed', { modelInfo, engineId, result });
      
      // Run readiness check if requested
      if (options.runReadinessCheck) {
        const readiness = await installer.readinessCheck({
          ...modelInfo,
          ...result,
        });
        result.readiness = readiness;
      }
    }
    
    return result;
  }

  /**
   * Validate an installed model
   */
  async validate(modelInfo, engineId) {
    const installer = this.installers.get(engineId);
    if (!installer) {
      return { valid: false, error: 'Engine not found' };
    }
    return installer.validate(modelInfo);
  }

  /**
   * Run readiness check on an installed model
   */
  async readinessCheck(modelInfo, engineId) {
    const installer = this.installers.get(engineId);
    if (!installer) {
      return { ready: false, error: 'Engine not found' };
    }
    return installer.readinessCheck(modelInfo);
  }

  /**
   * Uninstall a model
   */
  async uninstall(modelInfo, engineId) {
    const installer = this.installers.get(engineId);
    if (!installer) {
      return { success: false, error: 'Engine not found' };
    }
    
    this.emit('uninstall:started', { modelInfo, engineId });
    const result = await installer.uninstall(modelInfo);
    
    if (result.success) {
      this.emit('uninstall:completed', { modelInfo, engineId });
    }
    
    return result;
  }

  /**
   * Get all registered engines info
   */
  getEnginesInfo() {
    const info = [];
    for (const [engineId, installer] of this.installers) {
      info.push({
        engineId,
        capabilities: installer.capabilities,
        path: this.enginePaths.get(engineId),
      });
    }
    return info;
  }
}

// Singleton
let registryInstance = null;

function getInstallerRegistry() {
  if (!registryInstance) {
    registryInstance = new InstallerRegistry();
  }
  return registryInstance;
}

module.exports = {
  InstallerRegistry,
  getInstallerRegistry,
  ModelType,
  Engine,
  Format,
  ENGINE_CAPABILITIES,
  OllamaInstaller,
  FileCopyInstaller,
  ComfyUIInstaller,
  A1111Installer,
};



