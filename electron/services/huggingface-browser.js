/**
 * HuggingFace Model Browser Service
 * 
 * Provides comprehensive browsing, searching, filtering, and downloading
 * of GGUF models from HuggingFace with intelligent recommendations.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class HuggingFaceBrowser extends EventEmitter {
  constructor() {
    super();
    this.baseUrl = 'https://huggingface.co';
    this.apiUrl = 'https://huggingface.co/api';
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes
    this.downloads = new Map(); // Active downloads
    this.downloadQueue = [];
    this.maxConcurrentDownloads = 2;
    
    // Popular/curated model collections for quick access
    this.curatedCollections = {
      'recommended': {
        name: 'Recommended for DevForge',
        description: 'Hand-picked models optimized for local inference',
        models: [
          'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          'TheBloke/Llama-2-13B-chat-GGUF',
          'TheBloke/CodeLlama-13B-Instruct-GGUF',
          'TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF',
          'TheBloke/neural-chat-7B-v3-1-GGUF',
          'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF',
          'TheBloke/dolphin-2.6-mistral-7B-GGUF',
          'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
          'bartowski/gemma-2-9b-it-GGUF',
          'bartowski/Qwen2.5-7B-Instruct-GGUF',
        ]
      },
      'code': {
        name: 'Code Generation',
        description: 'Models specialized for programming tasks',
        models: [
          'TheBloke/CodeLlama-34B-Instruct-GGUF',
          'TheBloke/CodeLlama-13B-Instruct-GGUF',
          'TheBloke/CodeLlama-7B-Instruct-GGUF',
          'TheBloke/WizardCoder-Python-34B-V1.0-GGUF',
          'TheBloke/Phind-CodeLlama-34B-v2-GGUF',
          'TheBloke/deepseek-coder-6.7B-instruct-GGUF',
          'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
          'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF',
        ]
      },
      'chat': {
        name: 'Conversational',
        description: 'Best models for natural dialogue',
        models: [
          'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          'TheBloke/neural-chat-7B-v3-1-GGUF',
          'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF',
          'TheBloke/zephyr-7B-beta-GGUF',
          'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-GGUF',
          'bartowski/Llama-3.2-3B-Instruct-GGUF',
          'bartowski/gemma-2-9b-it-GGUF',
        ]
      },
      'creative': {
        name: 'Creative Writing',
        description: 'Models tuned for storytelling and creative content',
        models: [
          'TheBloke/MythoMax-L2-13B-GGUF',
          'TheBloke/Nous-Hermes-Llama2-13B-GGUF',
          'TheBloke/airoboros-l2-13B-2.2.1-GGUF',
          'TheBloke/Mythalion-13B-GGUF',
          'TheBloke/Chronos-13B-v2-GGUF',
        ]
      },
      'small': {
        name: 'Lightweight (<4GB)',
        description: 'Fast models that run on modest hardware',
        models: [
          'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
          'TheBloke/phi-2-GGUF',
          'TheBloke/stablelm-zephyr-3b-GGUF',
          'TheBloke/Orca-2-7B-GGUF',
          'bartowski/Llama-3.2-1B-Instruct-GGUF',
          'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
        ]
      },
      'uncensored': {
        name: 'Uncensored/Abliterated',
        description: 'Models with fewer content restrictions',
        models: [
          'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
          'TheBloke/WizardLM-13B-V1.2-GGUF',
          'TheBloke/Luna-AI-Llama2-Uncensored-GGUF',
          'TheBloke/guanaco-13B-GGUF',
        ]
      }
    };

    // Quantization explanations for user education
    this.quantizationGuide = {
      'Q2_K': { quality: 1, size: 1, speed: 5, description: 'Smallest, significant quality loss' },
      'Q3_K_S': { quality: 2, size: 2, speed: 5, description: 'Very small, noticeable quality loss' },
      'Q3_K_M': { quality: 2.5, size: 2.5, speed: 4.5, description: 'Small, some quality loss' },
      'Q3_K_L': { quality: 3, size: 3, speed: 4, description: 'Small-medium, minor quality loss' },
      'Q4_0': { quality: 3, size: 3, speed: 4.5, description: 'Legacy 4-bit, decent quality' },
      'Q4_K_S': { quality: 3.5, size: 3.5, speed: 4, description: 'Good balance of size and quality' },
      'Q4_K_M': { quality: 4, size: 4, speed: 3.5, description: 'Recommended - great balance' },
      'Q5_0': { quality: 4, size: 4.5, speed: 3.5, description: 'Legacy 5-bit, good quality' },
      'Q5_K_S': { quality: 4.5, size: 4.5, speed: 3, description: 'High quality, moderate size' },
      'Q5_K_M': { quality: 4.5, size: 5, speed: 3, description: 'High quality, recommended for quality-focused' },
      'Q6_K': { quality: 5, size: 5.5, speed: 2.5, description: 'Very high quality, larger size' },
      'Q8_0': { quality: 5, size: 6, speed: 2, description: 'Near-original quality, large' },
      'F16': { quality: 5, size: 7, speed: 1, description: 'Full precision, very large' },
      'F32': { quality: 5, size: 8, speed: 0.5, description: 'Full precision, huge' },
    };

    // VRAM requirements estimation (rough)
    this.vramEstimates = {
      '1B': { Q4_K_M: 1, Q5_K_M: 1.5, Q8_0: 2 },
      '3B': { Q4_K_M: 2.5, Q5_K_M: 3, Q8_0: 4 },
      '7B': { Q4_K_M: 4, Q5_K_M: 5, Q8_0: 8 },
      '13B': { Q4_K_M: 8, Q5_K_M: 10, Q8_0: 14 },
      '34B': { Q4_K_M: 20, Q5_K_M: 24, Q8_0: 36 },
      '70B': { Q4_K_M: 40, Q5_K_M: 48, Q8_0: 75 },
    };
  }

  /**
   * Search for models on HuggingFace (single page metadata).
   */
  async searchModels(query, options = {}) {
    const page = await this.searchModelsPage(query, options);
    return page.models;
  }

  /**
   * Search models on HuggingFace with pagination metadata.
   */
  async searchModelsPage(query, options = {}) {
    const {
      limit = 50,
      sort = 'downloads',
      direction = -1,
      filter = 'gguf',
      author = null,
      cursor = null,
      full = true,
      refresh = false,
    } = options;

    const normalizedQuery = String(query || '').trim();
    const normalizedFilter = filter && filter !== 'all' ? String(filter) : null;
    const requestKey = JSON.stringify({
      query: normalizedQuery,
      limit,
      sort,
      direction,
      filter: normalizedFilter || 'all',
      author: author || null,
      cursor: cursor || null,
      full: Boolean(full),
    });
    const cacheKey = `search-page:${requestKey}`;
    if (!refresh) {
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('sort', String(sort));
      params.set('direction', String(direction));
      if (normalizedQuery) params.set('search', normalizedQuery);
      if (normalizedFilter) params.set('filter', normalizedFilter);
      if (author) params.set('author', String(author));
      if (cursor) params.set('cursor', String(cursor));
      if (full) params.set('full', 'true');

      const url = `${this.apiUrl}/models?${params.toString()}`;
      const response = await this.fetchJSONResponse(url);
      const models = Array.isArray(response.data) ? response.data : [];
      const nextCursor = this.extractNextCursor(response.headers?.link || response.headers?.Link);
      
      // Enrich results with additional info
      const enrichedResults = models.map(model => this.enrichModelInfo(model));
      const result = {
        models: enrichedResults,
        nextCursor,
        hasMore: Boolean(nextCursor),
        fetchedAt: new Date().toISOString(),
      };
      
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('HuggingFace search error:', error);
      throw error;
    }
  }

  /**
   * Get detailed model information
   */
  async getModelDetails(modelId) {
    const cacheKey = `model:${modelId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const [modelInfo, files] = await Promise.all([
        this.fetchJSON(`${this.apiUrl}/models/${modelId}`),
        this.fetchJSON(`${this.apiUrl}/models/${modelId}/tree/main`).catch(() => [])
      ]);

      // Get README/model card
      let readme = '';
      try {
        readme = await this.fetchText(`${this.baseUrl}/${modelId}/raw/main/README.md`);
      } catch (e) {
        // README not found
      }

      // Parse GGUF files
      const ggufFiles = files
        .filter(f => f.path && f.path.endsWith('.gguf'))
        .map(f => this.parseGGUFFile(f, modelId));
      const allFiles = files
        .filter(f => f.path)
        .map(f => this.parseRepositoryFile(f, modelId));
      const fileStats = this.computeFileStats(allFiles);

      const details = {
        ...modelInfo,
        id: modelId,
        readme,
        files: allFiles,
        fileStats,
        ggufFiles,
        enriched: this.enrichModelInfo(modelInfo),
        requirements: this.estimateRequirements(modelInfo, ggufFiles),
      };

      this.setCache(cacheKey, details);
      return details;
    } catch (error) {
      console.error('Failed to get model details:', error);
      throw error;
    }
  }

  /**
   * Get files list for a model
   */
  async getModelFiles(modelId, options = {}) {
    const includeAll = options && options.includeAll === true;
    const cacheKey = `files:${modelId}:${includeAll ? 'all' : 'gguf'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const files = await this.fetchJSON(`${this.apiUrl}/models/${modelId}/tree/main`);
      const allFiles = files
        .filter(f => f.path)
        .map(f => this.parseRepositoryFile(f, modelId));
      const ggufFiles = files
        .filter(f => f.path && f.path.endsWith('.gguf'))
        .map(f => this.parseGGUFFile(f, modelId));

      if (includeAll) {
        const result = {
          allFiles,
          ggufFiles,
          fileStats: this.computeFileStats(allFiles),
        };
        this.setCache(cacheKey, result);
        return result;
      }

      this.setCache(cacheKey, ggufFiles);
      return ggufFiles;
    } catch (error) {
      console.error('Failed to get model files:', error);
      throw error;
    }
  }

  /**
   * Parse generic repository file metadata.
   */
  parseRepositoryFile(file, modelId) {
    const filename = file.path || file.rfilename || '';
    const sizeBytes = Number(file.size) || 0;
    const extension = path.extname(filename || '').toLowerCase();
    return {
      filename,
      path: filename,
      extension: extension || '',
      sizeBytes,
      sizeFormatted: this.formatSize(sizeBytes),
      downloadUrl: `${this.baseUrl}/${modelId}/resolve/main/${filename}`,
      modelId,
    };
  }

  /**
   * Compute per-extension file statistics for a model repository.
   */
  computeFileStats(files = []) {
    const stats = {
      totalFiles: 0,
      ggufFiles: 0,
      safetensorsFiles: 0,
      onnxFiles: 0,
      binFiles: 0,
      ptFiles: 0,
      otherFiles: 0,
    };

    for (const file of files) {
      const extension = String(file?.extension || path.extname(file?.filename || '') || '').toLowerCase();
      stats.totalFiles += 1;
      if (extension === '.gguf') stats.ggufFiles += 1;
      else if (extension === '.safetensors') stats.safetensorsFiles += 1;
      else if (extension === '.onnx') stats.onnxFiles += 1;
      else if (extension === '.bin') stats.binFiles += 1;
      else if (extension === '.pt' || extension === '.pth') stats.ptFiles += 1;
      else stats.otherFiles += 1;
    }

    return stats;
  }

  /**
   * Parse GGUF file info
   */
  parseGGUFFile(file, modelId) {
    const filename = file.path;
    const sizeBytes = file.size || 0;
    const sizeGB = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2);

    // Extract quantization from filename
    const quantMatch = filename.match(/(Q[2-8]_[KSM0-9_]+|F16|F32|IQ[0-9]_[A-Z]+)/i);
    const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';

    // Extract parameter count hints
    const paramMatch = filename.match(/(\d+)[Bb]/);
    const params = paramMatch ? paramMatch[1] + 'B' : null;

    const quantInfo = this.quantizationGuide[quantization] || {
      quality: 3,
      size: 3,
      speed: 3,
      description: 'Unknown quantization'
    };

    return {
      filename,
      path: file.path,
      sizeBytes,
      sizeGB: parseFloat(sizeGB),
      sizeFormatted: this.formatSize(sizeBytes),
      quantization,
      quantInfo,
      params,
      downloadUrl: `${this.baseUrl}/${modelId}/resolve/main/${filename}`,
      modelId,
    };
  }

  /**
   * Enrich model info with computed fields
   */
  enrichModelInfo(model) {
    const modelId = model.modelId || model.id;
    const name = String(modelId || '').split('/').pop() || '';
    const siblings = Array.isArray(model.siblings)
      ? model.siblings
          .filter((file) => file?.rfilename)
          .map((file) => ({ filename: file.rfilename, extension: path.extname(file.rfilename || '').toLowerCase() }))
      : [];
    const fileStats = this.computeFileStats(siblings);
    const hasGgufFromFiles = fileStats.ggufFiles > 0;
    const hasGgufFromTags = Array.isArray(model.tags) && model.tags.includes('gguf');
    const hasGgufFromName = name.toLowerCase().includes('gguf');

    // Detect model family
    const family = this.detectModelFamily(name);
    
    // Detect parameter count
    const params = this.detectParams(name);
    
    // Detect primary capability
    const capability = this.detectCapability(name, model.tags || []);

    return {
      ...model,
      displayName: name,
      author: modelId.split('/')[0],
      family,
      params,
      capability,
      fileStats,
      variationCount: fileStats.totalFiles,
      ggufVariantCount: fileStats.ggufFiles,
      isGGUF: hasGgufFromFiles || hasGgufFromTags || hasGgufFromName,
      downloadCount: model.downloads || 0,
      likes: model.likes || 0,
      lastModified: model.lastModified,
    };
  }

  /**
   * Detect model family from name
   */
  detectModelFamily(name) {
    const lower = name.toLowerCase();
    
    if (lower.includes('llama-3') || lower.includes('llama3')) return 'Llama 3';
    if (lower.includes('llama-2') || lower.includes('llama2')) return 'Llama 2';
    if (lower.includes('llama')) return 'Llama';
    if (lower.includes('mistral')) return 'Mistral';
    if (lower.includes('mixtral')) return 'Mixtral';
    if (lower.includes('qwen')) return 'Qwen';
    if (lower.includes('gemma')) return 'Gemma';
    if (lower.includes('phi')) return 'Phi';
    if (lower.includes('codellama') || lower.includes('code-llama')) return 'CodeLlama';
    if (lower.includes('deepseek')) return 'DeepSeek';
    if (lower.includes('vicuna')) return 'Vicuna';
    if (lower.includes('wizard')) return 'WizardLM';
    if (lower.includes('orca')) return 'Orca';
    if (lower.includes('zephyr')) return 'Zephyr';
    if (lower.includes('neural')) return 'Neural Chat';
    if (lower.includes('openchat')) return 'OpenChat';
    if (lower.includes('dolphin')) return 'Dolphin';
    if (lower.includes('hermes')) return 'Hermes';
    if (lower.includes('tinyllama')) return 'TinyLlama';
    if (lower.includes('stablelm')) return 'StableLM';
    
    return 'Other';
  }

  /**
   * Detect parameter count from name
   */
  detectParams(name) {
    const match = name.match(/(\d+\.?\d*)[Bb]/i);
    if (match) {
      const num = parseFloat(match[1]);
      if (num >= 1000) return `${(num / 1000).toFixed(1)}T`;
      return `${num}B`;
    }
    
    // Check for written numbers
    if (name.toLowerCase().includes('70b')) return '70B';
    if (name.toLowerCase().includes('34b')) return '34B';
    if (name.toLowerCase().includes('13b')) return '13B';
    if (name.toLowerCase().includes('7b')) return '7B';
    if (name.toLowerCase().includes('3b')) return '3B';
    if (name.toLowerCase().includes('1b')) return '1B';
    
    return null;
  }

  /**
   * Detect primary capability
   */
  detectCapability(name, tags) {
    const lower = name.toLowerCase();
    const tagStr = tags.join(' ').toLowerCase();
    
    if (lower.includes('code') || tagStr.includes('code')) return 'code';
    if (lower.includes('instruct')) return 'instruction';
    if (lower.includes('chat')) return 'chat';
    if (lower.includes('uncensored') || lower.includes('abliterat')) return 'uncensored';
    if (lower.includes('creative') || lower.includes('story') || lower.includes('mytho')) return 'creative';
    if (lower.includes('math') || lower.includes('reason')) return 'reasoning';
    
    return 'general';
  }

  /**
   * Estimate hardware requirements
   */
  estimateRequirements(model, ggufFiles) {
    const requirements = {
      minimum: {},
      recommended: {},
      files: []
    };

    for (const file of ggufFiles) {
      const sizeGB = file.sizeGB;
      
      // Estimate VRAM (model + overhead)
      const vramMin = Math.ceil(sizeGB * 1.1);
      const vramRec = Math.ceil(sizeGB * 1.3);
      
      // Estimate RAM for CPU inference
      const ramMin = Math.ceil(sizeGB * 1.2);
      const ramRec = Math.ceil(sizeGB * 1.5);

      requirements.files.push({
        filename: file.filename,
        quantization: file.quantization,
        sizeGB,
        vramMin,
        vramRec,
        ramMin,
        ramRec,
        recommended: file.quantization.includes('Q4_K_M') || file.quantization.includes('Q5_K_M'),
      });
    }

    // Overall requirements based on smallest Q4_K_M or best available
    const recommended = requirements.files.find(f => f.recommended) || requirements.files[0];
    if (recommended) {
      requirements.minimum = {
        vram: recommended.vramMin,
        ram: recommended.ramMin,
        storage: Math.ceil(recommended.sizeGB),
      };
      requirements.recommended = {
        vram: recommended.vramRec,
        ram: recommended.ramRec,
        storage: Math.ceil(recommended.sizeGB * 1.5),
      };
    }

    return requirements;
  }

  /**
   * Get curated collections
   */
  getCollections() {
    return this.curatedCollections;
  }

  /**
   * Get collection details with model info
   */
  async getCollectionModels(collectionId) {
    const collection = this.curatedCollections[collectionId];
    if (!collection) throw new Error(`Collection ${collectionId} not found`);

    const models = await Promise.all(
      collection.models.map(async (modelId) => {
        try {
          const details = await this.getModelDetails(modelId);
          return details;
        } catch (error) {
          console.warn(`Failed to fetch ${modelId}:`, error.message);
          return null;
        }
      })
    );

    return {
      ...collection,
      models: models.filter(Boolean),
    };
  }

  /**
   * Get quantization guide
   */
  getQuantizationGuide() {
    return this.quantizationGuide;
  }

  /**
   * Download a model file
   */
  async downloadModel(fileInfo, destDir, progressCallback) {
    const { downloadUrl, filename, sizeBytes, modelId } = fileInfo;
    const destPath = path.join(destDir, filename);
    
    // Create download entry
    const downloadId = `${modelId}:${filename}`;
    const download = {
      id: downloadId,
      modelId,
      filename,
      url: downloadUrl,
      destPath,
      totalBytes: sizeBytes,
      downloadedBytes: 0,
      progress: 0,
      speed: 0,
      status: 'pending',
      startTime: null,
      error: null,
    };

    this.downloads.set(downloadId, download);
    this.emit('download:started', download);

    return new Promise((resolve, reject) => {
      const startDownload = () => {
        download.status = 'downloading';
        download.startTime = Date.now();
        
        // Ensure directory exists
        fs.mkdirSync(destDir, { recursive: true });

        const file = fs.createWriteStream(destPath);
        let lastBytes = 0;
        let lastTime = Date.now();

        const request = (downloadUrl.startsWith('https') ? https : http).get(downloadUrl, {
          headers: {
            'User-Agent': 'DevForge/1.0',
          },
        }, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Handle redirect
            file.close();
            fs.unlinkSync(destPath);
            fileInfo.downloadUrl = response.headers.location;
            this.downloadModel(fileInfo, destDir, progressCallback)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(destPath);
            const error = new Error(`HTTP ${response.statusCode}`);
            download.status = 'error';
            download.error = error.message;
            this.emit('download:error', download);
            reject(error);
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'], 10) || sizeBytes;
          download.totalBytes = totalBytes;

          response.pipe(file);

          response.on('data', (chunk) => {
            download.downloadedBytes += chunk.length;
            download.progress = Math.round((download.downloadedBytes / totalBytes) * 100);
            
            // Calculate speed every second
            const now = Date.now();
            if (now - lastTime >= 1000) {
              const bytesPerSec = (download.downloadedBytes - lastBytes) / ((now - lastTime) / 1000);
              download.speed = bytesPerSec;
              lastBytes = download.downloadedBytes;
              lastTime = now;
            }

            this.emit('download:progress', download);
            if (progressCallback) progressCallback(download);
          });

          file.on('finish', () => {
            file.close();
            download.status = 'completed';
            download.progress = 100;
            this.emit('download:completed', download);
            resolve(download);
          });
        });

        request.on('error', (error) => {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          download.status = 'error';
          download.error = error.message;
          this.emit('download:error', download);
          reject(error);
        });

        download.abort = () => {
          request.destroy();
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          download.status = 'cancelled';
          this.emit('download:cancelled', download);
        };
      };

      startDownload();
    });
  }

  /**
   * Cancel a download
   */
  cancelDownload(downloadId) {
    const download = this.downloads.get(downloadId);
    if (download && download.abort) {
      download.abort();
      return true;
    }
    return false;
  }

  /**
   * Get active downloads
   */
  getDownloads() {
    return Array.from(this.downloads.values());
  }

  /**
   * Compare multiple models
   */
  async compareModels(modelIds) {
    const models = await Promise.all(
      modelIds.map(id => this.getModelDetails(id))
    );

    return {
      models,
      comparison: this.generateComparison(models),
    };
  }

  /**
   * Generate comparison data
   */
  generateComparison(models) {
    const comparison = {
      sizes: [],
      capabilities: [],
      requirements: [],
    };

    for (const model of models) {
      const files = model.ggufFiles || [];
      const q4File = files.find(f => f.quantization.includes('Q4_K_M')) || files[0];

      comparison.sizes.push({
        modelId: model.id,
        displayName: model.enriched?.displayName,
        params: model.enriched?.params,
        fileSize: q4File?.sizeGB || 0,
      });

      comparison.capabilities.push({
        modelId: model.id,
        displayName: model.enriched?.displayName,
        family: model.enriched?.family,
        capability: model.enriched?.capability,
        downloads: model.downloads,
        likes: model.likes,
      });

      if (model.requirements) {
        comparison.requirements.push({
          modelId: model.id,
          displayName: model.enriched?.displayName,
          ...model.requirements.recommended,
        });
      }
    }

    return comparison;
  }

  /**
   * Get trending/popular models
   */
  async getTrendingModels(limit = 20) {
    const page = await this.searchModelsPage('', { 
      limit, 
      sort: 'downloads',
      direction: -1,
      filter: 'gguf',
      full: true,
    });
    return page.models;
  }

  /**
   * Get recently updated models
   */
  async getRecentModels(limit = 20) {
    const page = await this.searchModelsPage('', { 
      limit, 
      sort: 'lastModified',
      direction: -1,
      filter: 'gguf',
      full: true,
    });
    return page.models;
  }

  /**
   * Recommend models based on user's hardware
   */
  async recommendForHardware(vramGB, ramGB) {
    const recommendations = [];
    
    // Determine max model size
    let maxSizeGB;
    if (vramGB >= 24) maxSizeGB = 40;
    else if (vramGB >= 16) maxSizeGB = 20;
    else if (vramGB >= 12) maxSizeGB = 14;
    else if (vramGB >= 8) maxSizeGB = 8;
    else if (vramGB >= 6) maxSizeGB = 5;
    else maxSizeGB = 3;

    // Get recommended collection and filter by size
    const collection = await this.getCollectionModels('recommended');
    
    for (const model of collection.models) {
      const files = model.ggufFiles || [];
      const suitable = files.filter(f => f.sizeGB <= maxSizeGB);
      
      if (suitable.length > 0) {
        recommendations.push({
          ...model,
          suitableFiles: suitable,
          recommendedFile: suitable.find(f => f.quantization.includes('Q4_K_M')) || suitable[0],
        });
      }
    }

    return {
      vramGB,
      ramGB,
      maxRecommendedSize: maxSizeGB,
      models: recommendations,
    };
  }

  // Helper methods

  formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  extractNextCursor(linkHeader) {
    if (!linkHeader || typeof linkHeader !== 'string') return null;
    const nextMatch = linkHeader.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (!nextMatch || !nextMatch[1]) return null;
    try {
      const nextUrl = new URL(nextMatch[1]);
      return nextUrl.searchParams.get('cursor');
    } catch {
      const fallback = nextMatch[1].match(/[?&]cursor=([^&]+)/);
      return fallback ? decodeURIComponent(fallback[1]) : null;
    }
  }

  async fetchJSONResponse(url) {
    return new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DevForge/1.0',
        },
      }, (response) => {
        let data = '';
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve({
              data: JSON.parse(data),
              headers: response.headers || {},
              statusCode: response.statusCode,
            });
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });
      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async fetchJSON(url) {
    const response = await this.fetchJSONResponse(url);
    return response.data;
  }

  async fetchText(url) {
    return new Promise((resolve, reject) => {
      const request = (url.startsWith('https') ? https : http).get(url, {
        headers: {
          'User-Agent': 'DevForge/1.0',
        },
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  getFromCache(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < this.cacheTTL) {
      return item.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
let browserInstance = null;

function getHuggingFaceBrowser() {
  if (!browserInstance) {
    browserInstance = new HuggingFaceBrowser();
  }
  return browserInstance;
}

module.exports = {
  HuggingFaceBrowser,
  getHuggingFaceBrowser,
};












