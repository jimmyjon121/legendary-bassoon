/**
 * LocalModelScanner - Scans for models from various sources
 * 
 * Supported sources:
 * - LM Studio (~/.cache/lm-studio/models)
 * - Ollama (~/.ollama/models)
 * - ComfyUI (multiple model directories)
 * - Automatic1111 (models/Stable-diffusion, etc.)
 * - Custom user paths
 * 
 * Features:
 * - Auto-detect common installation paths
 * - Index model files with metadata
 * - Import/link/move models into unified library
 * - Watch for changes (optional)
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const crypto = require('crypto');

// Common model file extensions
const MODEL_EXTENSIONS = {
  llm: ['.gguf', '.ggml', '.bin', '.safetensors', '.pt', '.pth'],
  image: ['.safetensors', '.ckpt', '.pt', '.pth'],
  lora: ['.safetensors', '.pt'],
  vae: ['.safetensors', '.pt'],
  controlnet: ['.safetensors', '.pth'],
  embedding: ['.safetensors', '.pt', '.bin'],
  audio: ['.bin', '.pt', '.onnx'],
};

// All recognized model extensions
const ALL_MODEL_EXTENSIONS = new Set([
  '.gguf', '.ggml', '.bin', '.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.xml'
]);

// Source configurations
const SOURCES = {
  'lm-studio': {
    name: 'LM Studio',
    icon: 'lm-studio',
    getDefaultPaths: () => {
      const home = os.homedir();
      return [
        path.join(home, '.cache', 'lm-studio', 'models'),
        path.join(home, 'AppData', 'Roaming', 'lm-studio', 'models'), // Windows
        path.join(home, 'Library', 'Application Support', 'lm-studio', 'models'), // macOS
      ];
    },
    modelTypes: ['llm', 'embedding'],
    subdirectories: {
      '*': 'llm', // All subdirs contain LLMs
    },
  },
  'ollama': {
    name: 'Ollama',
    icon: 'ollama',
    getDefaultPaths: () => {
      const home = os.homedir();
      return [
        path.join(home, '.ollama', 'models'),
        'C:\\Users\\' + os.userInfo().username + '\\.ollama\\models',
        '/usr/share/ollama/.ollama/models',
      ];
    },
    modelTypes: ['llm', 'embedding', 'vision'],
    isOllamaBlob: true, // Special handling for Ollama's blob storage
  },
  'comfyui': {
    name: 'ComfyUI',
    icon: 'comfyui',
    getDefaultPaths: () => {
      const home = os.homedir();
      return [
        path.join(home, 'ComfyUI', 'models'),
        'C:\\ComfyUI\\models',
        '/opt/ComfyUI/models',
        path.join(home, 'stable-diffusion-comfyui', 'models'),
      ];
    },
    modelTypes: ['image', 'lora', 'vae', 'controlnet', 'embedding'],
    subdirectories: {
      'checkpoints': 'image',
      'loras': 'lora',
      'vae': 'vae',
      'controlnet': 'controlnet',
      'embeddings': 'embedding',
      'unet': 'image',
      'clip': 'embedding',
    },
  },
  'automatic1111': {
    name: 'Automatic1111',
    icon: 'a1111',
    getDefaultPaths: () => {
      const home = os.homedir();
      return [
        path.join(home, 'stable-diffusion-webui'),
        'C:\\stable-diffusion-webui',
        '/opt/stable-diffusion-webui',
        path.join(home, 'Documents', 'stable-diffusion-webui'),
      ];
    },
    modelTypes: ['image', 'lora', 'vae', 'controlnet', 'embedding'],
    subdirectories: {
      'models/Stable-diffusion': 'image',
      'models/Lora': 'lora',
      'models/VAE': 'vae',
      'models/ControlNet': 'controlnet',
      'embeddings': 'embedding',
    },
  },
  'huggingface-cache': {
    name: 'HuggingFace Cache',
    icon: 'huggingface',
    getDefaultPaths: () => {
      const home = os.homedir();
      return [
        path.join(home, '.cache', 'huggingface', 'hub'),
        path.join(process.env.HF_HOME || '', 'hub'),
      ].filter(Boolean);
    },
    modelTypes: ['llm', 'image', 'embedding', 'audio'],
    isHfCache: true, // Special handling for HF cache structure
  },
};

/**
 * Represents a discovered model
 */
class DiscoveredModel {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name;
    this.filename = data.filename;
    this.path = data.path;
    this.size = data.size || 0;
    this.format = data.format;
    this.modelType = data.modelType;
    this.source = data.source;
    this.sourcePath = data.sourcePath;
    this.hash = data.hash || null;
    this.metadata = data.metadata || {};
    this.discoveredAt = data.discoveredAt || new Date().toISOString();
    this.modifiedAt = data.modifiedAt;
    this.isLinked = data.isLinked || false;
    this.linkedTo = data.linkedTo || null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      filename: this.filename,
      path: this.path,
      size: this.size,
      format: this.format,
      modelType: this.modelType,
      source: this.source,
      sourcePath: this.sourcePath,
      hash: this.hash,
      metadata: this.metadata,
      discoveredAt: this.discoveredAt,
      modifiedAt: this.modifiedAt,
      isLinked: this.isLinked,
      linkedTo: this.linkedTo,
    };
  }
}

/**
 * LocalModelScanner - Main scanner class
 */
class LocalModelScanner extends EventEmitter {
  constructor() {
    super();
    this.discoveredModels = new Map(); // path -> DiscoveredModel
    this.customPaths = [];
    this.scanning = false;
    this.watchers = new Map();
    this.scanCache = null;
    this.lastScanTime = null;
  }

  /**
   * Add a custom scan path
   */
  addCustomPath(scanPath, options = {}) {
    this.customPaths.push({
      path: scanPath,
      modelType: options.modelType || 'auto',
      name: options.name || path.basename(scanPath),
    });
  }

  /**
   * Remove a custom scan path
   */
  removeCustomPath(scanPath) {
    this.customPaths = this.customPaths.filter(p => p.path !== scanPath);
  }

  /**
   * Get all configured sources (built-in + custom)
   */
  getSources() {
    const sources = [];
    
    // Built-in sources
    for (const [sourceId, config] of Object.entries(SOURCES)) {
      const paths = config.getDefaultPaths();
      const detectedPath = paths.find(p => fs.existsSync(p));
      
      sources.push({
        id: sourceId,
        name: config.name,
        icon: config.icon,
        modelTypes: config.modelTypes,
        detected: !!detectedPath,
        path: detectedPath || paths[0],
        allPaths: paths,
      });
    }
    
    // Custom paths
    for (const custom of this.customPaths) {
      sources.push({
        id: `custom-${custom.path}`,
        name: custom.name,
        icon: 'folder',
        modelTypes: [custom.modelType],
        detected: fs.existsSync(custom.path),
        path: custom.path,
        isCustom: true,
      });
    }
    
    return sources;
  }

  /**
   * Scan all sources for models
   */
  async scanAll(options = {}) {
    if (this.scanning) {
      return { error: 'Scan already in progress' };
    }
    
    this.scanning = true;
    this.emit('scan:started');
    
    const results = {
      total: 0,
      bySource: {},
      byType: {},
      errors: [],
    };
    
    try {
      const sources = this.getSources().filter(s => s.detected);
      
      for (const source of sources) {
        try {
          this.emit('scan:source', { source: source.id, name: source.name });
          const models = await this._scanSource(source, options);
          
          results.bySource[source.id] = models.length;
          results.total += models.length;
          
          // Count by type
          for (const model of models) {
            results.byType[model.modelType] = (results.byType[model.modelType] || 0) + 1;
          }
        } catch (error) {
          console.error(`[Scanner] Error scanning ${source.id}:`, error);
          results.errors.push({ source: source.id, error: error.message });
        }
      }
      
      this.lastScanTime = new Date().toISOString();
      this.emit('scan:completed', results);
      
    } finally {
      this.scanning = false;
    }
    
    return results;
  }

  /**
   * Scan a specific source
   */
  async _scanSource(source, options = {}) {
    const config = SOURCES[source.id] || {};
    const models = [];
    
    if (config.isOllamaBlob) {
      // Special handling for Ollama's blob storage
      return this._scanOllamaModels(source.path);
    }
    
    if (config.isHfCache) {
      // Special handling for HuggingFace cache
      return this._scanHfCache(source.path);
    }
    
    // Standard directory scan
    const subdirs = config.subdirectories || { '.': source.modelTypes?.[0] || 'llm' };
    
    for (const [subdir, modelType] of Object.entries(subdirs)) {
      const scanPath = subdir === '.' || subdir === '*' 
        ? source.path 
        : path.join(source.path, subdir);
      
      if (!fs.existsSync(scanPath)) continue;
      
      const foundModels = await this._scanDirectory(
        scanPath, 
        modelType === '*' ? null : modelType,
        source.id,
        options
      );
      
      models.push(...foundModels);
    }
    
    return models;
  }

  /**
   * Scan a directory for model files
   */
  async _scanDirectory(dirPath, modelType, sourceId, options = {}) {
    const models = [];
    
    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Recurse into subdirectories
          if (!options.shallow) {
            const subModels = await this._scanDirectory(fullPath, modelType, sourceId, options);
            models.push(...subModels);
          }
          continue;
        }
        
        // Check if it's a model file
        const ext = path.extname(entry.name).toLowerCase();
        if (!ALL_MODEL_EXTENSIONS.has(ext)) continue;
        
        // Determine model type from extension if not specified
        const detectedType = modelType || this._detectModelType(ext, entry.name);
        
        try {
          const stats = await fsPromises.stat(fullPath);
          
          // Skip very small files (likely not real models)
          if (stats.size < 1024 * 1024) continue; // < 1MB
          
          const model = new DiscoveredModel({
            name: this._extractModelName(entry.name),
            filename: entry.name,
            path: fullPath,
            size: stats.size,
            format: ext.slice(1), // Remove dot
            modelType: detectedType,
            source: sourceId,
            sourcePath: dirPath,
            modifiedAt: stats.mtime.toISOString(),
          });
          
          this.discoveredModels.set(fullPath, model);
          models.push(model);
          
          this.emit('model:discovered', model.toJSON());
        } catch (error) {
          console.warn(`[Scanner] Could not stat ${fullPath}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`[Scanner] Error reading ${dirPath}:`, error.message);
    }
    
    return models;
  }

  /**
   * Scan Ollama's blob storage
   */
  async _scanOllamaModels(basePath) {
    const models = [];
    const manifestsPath = path.join(basePath, 'manifests', 'registry.ollama.ai', 'library');
    
    if (!fs.existsSync(manifestsPath)) return models;
    
    try {
      const modelDirs = await fsPromises.readdir(manifestsPath);
      
      for (const modelDir of modelDirs) {
        const modelPath = path.join(manifestsPath, modelDir);
        const tagFiles = await fsPromises.readdir(modelPath).catch(() => []);
        
        for (const tagFile of tagFiles) {
          if (tagFile.startsWith('.')) continue;
          
          try {
            const manifestPath = path.join(modelPath, tagFile);
            const manifestContent = await fsPromises.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent);
            
            // Find the model layer (largest blob)
            const modelLayer = manifest.layers?.find(l => 
              l.mediaType === 'application/vnd.ollama.image.model'
            );
            
            if (modelLayer) {
              const blobPath = path.join(basePath, 'blobs', modelLayer.digest.replace(':', '-'));
              const stats = await fsPromises.stat(blobPath).catch(() => null);
              
              if (stats) {
                const model = new DiscoveredModel({
                  name: `${modelDir}:${tagFile}`,
                  filename: `${modelDir}-${tagFile}`,
                  path: blobPath,
                  size: stats.size,
                  format: 'ollama',
                  modelType: 'llm',
                  source: 'ollama',
                  sourcePath: manifestPath,
                  modifiedAt: stats.mtime.toISOString(),
                  metadata: {
                    digest: modelLayer.digest,
                    mediaType: modelLayer.mediaType,
                  },
                });
                
                this.discoveredModels.set(blobPath, model);
                models.push(model);
                
                this.emit('model:discovered', model.toJSON());
              }
            }
          } catch (error) {
            console.warn(`[Scanner] Could not read Ollama manifest for ${modelDir}/${tagFile}`);
          }
        }
      }
    } catch (error) {
      console.error('[Scanner] Error scanning Ollama:', error);
    }
    
    return models;
  }

  /**
   * Scan HuggingFace cache
   */
  async _scanHfCache(basePath) {
    const models = [];
    
    if (!fs.existsSync(basePath)) return models;
    
    try {
      const repos = await fsPromises.readdir(basePath);
      
      for (const repo of repos) {
        if (!repo.startsWith('models--')) continue;
        
        const repoPath = path.join(basePath, repo, 'snapshots');
        if (!fs.existsSync(repoPath)) continue;
        
        const snapshots = await fsPromises.readdir(repoPath).catch(() => []);
        
        for (const snapshot of snapshots) {
          const snapshotPath = path.join(repoPath, snapshot);
          const files = await fsPromises.readdir(snapshotPath).catch(() => []);
          
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (!ALL_MODEL_EXTENSIONS.has(ext)) continue;
            
            const fullPath = path.join(snapshotPath, file);
            const stats = await fsPromises.stat(fullPath).catch(() => null);
            
            if (stats && stats.size > 1024 * 1024) {
              const repoName = repo.replace('models--', '').replace('--', '/');
              
              const model = new DiscoveredModel({
                name: `${repoName}/${file}`,
                filename: file,
                path: fullPath,
                size: stats.size,
                format: ext.slice(1),
                modelType: this._detectModelType(ext, file),
                source: 'huggingface-cache',
                sourcePath: snapshotPath,
                modifiedAt: stats.mtime.toISOString(),
                metadata: {
                  repository: repoName,
                  snapshot: snapshot,
                },
              });
              
              this.discoveredModels.set(fullPath, model);
              models.push(model);
              
              this.emit('model:discovered', model.toJSON());
            }
          }
        }
      }
    } catch (error) {
      console.error('[Scanner] Error scanning HF cache:', error);
    }
    
    return models;
  }

  /**
   * Detect model type from extension and filename
   */
  _detectModelType(ext, filename) {
    const lowerName = filename.toLowerCase();
    
    // Check filename hints
    if (lowerName.includes('lora') || lowerName.includes('_lora')) return 'lora';
    if (lowerName.includes('vae')) return 'vae';
    if (lowerName.includes('controlnet') || lowerName.includes('control_')) return 'controlnet';
    if (lowerName.includes('embed') || lowerName.includes('textual_inversion')) return 'embedding';
    if (lowerName.includes('whisper') || lowerName.includes('tts')) return 'audio';
    
    // Check extension
    if (ext === '.gguf' || ext === '.ggml') return 'llm';
    if (ext === '.ckpt') return 'image';
    if (ext === '.onnx') return 'llm'; // Could be various
    
    // Default based on size or other heuristics
    return 'llm';
  }

  /**
   * Extract model name from filename
   */
  _extractModelName(filename) {
    // Remove extension
    let name = filename.replace(/\.[^.]+$/, '');
    
    // Remove common suffixes
    name = name.replace(/[-_](Q[0-9]+_[A-Z]+|fp16|fp32|int8|int4)$/i, '');
    name = name.replace(/[-_](GGUF|safetensors|ckpt)$/i, '');
    
    // Replace underscores/hyphens with spaces for display
    name = name.replace(/[-_]+/g, ' ');
    
    return name;
  }

  /**
   * Get all discovered models
   */
  getAllModels() {
    return Array.from(this.discoveredModels.values()).map(m => m.toJSON());
  }

  /**
   * Get models by source
   */
  getModelsBySource(sourceId) {
    return this.getAllModels().filter(m => m.source === sourceId);
  }

  /**
   * Get models by type
   */
  getModelsByType(modelType) {
    return this.getAllModels().filter(m => m.modelType === modelType);
  }

  /**
   * Get a specific model by path
   */
  getModel(modelPath) {
    const model = this.discoveredModels.get(modelPath);
    return model ? model.toJSON() : null;
  }

  /**
   * Import a model to the library (copy)
   */
  async importModel(modelPath, targetDir, options = {}) {
    const model = this.discoveredModels.get(modelPath);
    if (!model) {
      throw new Error('Model not found');
    }
    
    const targetPath = path.join(targetDir, model.filename);
    
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });
    
    // Copy file with progress
    const stats = await fsPromises.stat(model.path);
    let copied = 0;
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(model.path);
      const writeStream = fs.createWriteStream(targetPath);
      
      readStream.on('data', (chunk) => {
        copied += chunk.length;
        if (options.onProgress) {
          options.onProgress({
            copied,
            total: stats.size,
            progress: Math.round((copied / stats.size) * 100),
          });
        }
      });
      
      readStream.on('error', reject);
      writeStream.on('error', reject);
      
      writeStream.on('finish', () => {
        resolve({
          success: true,
          originalPath: model.path,
          importedPath: targetPath,
          size: stats.size,
        });
      });
      
      readStream.pipe(writeStream);
    });
  }

  /**
   * Link a model to the library (symlink/junction)
   */
  async linkModel(modelPath, targetDir, options = {}) {
    const model = this.discoveredModels.get(modelPath);
    if (!model) {
      throw new Error('Model not found');
    }
    
    const targetPath = path.join(targetDir, model.filename);
    
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });
    
    // Create symlink (or junction on Windows for directories)
    const linkType = process.platform === 'win32' ? 'junction' : 'file';
    
    try {
      await fsPromises.symlink(model.path, targetPath, linkType);
      
      // Update model record
      model.isLinked = true;
      model.linkedTo = targetPath;
      
      return {
        success: true,
        originalPath: model.path,
        linkedPath: targetPath,
        linkType,
      };
    } catch (error) {
      // On Windows, symlinks may require admin privileges
      if (error.code === 'EPERM') {
        throw new Error('Symlink creation requires administrator privileges on Windows');
      }
      throw error;
    }
  }

  /**
   * Move a model to the library
   */
  async moveModel(modelPath, targetDir, options = {}) {
    const model = this.discoveredModels.get(modelPath);
    if (!model) {
      throw new Error('Model not found');
    }
    
    const targetPath = path.join(targetDir, model.filename);
    
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });
    
    try {
      // Try rename first (fastest if same filesystem)
      await fsPromises.rename(model.path, targetPath);
    } catch (error) {
      // If rename fails (cross-filesystem), copy then delete
      if (error.code === 'EXDEV') {
        const copyResult = await this.importModel(modelPath, targetDir, options);
        await fsPromises.unlink(model.path);
        return {
          ...copyResult,
          moved: true,
        };
      }
      throw error;
    }
    
    // Update model record
    model.path = targetPath;
    model.sourcePath = targetDir;
    
    return {
      success: true,
      originalPath: modelPath,
      movedPath: targetPath,
    };
  }

  /**
   * Start watching for model changes
   */
  startWatching(sourceId) {
    const sources = this.getSources().filter(s => 
      s.detected && (sourceId ? s.id === sourceId : true)
    );
    
    for (const source of sources) {
      if (this.watchers.has(source.id)) continue;
      
      try {
        const watcher = fs.watch(source.path, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          
          const ext = path.extname(filename).toLowerCase();
          if (!ALL_MODEL_EXTENSIONS.has(ext)) return;
          
          this.emit('model:changed', {
            source: source.id,
            event: eventType,
            filename,
          });
          
          // Rescan on changes (debounced)
          this._debouncedRescan();
        });
        
        this.watchers.set(source.id, watcher);
      } catch (error) {
        console.error(`[Scanner] Could not watch ${source.id}:`, error);
      }
    }
  }

  /**
   * Stop watching for changes
   */
  stopWatching(sourceId) {
    if (sourceId) {
      const watcher = this.watchers.get(sourceId);
      if (watcher) {
        watcher.close();
        this.watchers.delete(sourceId);
      }
    } else {
      for (const [id, watcher] of this.watchers) {
        watcher.close();
      }
      this.watchers.clear();
    }
  }

  _debouncedRescan = (() => {
    let timeout = null;
    return () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        this.scanAll({ shallow: true });
      }, 2000);
    };
  })();

  /**
   * Clear all discovered models
   */
  clear() {
    this.discoveredModels.clear();
    this.emit('scan:cleared');
  }
}

// Singleton
let scannerInstance = null;

function getLocalModelScanner() {
  if (!scannerInstance) {
    scannerInstance = new LocalModelScanner();
  }
  return scannerInstance;
}

module.exports = {
  LocalModelScanner,
  getLocalModelScanner,
  SOURCES,
  MODEL_EXTENSIONS,
  DiscoveredModel,
};



