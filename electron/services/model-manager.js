/**
 * Model Manager Service
 * Manages local models across different formats
 * 
 * Supported formats:
 * - GGUF (llama.cpp, Ollama)
 * - ONNX (OpenVINO, DirectML)
 * - OpenVINO IR (.xml/.bin)
 * - SafeTensors (HuggingFace)
 * - PyTorch (.pt, .pth)
 * - Pickle (.pkl)
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Model format definitions
const MODEL_FORMATS = {
  gguf: {
    extensions: ['.gguf'],
    name: 'GGUF',
    backends: ['ollama', 'llamacpp'],
    description: 'Quantized format for llama.cpp',
    icon: '🦙',
    priority: 1
  },
  onnx: {
    extensions: ['.onnx'],
    name: 'ONNX',
    backends: ['openvino', 'directml'],
    description: 'Open Neural Network Exchange format',
    icon: '🔷',
    priority: 2
  },
  openvino: {
    extensions: ['.xml'],
    name: 'OpenVINO IR',
    backends: ['openvino'],
    description: 'Intel OpenVINO Intermediate Representation',
    icon: '🔶',
    priority: 3
  },
  safetensors: {
    extensions: ['.safetensors'],
    name: 'SafeTensors',
    backends: ['transformers'],
    description: 'Safe tensor format from HuggingFace',
    icon: '🤗',
    priority: 4
  },
  pytorch: {
    extensions: ['.pt', '.pth'],
    name: 'PyTorch',
    backends: ['pytorch'],
    description: 'PyTorch model checkpoint',
    icon: '🔥',
    priority: 5
  },
  bin: {
    extensions: ['.bin'],
    name: 'Binary Weights',
    backends: ['various'],
    description: 'Binary weight files (usually paired with config)',
    icon: '📦',
    priority: 6
  }
};

// Common locations where AI models might be stored
const COMMON_MODEL_LOCATIONS = {
  win32: [
    // Ollama models
    path.join(os.homedir(), '.ollama', 'models'),
    path.join(os.homedir(), 'AppData', 'Local', 'Ollama', 'models'),
    // LM Studio
    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
    path.join(os.homedir(), 'AppData', 'Local', 'LM Studio', 'models'),
    // GPT4All
    path.join(os.homedir(), 'AppData', 'Local', 'nomic.ai', 'GPT4All'),
    // HuggingFace cache
    path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    // Common download folders
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents', 'AI Models'),
    path.join(os.homedir(), 'Models'),
    // Common install paths
    'C:\\AI\\models',
    'C:\\Models',
    'D:\\AI\\models',
    'D:\\Models',
  ],
  darwin: [
    path.join(os.homedir(), '.ollama', 'models'),
    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents', 'AI Models'),
  ],
  linux: [
    path.join(os.homedir(), '.ollama', 'models'),
    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
    path.join(os.homedir(), '.local', 'share', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents', 'AI Models'),
    '/opt/models',
  ]
};

class ModelManager {
  constructor(config = {}) {
    this.modelsDirectory = config.modelsDirectory || null;
    this.models = new Map();
    this.lastScan = null;
    this.scanInProgress = false;
  }

  /**
   * Set the models directory
   */
  setModelsDirectory(directory) {
    this.modelsDirectory = directory;
    this.models.clear();
    this.lastScan = null;
  }

  /**
   * Detect model format from file extension
   */
  detectFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    for (const [format, config] of Object.entries(MODEL_FORMATS)) {
      if (config.extensions.includes(ext)) {
        return format;
      }
    }
    
    return null;
  }

  /**
   * Get file size in human-readable format
   */
  formatFileSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    } else if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  }

  /**
   * Extract model info from GGUF filename
   */
  parseGgufName(filename) {
    const info = {
      name: filename,
      quantization: null,
      parameters: null
    };

    // Common patterns: model-7b-q4_k_m.gguf, llama-2-13b-chat.Q4_K_M.gguf
    const quantMatch = filename.match(/[._-](q\d+[_a-z]*|Q\d+[_A-Z]*)/i);
    if (quantMatch) {
      info.quantization = quantMatch[1].toUpperCase();
    }

    const paramMatch = filename.match(/(\d+)[bB]/);
    if (paramMatch) {
      info.parameters = parseInt(paramMatch[1]);
    }

    // Clean up name
    info.name = filename
      .replace(/\.gguf$/i, '')
      .replace(/[._-](q\d+[_a-z]*|Q\d+[_A-Z]*)/gi, '')
      .replace(/[._-](\d+)[bB]/g, ' $1B')
      .replace(/[._-]/g, ' ')
      .trim();

    return info;
  }

  /**
   * Scan a directory for models
   */
  async scanDirectory(directory = null) {
    const scanDir = directory || this.modelsDirectory;
    
    if (!scanDir) {
      return { models: [], error: 'No models directory configured' };
    }

    if (!fs.existsSync(scanDir)) {
      return { models: [], error: 'Directory does not exist' };
    }

    if (this.scanInProgress) {
      return { models: Array.from(this.models.values()), scanning: true };
    }

    this.scanInProgress = true;
    const foundModels = [];

    try {
      await this._scanRecursive(scanDir, foundModels, 0, 3); // Max depth of 3
      
      // Update cache
      this.models.clear();
      for (const model of foundModels) {
        this.models.set(model.id, model);
      }
      
      this.lastScan = Date.now();
      this.scanInProgress = false;

      return { 
        models: foundModels, 
        count: foundModels.length,
        directory: scanDir,
        timestamp: this.lastScan
      };
    } catch (error) {
      this.scanInProgress = false;
      return { models: [], error: error.message };
    }
  }

  /**
   * Recursively scan directory for models
   */
  async _scanRecursive(dir, models, depth, maxDepth) {
    if (depth > maxDepth) return;

    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common non-model directories
          if (['node_modules', '.git', '__pycache__', 'venv'].includes(entry.name)) {
            continue;
          }
          await this._scanRecursive(fullPath, models, depth + 1, maxDepth);
        } else if (entry.isFile()) {
          const format = this.detectFormat(entry.name);
          if (format) {
            const modelInfo = await this._getModelInfo(fullPath, format);
            if (modelInfo) {
              models.push(modelInfo);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning ${dir}:`, error.message);
    }
  }

  /**
   * Get detailed model information
   */
  async _getModelInfo(filePath, format) {
    try {
      const stats = await fsPromises.stat(filePath);
      const filename = path.basename(filePath);
      
      // Generate unique ID
      const id = crypto.createHash('md5')
        .update(filePath)
        .digest('hex')
        .substring(0, 12);

      const modelInfo = {
        id,
        filename,
        path: filePath,
        format,
        formatName: MODEL_FORMATS[format]?.name || format,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        modified: stats.mtime,
        backends: MODEL_FORMATS[format]?.backends || [],
      };

      // Parse additional info based on format
      if (format === 'gguf') {
        const parsed = this.parseGgufName(filename);
        modelInfo.name = parsed.name;
        modelInfo.quantization = parsed.quantization;
        modelInfo.parameters = parsed.parameters;
        modelInfo.estimatedVram = this._estimateVram(parsed.parameters, parsed.quantization);
      } else if (format === 'openvino') {
        // Check for corresponding .bin file
        const binPath = filePath.replace('.xml', '.bin');
        if (fs.existsSync(binPath)) {
          const binStats = await fsPromises.stat(binPath);
          modelInfo.weightsPath = binPath;
          modelInfo.weightsSize = binStats.size;
          modelInfo.totalSize = stats.size + binStats.size;
          modelInfo.sizeFormatted = this.formatFileSize(modelInfo.totalSize);
        }
        modelInfo.name = filename.replace('.xml', '');
      } else {
        modelInfo.name = filename.replace(/\.[^.]+$/, '');
      }

      return modelInfo;
    } catch (error) {
      console.error(`Error getting info for ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Estimate VRAM usage based on parameters and quantization
   */
  _estimateVram(parameters, quantization) {
    if (!parameters) return null;

    // Base: ~1GB per billion parameters for FP16
    let bytesPerParam = 2;

    if (quantization) {
      const quant = quantization.toUpperCase();
      if (quant.includes('Q2')) bytesPerParam = 0.3;
      else if (quant.includes('Q3')) bytesPerParam = 0.4;
      else if (quant.includes('Q4')) bytesPerParam = 0.5;
      else if (quant.includes('Q5')) bytesPerParam = 0.6;
      else if (quant.includes('Q6')) bytesPerParam = 0.75;
      else if (quant.includes('Q8')) bytesPerParam = 1;
    }

    const estimatedBytes = parameters * 1e9 * bytesPerParam;
    return {
      bytes: estimatedBytes,
      formatted: this.formatFileSize(estimatedBytes)
    };
  }

  /**
   * Get all cached models
   */
  getModels() {
    return Array.from(this.models.values());
  }

  /**
   * Get model by ID
   */
  getModel(id) {
    return this.models.get(id);
  }

  /**
   * Get models by format
   */
  getModelsByFormat(format) {
    return this.getModels().filter(m => m.format === format);
  }

  /**
   * Get models compatible with a backend
   */
  getModelsForBackend(backendId) {
    return this.getModels().filter(m => {
      if (backendId.includes('ollama') || backendId.includes('llamacpp')) {
        return m.format === 'gguf';
      }
      if (backendId.includes('openvino')) {
        return ['onnx', 'openvino'].includes(m.format);
      }
      return true;
    });
  }

  /**
   * Recommend best backend for a model
   */
  recommendBackend(model, availableBackends) {
    const format = model.format;
    const size = model.parameters || 0;

    // Priority based on format and size
    const recommendations = [];

    if (format === 'gguf') {
      if (size <= 7) {
        recommendations.push('ollama-cuda', 'llamacpp-vulkan', 'ollama-cpu');
      } else if (size <= 13) {
        recommendations.push('ollama-cuda', 'ollama-cpu');
      } else {
        recommendations.push('ollama-cuda', 'ollama-cpu');
      }
    } else if (format === 'onnx' || format === 'openvino') {
      if (size <= 7) {
        recommendations.push('openvino-npu', 'openvino-gpu');
      } else {
        recommendations.push('openvino-gpu');
      }
    }

    // Filter by available backends
    const available = recommendations.filter(r => 
      availableBackends.some(b => b.id === r && b.available)
    );

    return available.length > 0 ? available[0] : null;
  }

  /**
   * Get model statistics
   */
  getStatistics() {
    const models = this.getModels();
    
    const byFormat = {};
    let totalSize = 0;

    for (const model of models) {
      byFormat[model.format] = (byFormat[model.format] || 0) + 1;
      totalSize += model.size || 0;
    }

    return {
      total: models.length,
      byFormat,
      totalSize,
      totalSizeFormatted: this.formatFileSize(totalSize),
      lastScan: this.lastScan
    };
  }

  /**
   * Delete a model file
   */
  async deleteModel(id) {
    const model = this.models.get(id);
    if (!model) {
      return { success: false, error: 'Model not found' };
    }

    try {
      await fsPromises.unlink(model.path);
      
      // Delete associated files for OpenVINO
      if (model.weightsPath) {
        await fsPromises.unlink(model.weightsPath);
      }

      this.models.delete(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Import a model from a path with various options
   * @param {string} sourcePath - Source file path
   * @param {object} options - Import options
   * @param {string} options.method - 'copy' | 'move' | 'symlink' | 'reference'
   * @param {string} options.destDir - Optional custom destination directory
   * @param {string} options.newName - Optional new filename
   */
  async importModel(sourcePath, options = {}) {
    const method = options.method || 'copy';
    const destDir = options.destDir || this.modelsDirectory;
    
    if (!destDir) {
      return { success: false, error: 'Models directory not configured' };
    }

    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: 'Source file not found' };
    }

    const originalFilename = path.basename(sourcePath);
    const filename = options.newName || originalFilename;
    const destPath = path.join(destDir, filename);

    // Ensure destination directory exists
    if (!fs.existsSync(destDir)) {
      await fsPromises.mkdir(destDir, { recursive: true });
    }

    // If a different file already exists at destination, overwrite it.
    // This avoids confusing \"already exists\" behavior when the folder looks empty.
    if (fs.existsSync(destPath) && sourcePath !== destPath && method !== 'reference') {
      try {
        await fsPromises.unlink(destPath);
      } catch (e) {
        // If we can't remove it, surface the error so the UI can show it.
        return { success: false, error: `Failed to overwrite existing file: ${e.message}` };
      }
    }

    try {
      const stats = await fsPromises.stat(sourcePath);
      
      switch (method) {
        case 'copy':
          // Copy file (keeps original)
          await this._copyWithProgress(sourcePath, destPath, stats.size);
          break;
          
        case 'move':
          // Move file (removes original)
          await fsPromises.rename(sourcePath, destPath);
          break;
          
        case 'symlink':
          // Create symbolic link (requires admin on Windows)
          try {
            await fsPromises.symlink(sourcePath, destPath);
          } catch (symlinkError) {
            // Fallback to junction on Windows if symlink fails
            if (process.platform === 'win32') {
              return { 
                success: false, 
                error: 'Symlinks require admin privileges on Windows. Use "reference" method instead.',
                suggestion: 'reference'
              };
            }
            throw symlinkError;
          }
          break;
          
        case 'reference':
          // Just track the file location without copying
          // Store reference in a manifest file
          await this._addReference(sourcePath);
          return { 
            success: true, 
            path: sourcePath, 
            method: 'reference',
            message: 'Model referenced without copying'
          };
          
        default:
          return { success: false, error: `Unknown import method: ${method}` };
      }

      // Rescan to pick up new model
      await this.scanDirectory();

      return { 
        success: true, 
        path: destPath,
        method,
        originalPath: sourcePath,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Copy file with progress tracking
   */
  async _copyWithProgress(source, dest, totalSize) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(source);
      const writeStream = fs.createWriteStream(dest);
      
      let copied = 0;
      
      readStream.on('data', (chunk) => {
        copied += chunk.length;
        const progress = Math.round((copied / totalSize) * 100);
        // Could emit progress events here for UI updates
      });
      
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      
      readStream.pipe(writeStream);
    });
  }

  /**
   * Add a reference to an external model location
   */
  async _addReference(modelPath) {
    const referencesFile = path.join(this.modelsDirectory || os.homedir(), '.devforge-model-refs.json');
    
    let references = [];
    if (fs.existsSync(referencesFile)) {
      try {
        references = JSON.parse(await fsPromises.readFile(referencesFile, 'utf-8'));
      } catch (e) {
        references = [];
      }
    }
    
    if (!references.includes(modelPath)) {
      references.push(modelPath);
      await fsPromises.writeFile(referencesFile, JSON.stringify(references, null, 2));
    }
  }

  /**
   * Get referenced models from external locations
   */
  async getReferencedModels() {
    const referencesFile = path.join(this.modelsDirectory || os.homedir(), '.devforge-model-refs.json');
    
    if (!fs.existsSync(referencesFile)) {
      return [];
    }
    
    try {
      const references = JSON.parse(await fsPromises.readFile(referencesFile, 'utf-8'));
      const models = [];
      
      for (const refPath of references) {
        if (fs.existsSync(refPath)) {
          const format = this.detectFormat(refPath);
          if (format) {
            const modelInfo = await this._getModelInfo(refPath, format);
            if (modelInfo) {
              modelInfo.isReference = true;
              models.push(modelInfo);
            }
          }
        }
      }
      
      return models;
    } catch (error) {
      console.error('Error loading referenced models:', error);
      return [];
    }
  }

  /**
   * Scan system for AI models in common locations
   */
  async scanSystem(options = {}) {
    const platform = process.platform;
    const locations = COMMON_MODEL_LOCATIONS[platform] || [];
    const customLocations = options.additionalPaths || [];
    const allLocations = [...locations, ...customLocations];
    
    const results = {
      locations: [],
      models: [],
      totalSize: 0,
      errors: []
    };

    for (const location of allLocations) {
      if (!fs.existsSync(location)) {
        continue;
      }

      try {
        const locationResult = {
          path: location,
          models: [],
          accessible: true
        };

        // Scan this location
        const foundModels = [];
        await this._scanRecursive(location, foundModels, 0, 4); // Deeper scan for system
        
        locationResult.models = foundModels;
        locationResult.count = foundModels.length;
        locationResult.size = foundModels.reduce((sum, m) => sum + (m.size || 0), 0);
        locationResult.sizeFormatted = this.formatFileSize(locationResult.size);
        
        if (foundModels.length > 0) {
          results.locations.push(locationResult);
          results.models.push(...foundModels);
          results.totalSize += locationResult.size;
        }
      } catch (error) {
        results.errors.push({ path: location, error: error.message });
      }
    }

    results.totalSizeFormatted = this.formatFileSize(results.totalSize);
    results.totalCount = results.models.length;
    
    return results;
  }

  /**
   * Get common model locations for the current platform
   */
  getCommonLocations() {
    const platform = process.platform;
    const locations = COMMON_MODEL_LOCATIONS[platform] || [];
    
    return locations.map(loc => ({
      path: loc,
      exists: fs.existsSync(loc),
      name: this._getLocationName(loc)
    }));
  }

  /**
   * Get friendly name for a location
   */
  _getLocationName(locationPath) {
    const lower = locationPath.toLowerCase();
    
    if (lower.includes('ollama')) return 'Ollama Models';
    if (lower.includes('lm-studio') || lower.includes('lm studio')) return 'LM Studio Models';
    if (lower.includes('gpt4all')) return 'GPT4All Models';
    if (lower.includes('huggingface')) return 'HuggingFace Cache';
    if (lower.includes('downloads')) return 'Downloads Folder';
    if (lower.includes('documents')) return 'Documents';
    
    return path.basename(locationPath);
  }

  /**
   * Bulk import models
   */
  async bulkImport(modelPaths, options = {}) {
    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const modelPath of modelPaths) {
      // Check if already in models directory (no need to copy/move)
      if (this.modelsDirectory && modelPath.startsWith(this.modelsDirectory)) {
        results.skipped.push({ path: modelPath, reason: 'Already in models directory' });
        continue;
      }

      const result = await this.importModel(modelPath, options);

      if (result.success) {
        results.success.push({ path: modelPath, result });
      } else {
        results.failed.push({ path: modelPath, error: result.error });
      }
    }

    return results;
  }

  /**
   * Get disk space info for models directory
   */
  async getDiskSpace() {
    if (!this.modelsDirectory) {
      return null;
    }

    try {
      // Get drive letter on Windows, mount point on Unix
      const drive = process.platform === 'win32' 
        ? this.modelsDirectory.split(':')[0] + ':'
        : '/';
      
      // Use PowerShell on Windows (wmic is deprecated), df on Unix
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          const psCommand = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_LogicalDisk -Filter \\"DeviceID='${drive}'\\" | Select-Object FreeSpace,Size | ConvertTo-Csv -NoTypeInformation"`;
          exec(psCommand, (error, stdout) => {
            if (error) {
              resolve(null);
              return;
            }
            
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            if (lines.length < 2) {
              resolve(null);
              return;
            }
            
            // PowerShell CSV format: "FreeSpace","Size"
            const values = lines[1].replace(/"/g, '').split(',');
            const freeSpace = parseInt(values[0]) || 0;
            const totalSize = parseInt(values[1]) || 0;
            
            resolve({
              free: freeSpace,
              total: totalSize,
              used: totalSize - freeSpace,
              freeFormatted: this.formatFileSize(freeSpace),
              totalFormatted: this.formatFileSize(totalSize),
              usedFormatted: this.formatFileSize(totalSize - freeSpace),
              percentUsed: Math.round(((totalSize - freeSpace) / totalSize) * 100)
            });
          });
        });
      }
      
      return null;
    } catch (error) {
      console.error('Error getting disk space:', error);
      return null;
    }
  }
}

// Singleton instance
let modelManagerInstance = null;

function getModelManager(config) {
  if (!modelManagerInstance) {
    modelManagerInstance = new ModelManager(config);
  }
  return modelManagerInstance;
}

module.exports = {
  ModelManager,
  getModelManager,
  MODEL_FORMATS
};


