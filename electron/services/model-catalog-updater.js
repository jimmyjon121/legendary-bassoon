/**
 * Model Catalog Updater Service
 * 
 * Automatically fetches and caches model information from:
 * - Ollama Library API
 * - Local metadata enrichment
 * 
 * Features:
 * - Auto-refresh on schedule (every 6 hours)
 * - Manual refresh on demand
 * - Local caching for offline access
 * - Enriched model profiles with benchmarks and descriptions
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Cache settings
const CACHE_DIR = app ? path.join(app.getPath('userData'), 'model-catalog') : './model-catalog';
const CACHE_FILE = path.join(CACHE_DIR, 'catalog.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const AUTO_REFRESH_INTERVAL = CACHE_TTL;

class ModelCatalogUpdater {
  constructor() {
    this.catalog = null;
    this.lastUpdate = null;
    this.refreshTimer = null;
    this.listeners = new Set();
    
    // Rich model metadata (manually curated for quality)
    this.modelProfiles = this._getEnrichedProfiles();
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    
    // Load cached catalog
    await this.loadFromCache();
    
    // Start auto-refresh
    this.startAutoRefresh();
    
    // Fetch fresh data if cache is stale
    if (this.isCacheStale()) {
      this.refresh().catch(err => {
        console.warn('[CatalogUpdater] Initial refresh failed:', err.message);
      });
    }
    
    console.log('[CatalogUpdater] Initialized with', this.catalog?.length || 0, 'models');
  }
  
  /**
   * Load catalog from local cache
   */
  async loadFromCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        this.catalog = data.models || [];
        this.lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;
        console.log('[CatalogUpdater] Loaded', this.catalog.length, 'models from cache');
      }
    } catch (err) {
      console.warn('[CatalogUpdater] Failed to load cache:', err.message);
      this.catalog = [];
    }
  }
  
  /**
   * Save catalog to local cache
   */
  saveToCache() {
    try {
      const data = {
        models: this.catalog,
        lastUpdate: this.lastUpdate?.toISOString(),
        version: '1.0',
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
      console.log('[CatalogUpdater] Saved', this.catalog.length, 'models to cache');
    } catch (err) {
      console.error('[CatalogUpdater] Failed to save cache:', err.message);
    }
  }
  
  /**
   * Check if cache is stale
   */
  isCacheStale() {
    if (!this.lastUpdate) return true;
    return Date.now() - this.lastUpdate.getTime() > CACHE_TTL;
  }
  
  /**
   * Refresh the catalog from remote sources
   */
  async refresh() {
    console.log('[CatalogUpdater] Refreshing catalog...');
    
    try {
      // Fetch from Ollama Library
      const ollamaModels = await this._fetchOllamaLibrary();
      
      // Enrich with our detailed profiles
      const enrichedModels = this._enrichModels(ollamaModels);
      
      this.catalog = enrichedModels;
      this.lastUpdate = new Date();
      
      // Save to cache
      this.saveToCache();
      
      // Notify listeners
      this._notifyListeners('updated', { count: this.catalog.length });
      
      console.log('[CatalogUpdater] Refreshed with', this.catalog.length, 'models');
      return { success: true, count: this.catalog.length };
      
    } catch (err) {
      console.error('[CatalogUpdater] Refresh failed:', err);
      this._notifyListeners('error', { error: err.message });
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Fetch models from Ollama Library
   */
  async _fetchOllamaLibrary() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'ollama.com',
        path: '/api/tags',
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DevForge/1.0',
        },
        timeout: 15000,
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Ollama API might return different formats
            // Try to parse and extract model list
            const parsed = JSON.parse(data);
            const models = parsed.models || parsed.tags || parsed || [];
            
            // Transform to our format
            const transformed = Array.isArray(models) ? models.map(m => ({
              id: m.name || m.id,
              name: this._formatModelName(m.name || m.id),
              description: m.description || '',
              author: m.author || this._extractAuthor(m.name || m.id),
              tags: m.tags || [],
              size: m.size,
              pulls: m.pulls || m.downloads,
              updated: m.updated_at || m.modified_at,
              source: 'ollama',
            })) : [];
            
            resolve(transformed);
          } catch (parseErr) {
            console.warn('[CatalogUpdater] Failed to parse Ollama response, using fallback');
            resolve(this._getFallbackCatalog());
          }
        });
      });
      
      req.on('error', (err) => {
        console.warn('[CatalogUpdater] Ollama API error:', err.message);
        resolve(this._getFallbackCatalog());
      });
      
      req.on('timeout', () => {
        req.destroy();
        console.warn('[CatalogUpdater] Ollama API timeout');
        resolve(this._getFallbackCatalog());
      });
      
      req.end();
    });
  }
  
  /**
   * Enrich models with detailed profiles
   */
  _enrichModels(models) {
    return models.map(model => {
      const profile = this.modelProfiles[model.id] || this.modelProfiles[model.id?.split(':')[0]];
      if (profile) {
        return { ...model, ...profile, id: model.id };
      }
      return model;
    });
  }
  
  /**
   * Format model name for display
   */
  _formatModelName(id) {
    if (!id) return 'Unknown';
    // Convert "llama3.2" to "Llama 3.2"
    return id
      .replace(/([a-z])(\d)/gi, '$1 $2')
      .replace(/([a-z])-([a-z])/gi, '$1 $2')
      .split(/[:\-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  
  /**
   * Extract author from model ID
   */
  _extractAuthor(id) {
    const authorMap = {
      'llama': 'Meta',
      'mistral': 'Mistral AI',
      'mixtral': 'Mistral AI',
      'qwen': 'Alibaba',
      'gemma': 'Google',
      'phi': 'Microsoft',
      'deepseek': 'DeepSeek',
      'codellama': 'Meta',
      'vicuna': 'LMSYS',
      'openchat': 'OpenChat',
      'neural-chat': 'Intel',
      'dolphin': 'Cognitive Computations',
      'orca': 'Microsoft',
      'stable': 'Stability AI',
    };
    
    const lower = (id || '').toLowerCase();
    for (const [key, author] of Object.entries(authorMap)) {
      if (lower.includes(key)) return author;
    }
    return 'Community';
  }
  
  /**
   * Get enriched model profiles with detailed info
   */
  _getEnrichedProfiles() {
    return {
      'llama3.2': {
        name: 'Llama 3.2',
        description: "Meta's latest and most efficient Llama model, optimized for edge deployment while maintaining strong capabilities.",
        longDescription: "Llama 3.2 represents Meta's push toward efficient, deployable AI. The 1B and 3B variants are specifically designed for on-device inference, making them perfect for local AI applications. Despite their small size, they maintain impressive instruction-following and reasoning capabilities.",
        author: 'Meta',
        family: 'Llama',
        capability: 'chat',
        official: true,
        strengths: [
          'Extremely fast inference',
          'Low memory requirements',
          'Great instruction following',
          'Efficient for edge deployment',
          'Multilingual support',
        ],
        considerations: [
          'Smaller context window than larger models',
          'May struggle with very complex reasoning',
          'Knowledge limited to training cutoff',
        ],
        benchmarks: [
          { name: 'MMLU (Knowledge)', score: 63.4, description: 'General knowledge across subjects' },
          { name: 'HumanEval (Code)', score: 48.2, description: 'Code generation accuracy' },
          { name: 'GSM8K (Math)', score: 57.5, description: 'Grade school math problems' },
          { name: 'HellaSwag', score: 78.9, description: 'Common sense reasoning' },
        ],
        useCases: [
          { icon: 'chat', title: 'Quick Assistant', description: 'Fast responses for everyday questions and tasks', color: 'bg-blue-500/20', iconColor: 'text-blue-400' },
          { icon: 'code', title: 'Code Snippets', description: 'Generate and explain small code segments', color: 'bg-emerald-500/20', iconColor: 'text-emerald-400' },
          { icon: 'creative', title: 'Writing Help', description: 'Draft emails, messages, and short content', color: 'bg-purple-500/20', iconColor: 'text-purple-400' },
        ],
        variants: [
          { tag: '1b', params: '1B', size: 1.3, vram: 2, recommended: false },
          { tag: '3b', params: '3B', size: 2.0, vram: 4, recommended: true },
        ],
        contextLength: 131072,
        architecture: 'Llama 3.2 Transformer',
        dataCutoff: 'December 2023',
        license: 'Llama 3.2 Community License',
        url: 'https://ollama.com/library/llama3.2',
        tags: ['chat', 'fast', 'efficient', 'multilingual', 'popular'],
      },
      
      'llama3.1': {
        name: 'Llama 3.1',
        description: "Meta's flagship model family with sizes from 8B to 405B, offering state-of-the-art performance.",
        longDescription: "Llama 3.1 is Meta's most capable open model family. The 8B variant offers excellent performance for most tasks, while the 70B and 405B models compete with closed-source alternatives. Features extended context length and improved reasoning.",
        author: 'Meta',
        family: 'Llama',
        capability: 'chat',
        official: true,
        strengths: [
          'State-of-the-art reasoning',
          'Extended 128K context window',
          'Excellent code generation',
          'Strong multilingual support',
          'Tool use capabilities',
        ],
        considerations: [
          'Larger variants need significant VRAM',
          '405B requires enterprise hardware',
          'Longer generation times for complex tasks',
        ],
        benchmarks: [
          { name: 'MMLU (Knowledge)', score: 73.8, description: 'General knowledge (8B variant)' },
          { name: 'HumanEval (Code)', score: 72.6, description: 'Code generation accuracy' },
          { name: 'GSM8K (Math)', score: 84.5, description: 'Mathematical reasoning' },
          { name: 'MATH', score: 51.9, description: 'Advanced mathematics' },
        ],
        useCases: [
          { icon: 'reasoning', title: 'Complex Analysis', description: 'Research, analysis, and detailed explanations', color: 'bg-amber-500/20', iconColor: 'text-amber-400' },
          { icon: 'code', title: 'Software Development', description: 'Full-featured code assistance and generation', color: 'bg-emerald-500/20', iconColor: 'text-emerald-400' },
          { icon: 'creative', title: 'Long-form Content', description: 'Articles, stories, and detailed documents', color: 'bg-purple-500/20', iconColor: 'text-purple-400' },
          { icon: 'chat', title: 'Expert Assistant', description: 'In-depth conversations on any topic', color: 'bg-blue-500/20', iconColor: 'text-blue-400' },
        ],
        variants: [
          { tag: '8b', params: '8B', size: 4.7, vram: 8, recommended: true },
          { tag: '70b', params: '70B', size: 40, vram: 48, recommended: false },
          { tag: '405b', params: '405B', size: 230, vram: 300, recommended: false },
        ],
        contextLength: 131072,
        architecture: 'Llama 3.1 Transformer',
        dataCutoff: 'December 2023',
        license: 'Llama 3.1 Community License',
        url: 'https://ollama.com/library/llama3.1',
        tags: ['chat', 'flagship', 'reasoning', 'code', 'multilingual'],
      },
      
      'qwen2.5': {
        name: 'Qwen 2.5',
        description: "Alibaba's latest multilingual model with excellent performance across sizes.",
        longDescription: "Qwen 2.5 offers a complete range from tiny 0.5B to massive 72B. Known for strong multilingual capabilities (especially Chinese), good reasoning, and competitive performance with Western models.",
        author: 'Alibaba',
        family: 'Qwen',
        capability: 'chat',
        official: true,
        strengths: [
          'Excellent multilingual support',
          'Strong Chinese language performance',
          'Wide range of model sizes',
          'Good code understanding',
          'Competitive benchmarks',
        ],
        considerations: [
          'May have cultural biases toward Chinese content',
          'Some English idioms may be less natural',
        ],
        benchmarks: [
          { name: 'MMLU (Knowledge)', score: 74.2, description: 'General knowledge (7B variant)' },
          { name: 'HumanEval (Code)', score: 61.6, description: 'Code generation' },
          { name: 'C-Eval', score: 81.8, description: 'Chinese knowledge benchmark' },
          { name: 'GSM8K (Math)', score: 79.6, description: 'Mathematical reasoning' },
        ],
        useCases: [
          { icon: 'multilingual', title: 'Multilingual Tasks', description: 'Translation and cross-lingual understanding', color: 'bg-cyan-500/20', iconColor: 'text-cyan-400' },
          { icon: 'chat', title: 'General Assistant', description: 'Everyday questions and conversations', color: 'bg-blue-500/20', iconColor: 'text-blue-400' },
          { icon: 'code', title: 'Code Help', description: 'Programming assistance in multiple languages', color: 'bg-emerald-500/20', iconColor: 'text-emerald-400' },
        ],
        variants: [
          { tag: '0.5b', params: '0.5B', size: 0.4, vram: 1 },
          { tag: '1.5b', params: '1.5B', size: 1.0, vram: 2 },
          { tag: '3b', params: '3B', size: 1.9, vram: 3 },
          { tag: '7b', params: '7B', size: 4.4, vram: 6, recommended: true },
          { tag: '14b', params: '14B', size: 8.9, vram: 12 },
          { tag: '32b', params: '32B', size: 19, vram: 24 },
          { tag: '72b', params: '72B', size: 41, vram: 48 },
        ],
        contextLength: 32768,
        architecture: 'Qwen2 Transformer',
        dataCutoff: 'September 2024',
        license: 'Apache 2.0 / Qwen License',
        url: 'https://ollama.com/library/qwen2.5',
        tags: ['chat', 'multilingual', 'chinese', 'code'],
      },
      
      'mistral': {
        name: 'Mistral 7B',
        description: 'Fast and efficient 7B model that punches above its weight class.',
        longDescription: "Mistral 7B was a breakthrough model that showed 7B parameters could compete with much larger models. It's known for fast inference, low resource requirements, and solid all-around performance.",
        author: 'Mistral AI',
        family: 'Mistral',
        capability: 'chat',
        official: true,
        strengths: [
          'Excellent speed/quality ratio',
          'Low VRAM requirements',
          'Strong reasoning for size',
          'Good instruction following',
        ],
        considerations: [
          'Limited context window (8K)',
          'Smaller than newer models',
          'Less capable on complex tasks',
        ],
        benchmarks: [
          { name: 'MMLU', score: 62.5, description: 'General knowledge' },
          { name: 'HellaSwag', score: 81.3, description: 'Common sense' },
          { name: 'TruthfulQA', score: 42.2, description: 'Factual accuracy' },
        ],
        variants: [
          { tag: 'latest', params: '7B', size: 4.1, vram: 6, recommended: true },
        ],
        contextLength: 8192,
        architecture: 'Mistral Transformer + Sliding Window',
        dataCutoff: '2023',
        license: 'Apache 2.0',
        url: 'https://ollama.com/library/mistral',
        tags: ['chat', 'fast', 'efficient'],
      },
      
      'deepseek-coder-v2': {
        name: 'DeepSeek Coder V2',
        description: 'High-performance coding model with MoE architecture for efficient inference.',
        longDescription: "DeepSeek Coder V2 uses a Mixture of Experts architecture to deliver exceptional coding performance while remaining efficient. It excels at code generation, completion, and understanding across many programming languages.",
        author: 'DeepSeek',
        family: 'DeepSeek',
        capability: 'code',
        official: true,
        strengths: [
          'Excellent code generation',
          'MoE for efficient inference',
          'Strong across many languages',
          'Good at code explanation',
          'Competitive with GPT-4 on coding',
        ],
        considerations: [
          'Specialized for code (less general)',
          'May need more context for complex projects',
        ],
        benchmarks: [
          { name: 'HumanEval', score: 90.2, description: 'Python code generation' },
          { name: 'MBPP', score: 80.4, description: 'Basic programming tasks' },
          { name: 'MultiPL-E', score: 75.8, description: 'Multi-language coding' },
        ],
        useCases: [
          { icon: 'code', title: 'Code Generation', description: 'Write functions, classes, and complete programs', color: 'bg-emerald-500/20', iconColor: 'text-emerald-400' },
          { icon: 'reasoning', title: 'Code Review', description: 'Analyze code for bugs and improvements', color: 'bg-amber-500/20', iconColor: 'text-amber-400' },
          { icon: 'chat', title: 'Programming Q&A', description: 'Answer questions about code and concepts', color: 'bg-blue-500/20', iconColor: 'text-blue-400' },
        ],
        variants: [
          { tag: '16b', params: '16B (MoE)', size: 8.9, vram: 12, recommended: true },
          { tag: '236b', params: '236B (MoE)', size: 130, vram: 160 },
        ],
        contextLength: 128000,
        architecture: 'DeepSeek MoE Transformer',
        dataCutoff: '2024',
        license: 'DeepSeek License',
        url: 'https://ollama.com/library/deepseek-coder-v2',
        tags: ['code', 'moe', 'programming'],
      },
      
      'gemma2': {
        name: 'Gemma 2',
        description: "Google's lightweight yet powerful open model for research and development.",
        longDescription: "Gemma 2 is Google's open-weight model designed to be both capable and efficient. It brings some of the technology from Google's larger models into an accessible package for developers and researchers.",
        author: 'Google',
        family: 'Gemma',
        capability: 'chat',
        official: true,
        strengths: [
          'Google research backing',
          'Good efficiency',
          'Strong for its size',
          'Well-documented',
        ],
        considerations: [
          'Relatively new model',
          'Smaller community than Llama',
        ],
        benchmarks: [
          { name: 'MMLU', score: 71.3, description: 'General knowledge (9B)' },
          { name: 'HellaSwag', score: 81.2, description: 'Common sense' },
          { name: 'HumanEval', score: 54.5, description: 'Code generation' },
        ],
        variants: [
          { tag: '2b', params: '2B', size: 1.6, vram: 3 },
          { tag: '9b', params: '9B', size: 5.4, vram: 8, recommended: true },
          { tag: '27b', params: '27B', size: 16, vram: 20 },
        ],
        contextLength: 8192,
        architecture: 'Gemma Transformer',
        dataCutoff: '2024',
        license: 'Gemma License',
        url: 'https://ollama.com/library/gemma2',
        tags: ['chat', 'google', 'research'],
      },
      
      'phi3': {
        name: 'Phi-3',
        description: "Microsoft's small language model with surprisingly strong capabilities.",
        longDescription: "Phi-3 demonstrates that small models trained on high-quality data can achieve impressive results. It's particularly good for reasoning and structured tasks despite its compact size.",
        author: 'Microsoft',
        family: 'Phi',
        capability: 'chat',
        official: true,
        strengths: [
          'Excellent for its size',
          'Strong reasoning',
          'Very efficient',
          'Good at structured output',
        ],
        considerations: [
          'Limited world knowledge',
          'Smaller context window',
          'May struggle with nuance',
        ],
        benchmarks: [
          { name: 'MMLU', score: 69.0, description: 'General knowledge (3.8B)' },
          { name: 'GSM8K', score: 82.5, description: 'Math reasoning' },
          { name: 'HumanEval', score: 58.5, description: 'Code generation' },
        ],
        variants: [
          { tag: 'mini', params: '3.8B', size: 2.3, vram: 4, recommended: true },
          { tag: 'medium', params: '14B', size: 8.0, vram: 12 },
        ],
        contextLength: 4096,
        architecture: 'Phi Transformer',
        dataCutoff: '2024',
        license: 'MIT',
        url: 'https://ollama.com/library/phi3',
        tags: ['chat', 'efficient', 'reasoning', 'microsoft'],
      },
    };
  }
  
  /**
   * Fallback catalog when API is unavailable
   */
  _getFallbackCatalog() {
    return Object.entries(this.modelProfiles).map(([id, profile]) => ({
      id,
      source: 'ollama',
      ...profile,
    }));
  }
  
  /**
   * Get all models in catalog
   */
  getModels(options = {}) {
    let models = this.catalog || this._getFallbackCatalog();
    
    // Filter by capability
    if (options.capability) {
      models = models.filter(m => m.capability === options.capability);
    }
    
    // Filter by search query
    if (options.query) {
      const q = options.query.toLowerCase();
      models = models.filter(m => 
        m.name?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    
    // Sort
    if (options.sort === 'popular') {
      models = [...models].sort((a, b) => (b.pulls || 0) - (a.pulls || 0));
    } else if (options.sort === 'newest') {
      models = [...models].sort((a, b) => 
        new Date(b.updated || 0) - new Date(a.updated || 0)
      );
    }
    
    return models;
  }
  
  /**
   * Get detailed info for a specific model
   */
  getModelDetails(modelId) {
    const baseModel = modelId.split(':')[0];
    const profile = this.modelProfiles[baseModel] || this.modelProfiles[modelId];
    const catalogEntry = this.catalog?.find(m => m.id === modelId || m.id === baseModel);
    
    return {
      ...catalogEntry,
      ...profile,
      id: modelId,
    };
  }
  
  /**
   * Get catalog status
   */
  getStatus() {
    return {
      modelCount: this.catalog?.length || 0,
      lastUpdate: this.lastUpdate?.toISOString(),
      isStale: this.isCacheStale(),
      cacheFile: CACHE_FILE,
    };
  }
  
  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    if (this.refreshTimer) return;
    
    this.refreshTimer = setInterval(() => {
      this.refresh().catch(err => {
        console.warn('[CatalogUpdater] Auto-refresh failed:', err.message);
      });
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('[CatalogUpdater] Auto-refresh started (every 6 hours)');
  }
  
  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  
  /**
   * Add event listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  
  /**
   * Notify all listeners
   */
  _notifyListeners(event, data) {
    this.listeners.forEach(cb => {
      try {
        cb(event, data);
      } catch (err) {
        console.error('[CatalogUpdater] Listener error:', err);
      }
    });
  }
  
  /**
   * Cleanup
   */
  cleanup() {
    this.stopAutoRefresh();
    this.listeners.clear();
  }
}

// Singleton instance
let instance = null;

function getCatalogUpdater() {
  if (!instance) {
    instance = new ModelCatalogUpdater();
  }
  return instance;
}

module.exports = {
  ModelCatalogUpdater,
  getCatalogUpdater,
};
