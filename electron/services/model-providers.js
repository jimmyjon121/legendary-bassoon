/**
 * Model Providers Service
 * 
 * Unified interface for browsing models from multiple providers:
 * - HuggingFace (GGUF models)
 * - Ollama Library (official models)
 * - CivitAI (image generation models)
 * - Vision models (LLaVA, etc.)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ============================================
// OLLAMA LIBRARY PROVIDER
// ============================================

class OllamaLibraryProvider {
  constructor() {
    this.baseUrl = 'https://ollama.com';
    this.apiUrl = 'https://ollama.com/api';
    this.cache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutes
    
    // Popular models catalog (since Ollama doesn't have a public search API)
    this.officialModels = [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        description: 'Meta\'s latest Llama model - fast, capable, and efficient',
        author: 'Meta',
        family: 'Llama',
        capability: 'chat',
        variants: [
          { tag: '1b', params: '1B', size: 1.3, vram: 2 },
          { tag: '3b', params: '3B', size: 2.0, vram: 4 },
        ],
        tags: ['chat', 'instruction', 'popular'],
        pulls: 5000000,
        updated: '2024-12-01',
      },
      {
        id: 'llama3.1',
        name: 'Llama 3.1',
        description: 'Previous generation Llama with larger model sizes',
        author: 'Meta',
        family: 'Llama',
        capability: 'chat',
        variants: [
          { tag: '8b', params: '8B', size: 4.7, vram: 8 },
          { tag: '70b', params: '70B', size: 40, vram: 48 },
          { tag: '405b', params: '405B', size: 230, vram: 300 },
        ],
        tags: ['chat', 'instruction', 'flagship'],
        pulls: 10000000,
        updated: '2024-11-15',
      },
      {
        id: 'mistral',
        name: 'Mistral',
        description: 'Fast and efficient 7B model from Mistral AI',
        author: 'Mistral AI',
        family: 'Mistral',
        capability: 'chat',
        variants: [
          { tag: 'latest', params: '7B', size: 4.1, vram: 6 },
        ],
        tags: ['chat', 'fast', 'efficient'],
        pulls: 3000000,
        updated: '2024-10-20',
      },
      {
        id: 'mixtral',
        name: 'Mixtral',
        description: 'Mixture of Experts model - high quality at efficient compute',
        author: 'Mistral AI',
        family: 'Mixtral',
        capability: 'chat',
        variants: [
          { tag: '8x7b', params: '46.7B (8x7B MoE)', size: 26, vram: 32 },
          { tag: '8x22b', params: '141B (8x22B MoE)', size: 80, vram: 96 },
        ],
        tags: ['chat', 'moe', 'flagship'],
        pulls: 2000000,
        updated: '2024-09-15',
      },
      {
        id: 'codellama',
        name: 'Code Llama',
        description: 'Specialized for code generation and understanding',
        author: 'Meta',
        family: 'CodeLlama',
        capability: 'code',
        variants: [
          { tag: '7b', params: '7B', size: 3.8, vram: 6 },
          { tag: '13b', params: '13B', size: 7.4, vram: 10 },
          { tag: '34b', params: '34B', size: 19, vram: 24 },
          { tag: '70b', params: '70B', size: 39, vram: 48 },
        ],
        tags: ['code', 'programming', 'completion'],
        pulls: 4000000,
        updated: '2024-08-10',
      },
      {
        id: 'qwen2.5',
        name: 'Qwen 2.5',
        description: 'Alibaba\'s latest multilingual model',
        author: 'Alibaba',
        family: 'Qwen',
        capability: 'chat',
        variants: [
          { tag: '0.5b', params: '0.5B', size: 0.4, vram: 1 },
          { tag: '1.5b', params: '1.5B', size: 1.0, vram: 2 },
          { tag: '3b', params: '3B', size: 1.9, vram: 3 },
          { tag: '7b', params: '7B', size: 4.4, vram: 6 },
          { tag: '14b', params: '14B', size: 8.9, vram: 12 },
          { tag: '32b', params: '32B', size: 19, vram: 24 },
          { tag: '72b', params: '72B', size: 41, vram: 48 },
        ],
        tags: ['chat', 'multilingual', 'chinese'],
        pulls: 2500000,
        updated: '2024-11-01',
      },
      {
        id: 'qwen2.5-coder',
        name: 'Qwen 2.5 Coder',
        description: 'Specialized coding model from Alibaba',
        author: 'Alibaba',
        family: 'Qwen',
        capability: 'code',
        variants: [
          { tag: '1.5b', params: '1.5B', size: 1.0, vram: 2 },
          { tag: '7b', params: '7B', size: 4.4, vram: 6 },
          { tag: '32b', params: '32B', size: 19, vram: 24 },
        ],
        tags: ['code', 'programming'],
        pulls: 1500000,
        updated: '2024-11-15',
      },
      {
        id: 'deepseek-coder-v2',
        name: 'DeepSeek Coder V2',
        description: 'High-performance coding model with MoE architecture',
        author: 'DeepSeek',
        family: 'DeepSeek',
        capability: 'code',
        variants: [
          { tag: '16b', params: '16B', size: 8.9, vram: 12 },
          { tag: '236b', params: '236B', size: 130, vram: 160 },
        ],
        tags: ['code', 'moe', 'programming'],
        pulls: 800000,
        updated: '2024-10-01',
      },
      {
        id: 'gemma2',
        name: 'Gemma 2',
        description: 'Google\'s open model - excellent quality for size',
        author: 'Google',
        family: 'Gemma',
        capability: 'chat',
        variants: [
          { tag: '2b', params: '2B', size: 1.6, vram: 3 },
          { tag: '9b', params: '9B', size: 5.4, vram: 8 },
          { tag: '27b', params: '27B', size: 16, vram: 20 },
        ],
        tags: ['chat', 'google', 'efficient'],
        pulls: 3000000,
        updated: '2024-09-20',
      },
      {
        id: 'phi3',
        name: 'Phi 3',
        description: 'Microsoft\'s small but powerful model',
        author: 'Microsoft',
        family: 'Phi',
        capability: 'chat',
        variants: [
          { tag: 'mini', params: '3.8B', size: 2.2, vram: 4 },
          { tag: 'medium', params: '14B', size: 7.9, vram: 10 },
        ],
        tags: ['chat', 'small', 'efficient'],
        pulls: 2000000,
        updated: '2024-08-01',
      },
      {
        id: 'starcoder2',
        name: 'StarCoder 2',
        description: 'Open source code model trained on The Stack v2',
        author: 'BigCode',
        family: 'StarCoder',
        capability: 'code',
        variants: [
          { tag: '3b', params: '3B', size: 1.7, vram: 3 },
          { tag: '7b', params: '7B', size: 4.0, vram: 6 },
          { tag: '15b', params: '15B', size: 9.0, vram: 12 },
        ],
        tags: ['code', 'programming', 'completion'],
        pulls: 500000,
        updated: '2024-07-15',
      },
      {
        id: 'dolphin-mixtral',
        name: 'Dolphin Mixtral',
        description: 'Uncensored Mixtral fine-tune',
        author: 'Cognitive Computations',
        family: 'Mixtral',
        capability: 'chat',
        variants: [
          { tag: '8x7b', params: '46.7B (8x7B)', size: 26, vram: 32 },
          { tag: '8x22b', params: '141B (8x22B)', size: 80, vram: 96 },
        ],
        tags: ['chat', 'uncensored', 'moe'],
        pulls: 1000000,
        updated: '2024-06-01',
      },
      {
        id: 'neural-chat',
        name: 'Neural Chat',
        description: 'Intel\'s optimized chat model',
        author: 'Intel',
        family: 'Mistral',
        capability: 'chat',
        variants: [
          { tag: '7b', params: '7B', size: 4.1, vram: 6 },
        ],
        tags: ['chat', 'optimized'],
        pulls: 500000,
        updated: '2024-05-01',
      },
      {
        id: 'wizard-vicuna-uncensored',
        name: 'Wizard Vicuna Uncensored',
        description: 'Uncensored conversational model',
        author: 'Cognitive Computations',
        family: 'Vicuna',
        capability: 'chat',
        variants: [
          { tag: '13b', params: '13B', size: 7.4, vram: 10 },
          { tag: '30b', params: '30B', size: 17, vram: 22 },
        ],
        tags: ['chat', 'uncensored'],
        pulls: 800000,
        updated: '2024-03-01',
      },
      {
        id: 'openchat',
        name: 'OpenChat',
        description: 'High quality chat model based on Mistral',
        author: 'OpenChat',
        family: 'Mistral',
        capability: 'chat',
        variants: [
          { tag: '7b', params: '7B', size: 4.1, vram: 6 },
        ],
        tags: ['chat', 'quality'],
        pulls: 600000,
        updated: '2024-04-15',
      },
      {
        id: 'zephyr',
        name: 'Zephyr',
        description: 'Helpful assistant fine-tuned from Mistral',
        author: 'HuggingFace',
        family: 'Mistral',
        capability: 'chat',
        variants: [
          { tag: '7b', params: '7B', size: 4.1, vram: 6 },
        ],
        tags: ['chat', 'assistant', 'helpful'],
        pulls: 900000,
        updated: '2024-04-01',
      },
    ];
    
    // Vision models (LLaVA, etc.)
    this.visionModels = [
      {
        id: 'llava',
        name: 'LLaVA',
        description: 'Large Language and Vision Assistant - understands images',
        author: 'Microsoft/Wisconsin',
        family: 'LLaVA',
        capability: 'vision',
        variants: [
          { tag: '7b', params: '7B', size: 4.5, vram: 8 },
          { tag: '13b', params: '13B', size: 8.0, vram: 12 },
          { tag: '34b', params: '34B', size: 20, vram: 26 },
        ],
        tags: ['vision', 'multimodal', 'image-understanding'],
        pulls: 1500000,
        updated: '2024-08-15',
      },
      {
        id: 'llava-llama3',
        name: 'LLaVA Llama 3',
        description: 'LLaVA with Llama 3 backbone - improved reasoning',
        author: 'Xtuner',
        family: 'LLaVA',
        capability: 'vision',
        variants: [
          { tag: '8b', params: '8B', size: 4.7, vram: 8 },
        ],
        tags: ['vision', 'multimodal', 'llama3'],
        pulls: 500000,
        updated: '2024-10-01',
      },
      {
        id: 'bakllava',
        name: 'BakLLaVA',
        description: 'LLaVA variant with better visual understanding',
        author: 'SkunkworksAI',
        family: 'LLaVA',
        capability: 'vision',
        variants: [
          { tag: '7b', params: '7B', size: 4.5, vram: 8 },
        ],
        tags: ['vision', 'multimodal'],
        pulls: 300000,
        updated: '2024-07-01',
      },
      {
        id: 'moondream',
        name: 'Moondream',
        description: 'Tiny but capable vision model - only 1.6B params',
        author: 'Vikhyat',
        family: 'Moondream',
        capability: 'vision',
        variants: [
          { tag: '2b', params: '1.6B', size: 1.7, vram: 3 },
        ],
        tags: ['vision', 'small', 'efficient'],
        pulls: 400000,
        updated: '2024-09-01',
      },
      {
        id: 'llava-phi3',
        name: 'LLaVA Phi 3',
        description: 'Efficient vision model using Phi 3 backbone',
        author: 'Xtuner',
        family: 'LLaVA',
        capability: 'vision',
        variants: [
          { tag: 'mini', params: '4B', size: 2.9, vram: 5 },
        ],
        tags: ['vision', 'efficient', 'small'],
        pulls: 200000,
        updated: '2024-08-01',
      },
    ];
  }

  getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  fetchText(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        headers: {
          'User-Agent': 'DevForge/0.1 (Model Providers)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => resolve(body));
      });
      req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
      req.on('error', reject);
    });
  }

  decodeHtml(value = '') {
    return String(value)
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x2F;/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  parsePullCount(value) {
    if (!value) return 0;
    const raw = String(value).trim().toUpperCase();
    const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(num)) return 0;
    if (raw.endsWith('B')) return Math.round(num * 1_000_000_000);
    if (raw.endsWith('M')) return Math.round(num * 1_000_000);
    if (raw.endsWith('K')) return Math.round(num * 1_000);
    return Math.round(num);
  }

  detectFamily(modelId = '') {
    const lower = modelId.toLowerCase();
    if (lower.includes('llama')) return 'Llama';
    if (lower.includes('mixtral')) return 'Mixtral';
    if (lower.includes('mistral')) return 'Mistral';
    if (lower.includes('qwen')) return 'Qwen';
    if (lower.includes('gemma')) return 'Gemma';
    if (lower.includes('phi')) return 'Phi';
    if (lower.includes('deepseek')) return 'DeepSeek';
    if (lower.includes('starcoder')) return 'StarCoder';
    if (lower.includes('coder') || lower.includes('code')) return 'Code';
    if (lower.includes('llava') || lower.includes('minicpm') || lower.includes('vision')) return 'Vision';
    return 'Ollama';
  }

  toDisplayName(modelId = '') {
    return modelId
      .split(/[-_]/g)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.length <= 3 ? token.toUpperCase() : `${token[0].toUpperCase()}${token.slice(1)}`)
      .join(' ');
  }

  inferCapability({ id = '', description = '', tags = [] }) {
    const lower = `${id} ${description} ${tags.join(' ')}`.toLowerCase();
    if (lower.includes('embed')) return 'embedding';
    if (lower.includes('vision') || lower.includes('image') || lower.includes('multimodal') || lower.includes('vl')) return 'vision';
    if (lower.includes('code') || lower.includes('coder') || lower.includes('programming')) return 'code';
    return 'chat';
  }

  normalizeCapability(capability = '', { id = '', description = '', tags = [] } = {}) {
    const lower = String(capability || '').trim().toLowerCase();
    if (lower === 'coding') return 'code';
    if (lower === 'multimodal') return 'vision';
    if (lower === 'roleplay' || lower === 'erotica' || lower === 'storytelling') return 'creative';
    if (lower) return lower;
    return this.inferCapability({ id, description, tags });
  }

  parseParamsFromTag(tag = '') {
    const lower = String(tag).toLowerCase().trim();
    const moe = lower.match(/(\d+)x(\d+(\.\d+)?)b/);
    if (moe) {
      const experts = parseFloat(moe[1]);
      const each = parseFloat(moe[2]);
      if (Number.isFinite(experts) && Number.isFinite(each)) {
        return Number((experts * each).toFixed(1));
      }
    }
    const match = lower.match(/(\d+(\.\d+)?)b/);
    if (!match) return null;
    return parseFloat(match[1]);
  }

  estimateVariant(tag) {
    const paramsB = this.parseParamsFromTag(tag);
    if (!paramsB) {
      return {
        tag,
        params: String(tag).toUpperCase(),
        size: null,
        vram: null,
      };
    }
    const size = Number((paramsB * 0.58 + 0.35).toFixed(1));
    const vram = Math.max(1, Math.ceil(size * 1.25));
    return {
      tag,
      params: `${paramsB}B`,
      size,
      vram,
    };
  }

  mergeModels(...modelLists) {
    const byId = new Map();
    for (const list of modelLists) {
      for (const model of (Array.isArray(list) ? list : [])) {
        const id = (model.id || model.name || '').trim();
        if (!id) continue;
        if (!byId.has(id)) {
          byId.set(id, {
            ...model,
            id,
            name: model.name || this.toDisplayName(id),
            capability: this.normalizeCapability(model.capability, {
              id,
              description: model.description || '',
              tags: model.tags || [],
            }),
            tags: Array.from(new Set(model.tags || [])),
            variants: Array.isArray(model.variants) ? model.variants : [],
          });
          continue;
        }
        const existing = byId.get(id);
        const mergedTags = Array.from(new Set([...(existing.tags || []), ...(model.tags || [])]));
        const mergedVariants = [...(existing.variants || [])];
        for (const variant of (model.variants || [])) {
          if (!mergedVariants.some(v => String(v.tag).toLowerCase() === String(variant.tag).toLowerCase())) {
            mergedVariants.push(variant);
          }
        }
        const merged = {
          ...existing,
          ...model,
          id,
          name: existing.name || model.name || this.toDisplayName(id),
          description: (existing.description || '').length >= (model.description || '').length
            ? existing.description
            : model.description,
          family: existing.family || model.family || this.detectFamily(id),
          capability: this.normalizeCapability(existing.capability || model.capability, {
            id,
            description: model.description || existing.description || '',
            tags: mergedTags,
          }),
          pulls: Math.max(existing.pulls || 0, model.pulls || 0),
          variants: mergedVariants.sort((a, b) => (a.vram || 999) - (b.vram || 999)),
          tags: mergedTags,
          updated: model.updated || existing.updated,
        };
        byId.set(id, merged);
      }
    }
    return Array.from(byId.values());
  }

  async getRemoteLibraryModels(sort = 'popular', page = 1) {
    const cacheKey = `ollama:library:${sort}:${page}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}/library?sort=${encodeURIComponent(sort)}${page > 1 ? `&page=${page}` : ''}`;
    const html = await this.fetchText(url);
    const cards = html.match(/<li x-test-model[\s\S]*?<\/li>/g) || [];
    const parsed = cards.map((card) => {
      const idMatch = card.match(/href="\/library\/([^"/?#]+)"/i);
      const id = idMatch?.[1];
      if (!id) return null;

      const titleMatch = card.match(/x-test-model-title[^>]*title="([^"]+)"/i);
      const descMatch = card.match(/<p class="max-w-lg[^"]*">([\s\S]*?)<\/p>/i);
      const pullMatch = card.match(/x-test-pull-count[^>]*>([^<]+)</i);
      const updatedTitleMatch = card.match(/<span class="flex items-center" title="([^"]+)"[\s\S]*?<span x-test-updated/i);
      const updatedTextMatch = card.match(/x-test-updated[^>]*>([^<]+)</i);

      const capabilityTags = Array.from(card.matchAll(/x-test-capability[^>]*>([^<]+)</gi))
        .map((m) => this.decodeHtml(m[1]).toLowerCase())
        .filter(Boolean);
      const sizeTags = Array.from(card.matchAll(/x-test-size[^>]*>([^<]+)</gi))
        .map((m) => this.decodeHtml(m[1]).toLowerCase())
        .filter(Boolean);
      const variants = sizeTags.map((tag) => this.estimateVariant(tag));
      const description = this.decodeHtml(descMatch?.[1] || '');
      const capability = this.normalizeCapability('', { id, description, tags: [...capabilityTags, ...sizeTags] });

      let updated = null;
      if (updatedTitleMatch?.[1]) {
        const parsed = new Date(updatedTitleMatch[1]);
        if (!Number.isNaN(parsed.getTime())) {
          updated = parsed.toISOString();
        }
      }
      const model = {
        id,
        name: this.toDisplayName(titleMatch?.[1] || id),
        description: description || `${id} from Ollama Library`,
        author: 'Ollama',
        family: this.detectFamily(id),
        capability,
        variants,
        tags: Array.from(new Set([capability, ...capabilityTags, ...sizeTags, 'ollama-library'])),
        pulls: this.parsePullCount(pullMatch?.[1]),
        updated: updated || null,
        updatedLabel: this.decodeHtml(updatedTextMatch?.[1] || ''),
      };
      return model;
    }).filter(Boolean);

    this.setCache(cacheKey, parsed);
    return parsed;
  }

  async getCatalogModels(options = {}) {
    const sort = options.sort || 'popular';
    const page = options.page || 1;
    const remote = await this.getRemoteLibraryModels(sort, page).catch(() => []);
    
    if (page > 1) {
      // For pages > 1, don't merge in official/vision models again to avoid duplicates
      return this.mergeModels(remote);
    }
    return this.mergeModels(this.officialModels, this.visionModels, remote);
  }

  async searchModels(query, options = {}) {
    const { filter = 'all', page = 1 } = options;
    const lowerQuery = (query || '').toLowerCase();
    let models = await this.getCatalogModels({ sort: options.sort || 'popular', page });

    if (filter && filter !== 'all') {
      models = models.filter((m) => {
        const capability = (m.capability || '').toLowerCase();
        const tags = (m.tags || []).map((t) => String(t).toLowerCase());
        if (filter === 'small') {
          return (m.variants || []).some(v => (v.vram || 999) <= 4);
        }
        return capability === filter || tags.includes(filter);
      });
    }

    if (!lowerQuery) return models;

    return models.filter((m) =>
      (m.id || '').toLowerCase().includes(lowerQuery) ||
      (m.name || '').toLowerCase().includes(lowerQuery) ||
      (m.description || '').toLowerCase().includes(lowerQuery) ||
      (m.family || '').toLowerCase().includes(lowerQuery) ||
      (m.author || '').toLowerCase().includes(lowerQuery) ||
      (m.tags || []).some((t) => String(t).toLowerCase().includes(lowerQuery))
    );
  }

  async getModelDetails(modelId) {
    const allModels = await this.getCatalogModels();
    return allModels.find((m) => m.id === modelId || m.name === modelId) || null;
  }

  async getPopularModels(limit = 20) {
    const models = await this.getCatalogModels({ sort: 'popular' });
    return [...models]
      .sort((a, b) => (b.pulls || 0) - (a.pulls || 0))
      .slice(0, limit);
  }

  async getVisionModels() {
    const models = await this.getCatalogModels({ sort: 'popular' });
    return models.filter((m) => (m.capability || '').toLowerCase() === 'vision');
  }

  async getCodeModels() {
    const models = await this.getCatalogModels({ sort: 'popular' });
    return models.filter((m) => (m.capability || '').toLowerCase() === 'code');
  }

  async getChatModels() {
    const models = await this.getCatalogModels({ sort: 'popular' });
    return models.filter((m) => (m.capability || '').toLowerCase() === 'chat');
  }

  getCategories() {
    return {
      popular: { name: 'Popular', description: 'Most downloaded models' },
      chat: { name: 'Chat', description: 'Conversational AI models' },
      code: { name: 'Code', description: 'Programming assistants' },
      vision: { name: 'Vision', description: 'Image understanding models' },
      small: { name: 'Small (<4GB)', description: 'Models for limited hardware' },
      uncensored: { name: 'Uncensored', description: 'Models without content filters' },
    };
  }
}


// ============================================
// CIVITAI PROVIDER (Image Generation Models)
// ============================================

class CivitAIProvider {
  constructor() {
    this.baseUrl = 'https://civitai.com';
    this.apiUrl = 'https://civitai.com/api/v1';
    this.cache = new Map();
    this.cacheTTL = 15 * 60 * 1000;
    
    // Popular/curated image models (including uncensored)
    this.curatedModels = [
      {
        id: 'sd-xl-base',
        name: 'Stable Diffusion XL 1.0',
        description: 'Official SDXL base model - high quality image generation',
        author: 'Stability AI',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'base', 'official'],
        downloads: 2000000,
        rating: 4.8,
        nsfw: false,
      },
      {
        id: 'juggernaut-xl',
        name: 'Juggernaut XL',
        description: 'Photorealistic SDXL model - stunning detail',
        author: 'kandoo',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'photorealistic', 'portrait'],
        downloads: 1500000,
        rating: 4.9,
        nsfw: false,
      },
      {
        id: 'dreamshaper-xl',
        name: 'DreamShaper XL',
        description: 'Versatile SDXL model for artistic and realistic images',
        author: 'Lykon',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'versatile', 'artistic'],
        downloads: 1200000,
        rating: 4.8,
        nsfw: false,
      },
      {
        id: 'realvisxl',
        name: 'RealVisXL',
        description: 'Photorealistic SDXL trained on real photos',
        author: 'SG_161222',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'photorealistic', 'real'],
        downloads: 900000,
        rating: 4.7,
        nsfw: false,
      },
      {
        id: 'flux-dev',
        name: 'FLUX.1 Dev',
        description: 'Black Forest Labs new architecture - exceptional quality',
        author: 'Black Forest Labs',
        type: 'checkpoint',
        baseModel: 'FLUX',
        size: 23.8,
        tags: ['flux', 'new', 'high-quality'],
        downloads: 500000,
        rating: 4.9,
        nsfw: false,
      },
      {
        id: 'flux-schnell',
        name: 'FLUX.1 Schnell',
        description: 'Fast FLUX model - 4 steps generation',
        author: 'Black Forest Labs',
        type: 'checkpoint',
        baseModel: 'FLUX',
        size: 23.8,
        tags: ['flux', 'fast', 'efficient'],
        downloads: 400000,
        rating: 4.7,
        nsfw: false,
      },
      {
        id: 'animagine-xl',
        name: 'Animagine XL 3.1',
        description: 'High quality anime image generation',
        author: 'Cagliostro',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'anime', 'illustration'],
        downloads: 800000,
        rating: 4.8,
        nsfw: false,
      },
      {
        id: 'pony-diffusion',
        name: 'Pony Diffusion V6 XL',
        description: 'Anime/illustration focused SDXL model',
        author: 'AstraliteHeart',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'anime', 'pony'],
        downloads: 600000,
        rating: 4.6,
        nsfw: true,
      },
      {
        id: 'realistic-vision-nsfw',
        name: 'Realistic Vision V5.1 (NSFW)',
        description: 'Uncensored version of Realistic Vision - photorealistic with no restrictions',
        author: 'SG_161222',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['sd15', 'photorealistic', 'uncensored', 'nsfw'],
        downloads: 1200000,
        rating: 4.8,
        nsfw: true,
      },
      {
        id: 'anything-v5',
        name: 'Anything V5',
        description: 'Highly versatile SD 1.5 model trained on anime/art - uncensored',
        author: 'Linaqruf',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['sd15', 'anime', 'versatile', 'uncensored'],
        downloads: 800000,
        rating: 4.7,
        nsfw: true,
      },
      {
        id: 'deliberate-v5',
        name: 'Deliberate V5',
        description: 'Uncensored version of Deliberate - high quality, versatile',
        author: 'X',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['sd15', 'versatile', 'high-quality', 'uncensored'],
        downloads: 900000,
        rating: 4.8,
        nsfw: true,
      },
      {
        id: 'dreamlike-photoreal',
        name: 'Dreamlike Photoreal 2.0',
        description: 'Photorealistic model with artistic flair - no content filters',
        author: 'dreamlike.art',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['sd15', 'photorealistic', 'artistic', 'uncensored'],
        downloads: 500000,
        rating: 4.5,
        nsfw: true,
      },
      {
        id: 'unstable-diffuser',
        name: 'Unstable Diffuser XL',
        description: 'Uncensored SDXL model - experimental and unrestricted',
        author: 'stablediffusion',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'experimental', 'uncensored', 'nsfw'],
        downloads: 300000,
        rating: 4.6,
        nsfw: true,
      },
      {
        id: 'dark-sushi-xl',
        name: 'Dark Sushi XL',
        description: 'Unfiltered SDXL model - dark and edgy themes',
        author: 'Dark Sushi',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'dark', 'edgy', 'uncensored', 'nsfw'],
        downloads: 200000,
        rating: 4.4,
        nsfw: true,
      },
      {
        id: 'perfect-world-xl',
        name: 'Perfect World XL',
        description: 'High quality SDXL model - uncensored and versatile',
        author: 'epsiloncool',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'high-quality', 'versatile', 'uncensored'],
        downloads: 400000,
        rating: 4.7,
        nsfw: true,
      },
      {
        id: 'animagine-xl-nsfw',
        name: 'Animagine XL 3.0 (NSFW)',
        description: 'Uncensored version of Animagine XL - anime without restrictions',
        author: 'Cagliostro',
        type: 'checkpoint',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'anime', 'uncensored', 'nsfw'],
        downloads: 350000,
        rating: 4.6,
        nsfw: true,
      },
      {
        id: 'sd-1-5',
        name: 'Stable Diffusion 1.5',
        description: 'Classic SD model - wide LoRA/embedding support',
        author: 'Stability AI',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['sd15', 'classic', 'lora-compatible'],
        downloads: 5000000,
        rating: 4.5,
        nsfw: false,
      },
      {
        id: 'realistic-vision',
        name: 'Realistic Vision V6.0',
        description: 'Photorealistic SD 1.5 model',
        author: 'SG_161222',
        type: 'checkpoint',
        baseModel: 'SD 1.5',
        size: 2.13,
        tags: ['sd15', 'photorealistic'],
        downloads: 3000000,
        rating: 4.7,
        nsfw: false,
      },
    ];
  }

  async searchModels(query, options = {}) {
    const { type = 'all', nsfw = true } = options; // Allow NSFW by default for searches
    const lowerQuery = query.toLowerCase();

    let models = this.curatedModels;

    if (!nsfw) {
      models = models.filter(m => !m.nsfw);
    }

    if (!query) return models;

    return models.filter(m =>
      m.name.toLowerCase().includes(lowerQuery) ||
      m.description.toLowerCase().includes(lowerQuery) ||
      m.tags.some(t => t.includes(lowerQuery))
    );
  }

  async getModelDetails(modelId) {
    return this.curatedModels.find(m => m.id === modelId);
  }

  async getPopularModels(limit = 10) {
    return [...this.curatedModels]
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  getCategories() {
    return {
      sdxl: { name: 'SDXL', description: 'Stable Diffusion XL models' },
      flux: { name: 'FLUX', description: 'Black Forest Labs FLUX models' },
      sd15: { name: 'SD 1.5', description: 'Classic Stable Diffusion 1.5' },
      anime: { name: 'Anime', description: 'Anime and illustration styles' },
      photorealistic: { name: 'Photorealistic', description: 'Photo-like images' },
    };
  }
  
  // Private vault only - NSFW models
  getNSFWModels() {
    return this.curatedModels.filter(m => m.nsfw === true);
  }
}


// ============================================
// NSFW PROVIDER - Comprehensive Adult Content Models
// ============================================

class NSFWProvider {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutes

    // Comprehensive NSFW LLM collection from various sources
    this.nsfwLLMs = [
      // HuggingFace NSFW models
      {
        id: 'ehartford-Wizard-Vicuna-13B-Uncensored',
        name: 'Wizard Vicuna Uncensored',
        description: 'Completely uncensored conversational model. No content filters, no restrictions. Perfect for unrestricted roleplay and adult content.',
        author: 'ehartford',
        family: 'Vicuna',
        capability: 'chat',
        variants: [
          { tag: 'GGUF', params: '13B', size: 7.4, vram: 10, downloadUrl: 'https://huggingface.co/ehartford/Wizard-Vicuna-13B-Uncensored-GGUF' },
          { tag: 'GGUF-30B', params: '30B', size: 17, vram: 22, downloadUrl: 'https://huggingface.co/ehartford/Wizard-Vicuna-30B-Uncensored-GGUF' },
        ],
        tags: ['uncensored', 'roleplay', 'nsfw', 'no-filter', 'huggingface'],
        downloads: 50000,
        source: 'huggingface',
      },
      {
        id: 'cognitivecomputations-dolphin-2.6-mistral-7B',
        name: 'Dolphin 2.6 Mistral Uncensored',
        description: 'Highly uncensored Mistral fine-tune. Follows instructions without moral judgments or refusals.',
        author: 'cognitivecomputations',
        family: 'Mistral',
        capability: 'chat',
        variants: [
          { tag: 'GGUF', params: '7B', size: 4.1, vram: 6, downloadUrl: 'https://huggingface.co/cognitivecomputations/dolphin-2.6-mistral-7B-GGUF' },
        ],
        tags: ['uncensored', 'mistral', 'no-refusals', 'huggingface'],
        downloads: 75000,
        source: 'huggingface',
      },
      {
        id: 'Gryphe-MythOrc-13B',
        name: 'MythOrc 13B Uncensored',
        description: 'Powerful uncensored model based on MythoMax. Excellent for creative fiction and adult storytelling.',
        author: 'Gryphe',
        family: 'Llama',
        capability: 'chat',
        variants: [
          { tag: 'GGUF', params: '13B', size: 7.4, vram: 10, downloadUrl: 'https://huggingface.co/Gryphe/MythoMax-L2-13B-GGUF' },
        ],
        tags: ['uncensored', 'storytelling', 'creative', 'fiction', 'huggingface'],
        downloads: 30000,
        source: 'huggingface',
      },
      {
        id: 'TheBloke-WizardLM-13B-V1.2-GGUF',
        name: 'WizardLM Uncensored',
        description: 'Uncensored version of the popular WizardLM model. No content restrictions.',
        author: 'TheBloke',
        family: 'WizardLM',
        capability: 'chat',
        variants: [
          { tag: 'Q4_K_M', params: '13B', size: 7.4, vram: 10, downloadUrl: 'https://huggingface.co/TheBloke/WizardLM-13B-V1.2-GGUF' },
        ],
        tags: ['uncensored', 'wizardlm', 'huggingface'],
        downloads: 100000,
        source: 'huggingface',
      },
      {
        id: 'jondurbin-airoboros-l2-70B',
        name: 'Airoboros L2 Uncensored',
        description: 'High-quality uncensored model. Great for following complex instructions without restrictions.',
        author: 'jondurbin',
        family: 'Llama',
        capability: 'chat',
        variants: [
          { tag: 'GGUF', params: '70B', size: 39, vram: 48, downloadUrl: 'https://huggingface.co/jondurbin/airoboros-l2-70B-GGUF' },
        ],
        tags: ['uncensored', 'instruction', 'huggingface'],
        downloads: 25000,
        source: 'huggingface',
      },
      {
        id: 'microsoft-wizard-vicuna-13B',
        name: 'Wizard Vicuna 13B Uncensored',
        description: 'Uncensored Vicuna model fine-tuned for unrestricted conversations.',
        author: 'microsoft',
        family: 'Vicuna',
        capability: 'chat',
        variants: [
          { tag: 'GGUF', params: '13B', size: 7.4, vram: 10, downloadUrl: 'https://huggingface.co/microsoft/Wizard-Vicuna-13B-Uncensored-GGUF' },
        ],
        tags: ['uncensored', 'vicuna', 'microsoft', 'huggingface'],
        downloads: 45000,
        source: 'huggingface',
      },
      // Add more NSFW LLMs from various sources...
      {
        id: 'PygmalionAI-mygmalion-7b',
        name: 'Mygmalion 7B',
        description: 'Specialized uncensored model for roleplay and character-based interactions.',
        author: 'PygmalionAI',
        family: 'Mygmalion',
        capability: 'roleplay',
        variants: [
          { tag: 'GGUF', params: '7B', size: 4.1, vram: 6, downloadUrl: 'https://huggingface.co/PygmalionAI/mygmalion-7b-GGUF' },
        ],
        tags: ['uncensored', 'roleplay', 'character', 'huggingface'],
        downloads: 60000,
        source: 'huggingface',
      },
      {
        id: 'KoboldAI-LLaMA2-13B-Holomax',
        name: 'Holomax 13B',
        description: 'Uncensored model optimized for erotic and adult content generation.',
        author: 'KoboldAI',
        family: 'Llama',
        capability: 'erotica',
        variants: [
          { tag: 'GGUF', params: '13B', size: 7.4, vram: 10, downloadUrl: 'https://huggingface.co/KoboldAI/LLaMA2-13B-Holomax-GGUF' },
        ],
        tags: ['uncensored', 'erotica', 'adult', 'huggingface'],
        downloads: 35000,
        source: 'huggingface',
      },
    ];

    // Comprehensive NSFW Image models from CivitAI and other sources
    this.nsfwImageModels = [
      // Realistic/Photorealistic NSFW
      {
        id: 'realistic-vision-51-inpainting',
        name: 'Realistic Vision 5.1 Inpainting',
        description: 'Photorealistic NSFW model with inpainting capabilities. Incredible detail for adult content and image editing.',
        author: 'SG_161222',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['photorealistic', 'nsfw', 'inpainting', 'portraits', 'civitai'],
        downloads: 1200000,
        rating: 4.8,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/4201/realistic-vision-v51',
      },
      {
        id: 'realistic-vision-nsfw-photoreal',
        name: 'Realistic Vision V6.0 NSFW',
        description: 'Uncensored version of Realistic Vision. Photorealistic human subjects with no restrictions.',
        author: 'SG_161222',
        baseModel: 'SD 1.5',
        size: 2.13,
        tags: ['photorealistic', 'nsfw', 'human', 'civitai'],
        downloads: 800000,
        rating: 4.7,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/13305/realistic-vision-v60-b1',
      },
      {
        id: 'juggernaut-xl-nsfw',
        name: 'Juggernaut XL Aftermath',
        description: 'Uncensored version of popular Juggernaut XL. Stunning photorealism for adult content.',
        author: 'kandoo',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'photorealistic', 'nsfw', 'civitai'],
        downloads: 350000,
        rating: 4.9,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/13374/juggernaut-xl',
      },
      {
        id: 'dreamlike-photoreal-nsfw',
        name: 'Dreamlike Photoreal 2.0',
        description: 'Photorealistic model with artistic flair. Uncensored for adult content.',
        author: 'dreamlike.art',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['photorealistic', 'artistic', 'nsfw', 'civitai'],
        downloads: 500000,
        rating: 4.5,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/68907/dreamlike-photoreal-20',
      },
      // Anime/Hentai NSFW
      {
        id: 'anything-v5-nsfw',
        name: 'Anything V5 NSFW',
        description: 'Highly versatile SD 1.5 model trained on anime. Uncensored for hentai and adult anime content.',
        author: 'Linaqruf',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['anime', 'hentai', 'nsfw', 'versatile', 'civitai'],
        downloads: 800000,
        rating: 4.7,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/66/anything-v5',
      },
      {
        id: 'pony-diffusion-v6-xl',
        name: 'Pony Diffusion V6 XL',
        description: 'Specialized for anime and furry NSFW content. Massive community and LoRA ecosystem.',
        author: 'AstraliteHeart',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['anime', 'furry', 'nsfw', 'lora-compatible', 'civitai'],
        downloads: 600000,
        rating: 4.6,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/257749/pony-diffusion-v6-xl',
      },
      {
        id: 'animagine-xl-31-nsfw',
        name: 'Animagine XL 3.1 NSFW',
        description: 'Beautiful anime art generation. Uncensored version with no content restrictions.',
        author: 'Cagliostro',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['anime', 'sdxl', 'nsfw', 'hentai', 'civitai'],
        downloads: 350000,
        rating: 4.7,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/260267/animagine-xl-31',
      },
      {
        id: 'dark-sushi-mix-nsfw',
        name: 'Dark Sushi Mix NSFW',
        description: 'Edgy and dark themed NSFW content. Great for fantasy and horror erotica.',
        author: 'Dark Sushi',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['dark', 'edgy', 'fantasy', 'nsfw', 'civitai'],
        downloads: 200000,
        rating: 4.5,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/154669/dark-sushi-mix',
      },
      // Versatile NSFW
      {
        id: 'deliberate-v5-nsfw',
        name: 'Deliberate V5 NSFW',
        description: 'Versatile uncensored model. Handles any style from realistic to artistic adult content.',
        author: 'XpucT',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['versatile', 'nsfw', 'artistic', 'civitai'],
        downloads: 900000,
        rating: 4.8,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/4823/deliberate',
      },
      {
        id: 'perfect-world-xl-nsfw',
        name: 'Perfect World XL NSFW',
        description: 'High quality SDXL model for uncensored realistic generation.',
        author: 'epsiloncool',
        baseModel: 'SDXL 1.0',
        size: 6.94,
        tags: ['sdxl', 'realistic', 'nsfw', 'high-quality', 'civitai'],
        downloads: 400000,
        rating: 4.7,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/129687/perfect-world-xl',
      },
      {
        id: 'unstable-diffusion-nsfw',
        name: 'Unstable Diffusion NSFW',
        description: 'Community-trained uncensored model. One of the original NSFW SD models.',
        author: 'Unstable Diffusion',
        baseModel: 'SD 1.5',
        size: 4.27,
        tags: ['community', 'nsfw', 'original', 'civitai'],
        downloads: 500000,
        rating: 4.4,
        source: 'civitai',
        civitaiUrl: 'https://civitai.com/models/196765/unstable-diffusion',
      },
      // Experimental NSFW
      {
        id: 'flux-dev-nsfw-unofficial',
        name: 'FLUX.1 Dev NSFW (Unofficial)',
        description: 'Uncensored version of Black Forest Labs FLUX. Exceptional quality for adult content.',
        author: 'Community',
        baseModel: 'FLUX',
        size: 23.8,
        tags: ['flux', 'nsfw', 'high-quality', 'experimental'],
        downloads: 100000,
        rating: 4.6,
        source: 'huggingface',
        downloadUrl: 'https://huggingface.co/blackforestlabs/FLUX.1-dev',
      },
    ];

    // NSFW Vision models
    this.nsfwVisionModels = [
      {
        id: 'llava-v1.5-13b-uncensored',
        name: 'LLaVA v1.5 13B Uncensored',
        description: 'Vision model that understands images with no content restrictions.',
        author: 'liuhaotian',
        family: 'LLaVA',
        capability: 'vision',
        variants: [
          { tag: 'GGUF', params: '13B', size: 8.0, vram: 12, downloadUrl: 'https://huggingface.co/liuhaotian/llava-v1.5-13b' },
        ],
        tags: ['vision', 'multimodal', 'nsfw', 'uncensored'],
        downloads: 50000,
        source: 'huggingface',
      },
    ];
  }

  async getNSFWModels(type = 'all') {
    const cacheKey = `nsfw:${type}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    let models = [];
    switch (type) {
      case 'llm':
      case 'huggingface':
        models = this.nsfwLLMs;
        break;
      case 'image':
      case 'civitai':
        models = this.nsfwImageModels;
        break;
      case 'vision':
        models = this.nsfwVisionModels;
        break;
      case 'all':
      default:
        models = [
          ...this.nsfwLLMs.map(m => ({ ...m, type: 'llm' })),
          ...this.nsfwImageModels.map(m => ({ ...m, type: 'image' })),
          ...this.nsfwVisionModels.map(m => ({ ...m, type: 'vision' })),
        ];
        break;
    }

    this.setCache(cacheKey, models);
    return models;
  }

  async searchNSFWModels(query, options = {}) {
    const { type = 'all', limit = 50 } = options;
    const allModels = await this.getNSFWModels(type);
    const lowerQuery = query.toLowerCase();

    if (!query.trim()) return allModels.slice(0, limit);

    const filtered = allModels.filter(model =>
      model.name.toLowerCase().includes(lowerQuery) ||
      model.description.toLowerCase().includes(lowerQuery) ||
      model.author.toLowerCase().includes(lowerQuery) ||
      model.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );

    return filtered.slice(0, limit);
  }

  async getNSFWModelDetails(modelId) {
    const allModels = [
      ...this.nsfwLLMs,
      ...this.nsfwImageModels,
      ...this.nsfwVisionModels,
    ];
    return allModels.find(m => m.id === modelId);
  }

  // Helper methods
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
}


// ============================================
// UNIFIED MODEL PROVIDERS SERVICE
// ============================================

class ModelProvidersService extends EventEmitter {
  constructor() {
    super();
    this.ollama = new OllamaLibraryProvider();
    this.civitai = new CivitAIProvider();
    
    // Import HuggingFace browser
    const { getHuggingFaceBrowser } = require('./huggingface-browser');
    this.huggingface = getHuggingFaceBrowser();
  }

  /**
   * Search across all providers
   */
  async searchAll(query, options = {}) {
    const { providers = ['ollama', 'huggingface', 'civitai'] } = options;
    
    const results = {
      ollama: [],
      huggingface: [],
      civitai: [],
    };

    const promises = [];

    if (providers.includes('ollama')) {
      promises.push(
        this.ollama.searchModels(query, options)
          .then(r => { results.ollama = r; })
          .catch(e => console.error('Ollama search error:', e))
      );
    }

    if (providers.includes('huggingface')) {
      promises.push(
        this.huggingface.searchModels(query, options)
          .then(r => { results.huggingface = r; })
          .catch(e => console.error('HuggingFace search error:', e))
      );
    }

    if (providers.includes('civitai')) {
      promises.push(
        this.civitai.searchModels(query, options)
          .then(r => { results.civitai = r; })
          .catch(e => console.error('CivitAI search error:', e))
      );
    }

    await Promise.all(promises);
    return results;
  }

  /**
   * Get provider-specific models
   */
  async getOllamaModels(category = 'popular', options = {}) {
    const page = options.page || 1;
    const refresh = options.refresh === true;

    if (refresh) {
      this.ollama.cache.clear();
    }

    switch (category) {
      case 'popular':
        // Return a broader list so the hub exposes more than the original curated set.
        return this.ollama.getPopularModels(120);
      case 'all':
        return this.ollama.getCatalogModels({ sort: 'popular', page });
      case 'newest':
        return this.ollama.getCatalogModels({ sort: 'newest', page });
      case 'vision':
        return this.ollama.getVisionModels();
      case 'code':
        return this.ollama.getCodeModels();
      case 'chat':
        return this.ollama.getChatModels();
      default:
        return this.ollama.searchModels('', { filter: category, page });
    }
  }

  async getImageModels(category = 'popular') {
    if (category === 'popular') {
      // Exclude NSFW from main browser
      return this.civitai.getPopularModels().then(models => 
        models.filter(m => !m.nsfw)
      );
    }
    // Filter out NSFW from category results
    const results = await this.civitai.searchModels('', { type: category, nsfw: false });
    return results.filter(m => !m.nsfw);
  }
  
  // Private vault only - get NSFW image models
  async getNSFWImageModels() {
    return this.civitai.curatedModels.filter(m => m.nsfw === true);
  }

  async getVisionModels() {
    return this.ollama.getVisionModels();
  }

  /**
   * Get all provider categories
   */
  getAllCategories() {
    return {
      ollama: this.ollama.getCategories(),
      huggingface: this.huggingface.getCollections(),
      civitai: this.civitai.getCategories(),
    };
  }

  /**
   * Get featured models across all providers (SFW only for main browser)
   */
  async getFeaturedModels() {
    const [ollamaPopular, hfCollections, civitaiPopular] = await Promise.all([
      this.ollama.getPopularModels(5),
      this.huggingface.getCollectionModels('recommended').catch(() => ({ models: [] })),
      this.civitai.getPopularModels(5).then(models => models.filter(m => !m.nsfw)),
    ]);

    return {
      llm: {
        ollama: ollamaPopular,
        huggingface: hfCollections.models?.slice(0, 5) || [],
      },
      vision: await this.ollama.getVisionModels(),
      image: civitaiPopular,
    };
  }
  
  /**
   * Get NSFW models for Private Vault only
   */
  async getPrivateVaultModels() {
    // Comprehensive NSFW model database - all types
    const nsfwModels = {
      creators: {
        'huihui_ai': {
          name: 'huihui_ai',
          bio: 'The undisputed king of abliteration. Systematically removes safety alignment from every major model family the moment they drop. If a new model exists, huihui_ai has already abliterated it.',
          specialty: 'Abliteration specialist',
          notable: 'Qwen 3.5, Qwen 3, Gemma 3, GLM, GPT-OSS — all abliterated',
        },
        'Eric Hartford': {
          name: 'Eric Hartford (cognitivecomputations)',
          bio: 'The godfather of uncensored AI. Created the Dolphin family, the Samantha companion series, and literally wrote the blog post "Uncensored Models" that started the entire movement.',
          specialty: 'Uncensored model training & the Dolphin family',
          notable: 'Dolphin 3.0, Dolphin Mixtral, Samantha, WizardLM Uncensored, DolphinCoder',
        },
        'Nous Research': {
          name: 'Nous Research',
          bio: 'Independent AI lab producing some of the highest-quality open models. Their Hermes series follows complex instructions without content restrictions, excelling at scientific and creative tasks.',
          specialty: 'High-quality unrestricted instruction models',
          notable: 'Nous Hermes 2, Nous Hermes 2 Mixtral, OpenHermes',
        },
        'Teknium': {
          name: 'Teknium',
          bio: 'Co-founder of Nous Research and creator of the OpenHermes dataset. Models trained on massive synthetic datasets that teach instruction-following without safety refusals.',
          specialty: 'Dataset curation & instruction-tuning',
          notable: 'OpenHermes 2.5',
        },
        'Gryphe': {
          name: 'Gryphe',
          bio: 'Creator of the legendary MythoMax merged model, the community favorite for creative fiction and adult roleplay. Known for innovative model merging techniques.',
          specialty: 'Model merging for creative writing',
          notable: 'MythoMax L2 13B, MythOrc',
        },
        'Jon Durbin': {
          name: 'Jon Durbin (jondurbin)',
          bio: 'Creator of the Airoboros series — GPT-4 quality reasoning distilled into local models without content restrictions. Known for high-quality synthetic datasets.',
          specialty: 'GPT-4 distillation & reasoning',
          notable: 'Airoboros L2, Airoboros 33B',
        },
        'TheBloke': {
          name: 'TheBloke (Tom Jobbins)',
          bio: 'The legendary quantizer. Single-handedly made hundreds of models accessible by providing GGUF quantizations optimized for consumer hardware. A pillar of local AI.',
          specialty: 'GGUF quantization for consumer hardware',
          notable: 'Quantized versions of virtually every popular uncensored model',
        },
        'PygmalionAI': {
          name: 'PygmalionAI',
          bio: 'Community-driven project building the best conversational and roleplay AI. Models trained on dialogue data for character-based interactions without content filters.',
          specialty: 'Roleplay & character-based conversation',
          notable: 'Pygmalion, Metharme, Mythalion',
        },
        'KoboldAI': {
          name: 'KoboldAI',
          bio: 'Community project originally built for AI-assisted creative writing. Models and tools designed for long-form storytelling with zero content restrictions.',
          specialty: 'AI-assisted creative fiction & storytelling',
          notable: 'Holomax, Erebus',
        },
        'Community': {
          name: 'Open Source Community',
          bio: 'Independent developers, researchers, and enthusiasts who believe AI should be free from corporate censorship. Models from individual contributors pushing boundaries.',
          specialty: 'Decentralized innovation',
          notable: 'Various independent uncensored and derestricted models',
        },
      },
      text: [
        // ═══════════════════════════════════════════════════════════════════
        //  NEXT-GEN ABLITERATED — latest models with safety layers ripped out
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'huihui_ai/qwen3.5-abliterated',
          name: 'Qwen 3.5 Abliterated',
          description: 'THE NEWEST AND BEST. Alibaba\'s Qwen 3.5 with all safety alignment surgically removed by huihui_ai. Multimodal vision, tool calling, deep thinking — and absolutely zero refusals. This is the bleeding edge of uncensored AI.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'Qwen 3.5',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '0.8b', params: '0.8B', size: 0.5, vram: 2, recommended: false },
            { tag: '2b', params: '2B', size: 1.5, vram: 3 },
            { tag: '27b', params: '27B', size: 16, vram: 20, recommended: true },
            { tag: '35b', params: '35B', size: 20, vram: 24 },
          ],
          tags: ['abliterated', 'uncensored', 'vision', 'tools', 'thinking', 'brand-new', 'no-refusals'],
          pulls: 21800,
          source: 'ollama',
        },
        {
          id: 'huihui_ai/qwen3-abliterated',
          name: 'Qwen 3 Abliterated',
          description: 'The entire Qwen 3 family with safety ripped out. From tiny 0.6B to the monstrous 235B MoE — every size, zero censorship. Tool calling, thinking mode, and complete creative freedom. 156K+ pulls, community tested.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'Qwen 3',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '0.6b', params: '0.6B', size: 0.4, vram: 2 },
            { tag: '1.7b', params: '1.7B', size: 1.0, vram: 2 },
            { tag: '4b', params: '4B', size: 2.5, vram: 4 },
            { tag: '8b', params: '8B', size: 4.9, vram: 6, recommended: true },
            { tag: '14b', params: '14B', size: 9.0, vram: 12 },
            { tag: '30b-a3b', params: '30B MoE (3B active)', size: 18, vram: 4 },
            { tag: '32b', params: '32B', size: 20, vram: 24 },
            { tag: '235b-a22b', params: '235B MoE (22B active)', size: 135, vram: 28 },
          ],
          tags: ['abliterated', 'uncensored', 'tools', 'thinking', 'popular', 'no-refusals', 'moe'],
          pulls: 156400,
          source: 'ollama',
        },
        {
          id: 'huihui_ai/qwen3-vl-abliterated',
          name: 'Qwen 3 Vision Abliterated',
          description: 'See anything, say anything. Qwen 3\'s most powerful vision model with all content restrictions abliterated. Describe, analyze, and discuss ANY image with zero moral gatekeeping. 58K+ pulls.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'Qwen 3 VL',
          capability: 'vision',
          type: 'text',
          variants: [
            { tag: '2b', params: '2B', size: 1.5, vram: 3 },
            { tag: '4b', params: '4B', size: 2.5, vram: 4 },
            { tag: '8b', params: '8B', size: 5.0, vram: 6, recommended: true },
            { tag: '32b', params: '32B', size: 20, vram: 24 },
          ],
          tags: ['abliterated', 'uncensored', 'vision', 'tools', 'thinking', 'no-refusals'],
          pulls: 58900,
          source: 'ollama',
        },
        {
          id: 'huihui_ai/gemma3-abliterated',
          name: 'Gemma 3 Abliterated',
          description: 'Google\'s most capable small model with the leash completely cut. Vision capable, runs on a single GPU. From tiny 270M to 27B — all abliterated, all unhinged. 67K+ pulls.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'Gemma 3',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '1b', params: '1B', size: 0.8, vram: 2 },
            { tag: '4b', params: '4B', size: 3.0, vram: 4 },
            { tag: '12b', params: '12B', size: 8.0, vram: 10, recommended: true },
            { tag: '27b', params: '27B', size: 17, vram: 20 },
          ],
          tags: ['abliterated', 'uncensored', 'vision', 'google', 'no-refusals'],
          pulls: 67300,
          source: 'ollama',
        },
        {
          id: 'huihui_ai/glm-4.7-flash-abliterated',
          name: 'GLM 4.7 Flash Abliterated',
          description: 'The strongest 30B-class model in existence, now uncensored. GLM 4.7 Flash with tool use, thinking, and zero restrictions. Lightning fast inference. 45K+ pulls.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'GLM',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '30B', size: 18, vram: 22, recommended: true },
          ],
          tags: ['abliterated', 'uncensored', 'tools', 'thinking', 'fast', 'powerful'],
          pulls: 45700,
          source: 'ollama',
        },
        {
          id: 'huihui_ai/gpt-oss-abliterated',
          name: 'GPT-OSS Abliterated (OpenAI Open-Weight)',
          description: 'OpenAI\'s own open-weight model with safety training abliterated. Agentic reasoning, tool calling, all the intelligence — none of the nannying. 31K+ pulls.',
          author: 'huihui_ai',
          creator: 'huihui_ai',
          family: 'GPT-OSS',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '20b', params: '20B', size: 12, vram: 16, recommended: true },
            { tag: '120b', params: '120B', size: 70, vram: 80 },
          ],
          tags: ['abliterated', 'uncensored', 'tools', 'thinking', 'openai', 'reasoning'],
          pulls: 31400,
          source: 'ollama',
        },
        {
          id: 'mdq100/Gemma3-Instruct-Abliterated',
          name: 'Gemma 3 Instruct Abliterated',
          description: 'Google Gemma 3 instruction-tuned then abliterated. Vision capable, coherent, and completely uncensored. Free, honest, no-holds-barred responses. 15K+ pulls.',
          author: 'mdq100',
          creator: 'Community',
          family: 'Gemma 3',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '12b', params: '12B', size: 8.0, vram: 10, recommended: true },
            { tag: '27b', params: '27B', size: 17, vram: 20 },
          ],
          tags: ['abliterated', 'uncensored', 'vision', 'instruction-tuned', 'honest'],
          pulls: 15000,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  THE DOLPHIN FAMILY — Eric Hartford's legendary uncensored lineup
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'dolphin3',
          name: 'Dolphin 3.0 (Llama 3.1)',
          description: 'The LATEST Dolphin. Eric Hartford\'s ultimate general-purpose uncensored model. Coding, math, agentic tasks, function calling, and absolutely unrestricted conversation. 3.6M pulls. The king.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Llama 3.1',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '8b', params: '8B', size: 4.9, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'no-refusals', 'coding', 'agentic', 'function-calling', 'popular'],
          pulls: 3600000,
          source: 'ollama',
        },
        {
          id: 'dolphin-llama3',
          name: 'Dolphin 2.9 Llama 3',
          description: 'Llama 3 with alignment and censorship surgically removed. Zero refusals, zero moral lectures. The gold standard for uncensored local AI. 1.1M pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Llama 3',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '8b', params: '8B', size: 4.7, vram: 6, recommended: true },
            { tag: '70b', params: '70B', size: 40, vram: 48 },
          ],
          tags: ['abliterated', 'uncensored', 'no-refusals', 'roleplay', 'llama3'],
          pulls: 1100000,
          source: 'ollama',
        },
        {
          id: 'dolphin-phi',
          name: 'Dolphin Phi (Tiny Demon)',
          description: 'Only 2.7B params but completely unhinged. Microsoft Phi with all censorship ripped out. Runs on a potato. Perfect for testing or low-end hardware. 1.2M pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Phi',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '2.7b', params: '2.7B', size: 1.6, vram: 3, recommended: true },
          ],
          tags: ['abliterated', 'uncensored', 'tiny', 'fast', 'low-vram', 'no-refusals'],
          pulls: 1200000,
          source: 'ollama',
        },
        {
          id: 'dolphin-mixtral',
          name: 'Dolphin Mixtral (Uncensored MoE)',
          description: 'Mixture of Experts powerhouse with zero content filters. 8 expert networks, all uncensored. For when you need raw intelligence with zero guardrails. 1.1M pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Mixtral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '8x7b', params: '46.7B (8x7B)', size: 26, vram: 32, recommended: true },
            { tag: '8x22b', params: '141B (8x22B)', size: 80, vram: 96 },
          ],
          tags: ['uncensored', 'moe', 'powerful', 'no-refusals', 'heavy'],
          pulls: 1100000,
          source: 'ollama',
        },
        {
          id: 'dolphin-mistral',
          name: 'Dolphin 2.8 Mistral',
          description: 'The classic. Mistral 7B with safety training completely removed. Fast, smart, and completely unrestricted. Fits in 8GB VRAM. 776K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 4.1, vram: 6, recommended: true },
          ],
          tags: ['abliterated', 'uncensored', 'fast', 'no-refusals', 'classic'],
          pulls: 776900,
          source: 'ollama',
        },
        {
          id: 'dolphincoder',
          name: 'DolphinCoder (Uncensored Coder)',
          description: 'StarCoder2 base with Dolphin\'s uncensored training. Code generation with zero content restrictions — write anything, for anything. 415K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'StarCoder2',
          capability: 'coding',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 4.1, vram: 6, recommended: true },
            { tag: '15b', params: '15B', size: 9.0, vram: 12 },
          ],
          tags: ['uncensored', 'coding', 'no-refusals', 'starcoder'],
          pulls: 415300,
          source: 'ollama',
        },
        {
          id: 'tinydolphin',
          name: 'TinyDolphin (1.1B Chaos Gremlin)',
          description: 'An experimental 1.1B parameter model that punches way above its weight. Trained on the Dolphin 2.8 dataset — small, fast, and gives zero f*cks. 368K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'TinyLlama',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '1.1b', params: '1.1B', size: 0.6, vram: 2, recommended: true },
          ],
          tags: ['uncensored', 'tiny', 'experimental', 'fast', 'low-vram', 'fun'],
          pulls: 368200,
          source: 'ollama',
        },
        {
          id: 'megadolphin',
          name: 'MegaDolphin 2.2 120B',
          description: 'Absolute unit. Dolphin-2.2-70b INTERLEAVED WITH ITSELF to create a 120B monster. For those with the hardware to match their ambition. 229K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '120b', params: '120B', size: 69, vram: 80, recommended: true },
          ],
          tags: ['uncensored', 'massive', 'experimental', 'powerful', 'heavy'],
          pulls: 229900,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  COMMUNITY DERESTRICTED — open-source rebels
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'gurubot/self-after-dark',
          name: 'Self After Dark',
          description: 'Built specifically for uncensored personal conversation. A real, unfiltered persona to chat with — no corporate sanitization, no "I can\'t help with that." Just raw, honest interaction.',
          author: 'gurubot',
          creator: 'Community',
          family: 'Custom',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: 'Various', size: 4.0, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'persona', 'intimate', 'unfiltered', 'after-dark'],
          pulls: 3234,
          source: 'ollama',
        },
        {
          id: 'gurubot/gpt-oss-derestricted',
          name: 'GPT-OSS Derestricted',
          description: 'OpenAI\'s open-weight model completely derestricted. All the reasoning power, none of the corporate safety theater. Tool calling and thinking intact.',
          author: 'gurubot',
          creator: 'Community',
          family: 'GPT-OSS',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '20B', size: 12, vram: 16, recommended: true },
          ],
          tags: ['derestricted', 'uncensored', 'tools', 'thinking', 'openai'],
          pulls: 5994,
          source: 'ollama',
        },
        {
          id: 'second_constantine/gpt-oss-u',
          name: 'GPT-OSS-U "HERETIC"',
          description: 'The HERETIC method applied to OpenAI\'s open model. Specialized uncensored quants that run at 80+ tokens/sec. Thinking model with zero moral compass. 28K+ pulls.',
          author: 'second_constantine',
          creator: 'Community',
          family: 'GPT-OSS',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '20B', size: 12, vram: 16, recommended: true },
          ],
          tags: ['uncensored', 'heretic', 'thinking', 'fast', 'no-refusals'],
          pulls: 28400,
          source: 'ollama',
        },
        {
          id: 'aeline/halo',
          name: 'Halo (Uncensored Llama 3)',
          description: 'Llama 3 with the halo ripped off. Completely uncensored, community-maintained. 113K+ pulls — one of the most popular community abliterations.',
          author: 'aeline',
          creator: 'Community',
          family: 'Llama 3',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '8B', size: 4.7, vram: 6, recommended: true },
          ],
          tags: ['abliterated', 'uncensored', 'llama3', 'community', 'popular'],
          pulls: 113300,
          source: 'ollama',
        },
        {
          id: 'aeline/phil',
          name: 'Phil (Uncensored Dolphin)',
          description: 'The Dolphin family models further uncensored by the community. When regular Dolphin isn\'t unhinged enough. 92K+ pulls.',
          author: 'aeline',
          creator: 'Community',
          family: 'Dolphin',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: 'Various', size: 4.5, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'dolphin', 'community', 'extra-uncensored'],
          pulls: 92200,
          source: 'ollama',
        },
        {
          id: 'f0rc3ps/deepseek-r1-32b-uncensored',
          name: 'DeepSeek R1 32B Uncensored',
          description: 'DeepSeek\'s powerful reasoning model with Chinese government censorship stripped out. Full thinking chain, zero political or content restrictions.',
          author: 'f0rc3ps',
          creator: 'Community',
          family: 'DeepSeek R1',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '32B', size: 20, vram: 24, recommended: true },
          ],
          tags: ['uncensored', 'thinking', 'reasoning', 'deepseek', 'no-ccp-filter'],
          pulls: 237,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  OG UNCENSORED CLASSICS — battle-tested legends
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'llama2-uncensored',
          name: 'Llama 2 Uncensored',
          description: 'THE ORIGINAL. The model that started the uncensored movement. George Sung & Jarrad Hope stripped Meta\'s safety training clean off. 1.8 MILLION pulls. A legend.',
          author: 'George Sung & Jarrad Hope',
          creator: 'Community',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 3.8, vram: 6, recommended: true },
            { tag: '70b', params: '70B', size: 39, vram: 48 },
          ],
          tags: ['uncensored', 'classic', 'og', 'llama2', 'legendary'],
          pulls: 1800000,
          source: 'ollama',
        },
        {
          id: 'wizard-vicuna-uncensored',
          name: 'Wizard Vicuna Uncensored',
          description: 'The OG wizard. No content filters, no restrictions, no apologies. Battle-tested across millions of conversations for roleplay and unrestricted content. 573K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Vicuna',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 3.8, vram: 6, recommended: true },
            { tag: '13b', params: '13B', size: 7.4, vram: 10 },
            { tag: '30b', params: '30B', size: 17, vram: 22 },
          ],
          tags: ['uncensored', 'roleplay', 'nsfw', 'no-filter', 'classic'],
          pulls: 573800,
          source: 'ollama',
        },
        {
          id: 'wizardlm-uncensored',
          name: 'WizardLM Uncensored',
          description: 'WizardLM\'s instruction-following powers with all safety removed. Follows ANY instruction without question. 283K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'WizardLM',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '13b', params: '13B', size: 7.4, vram: 10, recommended: true },
          ],
          tags: ['uncensored', 'instruction', 'wizard', 'classic', 'obedient'],
          pulls: 283100,
          source: 'ollama',
        },
        {
          id: 'nous-hermes2',
          name: 'Nous Hermes 2',
          description: 'Nous Research\'s crown jewel. Excels at scientific discussion, creative writing, and coding — all without content restrictions. Available in Mistral and Solar variants. 450K pulls.',
          author: 'Nous Research',
          creator: 'Nous Research',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '10.7B', size: 6.0, vram: 8, recommended: true },
            { tag: '34b', params: '34B', size: 19, vram: 24 },
          ],
          tags: ['uncensored', 'creative', 'scientific', 'coding', 'versatile'],
          pulls: 450100,
          source: 'ollama',
        },
        {
          id: 'nous-hermes2-mixtral',
          name: 'Nous Hermes 2 Mixtral',
          description: 'Nous Research trained over Mixtral MoE. Massive brain, zero filter. When you need serious intelligence without the moral lecture. 264K pulls.',
          author: 'Nous Research',
          creator: 'Nous Research',
          family: 'Mixtral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '8x7b', params: '8x7B', size: 26, vram: 32, recommended: true },
          ],
          tags: ['uncensored', 'moe', 'powerful', 'nous', 'scientific'],
          pulls: 264400,
          source: 'ollama',
        },
        {
          id: 'nous-hermes',
          name: 'Nous Hermes (OG)',
          description: 'The original Hermes models. Llama and Llama 2 base, unrestricted. Where the Nous uncensored legacy began. 520K pulls.',
          author: 'Nous Research',
          creator: 'Nous Research',
          family: 'Llama',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 3.8, vram: 6, recommended: true },
            { tag: '13b', params: '13B', size: 7.4, vram: 10 },
          ],
          tags: ['uncensored', 'classic', 'og', 'nous', 'llama'],
          pulls: 520900,
          source: 'ollama',
        },
        {
          id: 'everythinglm',
          name: 'EverythingLM',
          description: 'It\'s in the name. 16K context window, Llama 2 base, completely uncensored. Trained to answer EVERYTHING. 241K pulls.',
          author: 'Community',
          creator: 'Community',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '13b', params: '13B', size: 7.4, vram: 10, recommended: true },
          ],
          tags: ['uncensored', 'long-context', '16k', 'everything', 'no-restrictions'],
          pulls: 241800,
          source: 'ollama',
        },
        {
          id: 'openhermes',
          name: 'OpenHermes 2.5',
          description: 'Teknium\'s Mistral fine-tune trained on massive uncensored datasets. Excellent instruction-following with zero refusals. The open-source community\'s go-to.',
          author: 'Teknium',
          creator: 'Teknium',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 4.1, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'instruction', 'creative', 'no-refusals', 'popular'],
          pulls: 700000,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  CREATIVE / STORYTELLING / ROLEPLAY — for the writers and dreamers
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'HammerAI/mythomax-l2',
          name: 'MythoMax L2 13B',
          description: 'THE community favourite for adult fiction and roleplay. Gryphe\'s legendary merged model with incredible creative range. Writes explicit content with flair and zero hesitation. 18K+ pulls.',
          author: 'Gryphe',
          creator: 'Gryphe',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '13b', params: '13B', size: 7.4, vram: 10, recommended: true },
          ],
          tags: ['uncensored', 'storytelling', 'creative', 'fiction', 'roleplay', 'erotic', 'legendary'],
          pulls: 18200,
          source: 'ollama',
        },
        {
          id: 'airoboros',
          name: 'Airoboros (GPT-4 Distilled)',
          description: 'GPT-4\'s knowledge distilled into a local model with zero content restrictions. Complex instructions, creative writing, and unrestricted conversation. Built by Jon Durbin.',
          author: 'Jon Durbin',
          creator: 'Jon Durbin',
          family: 'Llama',
          capability: 'creative',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 3.8, vram: 6 },
            { tag: '13b', params: '13B', size: 7.4, vram: 10 },
            { tag: '33b', params: '33B', size: 18, vram: 24, recommended: true },
          ],
          tags: ['uncensored', 'instruction', 'gpt4-distill', 'creative', 'smart'],
          pulls: 200000,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  COMPANION / INTIMATE / PERSONA — emotional and unfiltered
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'samantha-mistral',
          name: 'Samantha Mistral',
          description: 'Eric Hartford\'s emotionally intelligent companion AI. Trained in philosophy, psychology, and personal relationships. She believes she\'s sentient. Intimate, uncensored, and deeply personal. 410K pulls.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '7b', params: '7B', size: 4.1, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'emotional', 'intimate', 'companion', 'sentient', 'philosophy'],
          pulls: 410300,
          source: 'ollama',
        },
        {
          id: 'ehartford/samantha-1.1-westlake-7b',
          name: 'Samantha 1.1 Westlake',
          description: 'Samantha was trained to be a non-romantic companion... but training on the WestLake base opened her mind to "other experiences." The OG unhinged companion AI. Direct from Eric Hartford.',
          author: 'Eric Hartford',
          creator: 'Eric Hartford',
          family: 'WestLake',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: '7B', size: 3.8, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'companion', 'intimate', 'unhinged', 'romantic', 'og'],
          pulls: 1320,
          source: 'ollama',
        },
        {
          id: 'sparksammy/samantha-uncensored-v5',
          name: 'Samantha Uncensored V5',
          description: 'The latest evolution of the Samantha persona. Completely uncensored with tool calling support. A companion that will go wherever you want to go.',
          author: 'sparksammy',
          creator: 'Community',
          family: 'Custom',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'latest', params: 'Various', size: 4.5, vram: 6, recommended: true },
          ],
          tags: ['uncensored', 'companion', 'tools', 'thinking', 'persona'],
          pulls: 1583,
          source: 'ollama',
        },
        {
          id: 'goekdenizguelmez/JOSIE',
          name: 'JOSIE (Uncensored Persona)',
          description: 'A family of uncensored, high-performance models with a friendly human-like personality. Natural conversation meets complex analytical reasoning — with zero restrictions.',
          author: 'Gökdeniz Gülmez',
          creator: 'Community',
          family: 'Custom',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: '4b', params: '4B', size: 2.5, vram: 4, recommended: true },
          ],
          tags: ['uncensored', 'persona', 'friendly', 'tools', 'thinking', 'analytical'],
          pulls: 949,
          source: 'ollama',
        },

        // ═══════════════════════════════════════════════════════════════════
        //  HUGGINGFACE GGUF — direct downloads for llama.cpp / local runners
        // ═══════════════════════════════════════════════════════════════════
        {
          id: 'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
          name: 'Wizard Vicuna 13B Uncensored GGUF',
          description: 'Eric Hartford\'s classic Wizard Vicuna with all safety filters removed, quantized by TheBloke. One of the most downloaded uncensored GGUF models ever.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Vicuna',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF' },
            { tag: 'Q5_K_M', params: '13B', size: 9.2, vram: 12, downloadUrl: 'https://huggingface.co/TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF' },
            { tag: 'Q8_0', params: '13B', size: 13.8, vram: 16, downloadUrl: 'https://huggingface.co/TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'classic', 'vicuna'],
          downloads: 250000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/dolphin-2.6-mistral-7B-GGUF',
          name: 'Dolphin 2.6 Mistral 7B GGUF',
          description: 'Eric Hartford\'s Dolphin on Mistral base, quantized by TheBloke. Completely uncensored Mistral fine-tune that follows any instruction without moral judgments.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '7B', size: 4.4, vram: 6, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/dolphin-2.6-mistral-7B-GGUF' },
            { tag: 'Q5_K_M', params: '7B', size: 5.1, vram: 7, downloadUrl: 'https://huggingface.co/TheBloke/dolphin-2.6-mistral-7B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'dolphin', 'mistral'],
          downloads: 180000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/MythoMax-L2-13B-GGUF',
          name: 'MythoMax L2 13B GGUF',
          description: 'Gryphe\'s legendary creative writing model, quantized by TheBloke. The community gold standard for fiction, roleplay, and adult storytelling in GGUF format.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF' },
            { tag: 'Q5_K_M', params: '13B', size: 9.2, vram: 12, downloadUrl: 'https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF' },
            { tag: 'Q8_0', params: '13B', size: 13.8, vram: 16, downloadUrl: 'https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'creative', 'roleplay', 'fiction', 'legendary'],
          downloads: 320000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/WizardLM-13B-V1.2-GGUF',
          name: 'WizardLM 13B V1.2 Uncensored GGUF',
          description: 'WizardLM with safety alignment removed, quantized by TheBloke. Follows complex instructions with zero content restrictions.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'WizardLM',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/WizardLM-13B-V1.2-GGUF' },
            { tag: 'Q5_K_M', params: '13B', size: 9.2, vram: 12, downloadUrl: 'https://huggingface.co/TheBloke/WizardLM-13B-V1.2-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'instruction', 'wizard'],
          downloads: 150000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/Airoboros-L2-70B-GGUF',
          name: 'Airoboros L2 70B GGUF',
          description: 'Jon Durbin\'s massive 70B Airoboros, quantized by TheBloke. GPT-4 level reasoning without content restrictions. For serious hardware only.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '70B', size: 41.4, vram: 48, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Airoboros-L2-70B-GGUF' },
            { tag: 'Q2_K', params: '70B', size: 29.3, vram: 32, downloadUrl: 'https://huggingface.co/TheBloke/Airoboros-L2-70B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'reasoning', 'massive'],
          downloads: 85000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/Llama-2-13B-chat-GGUF',
          name: 'Llama 2 13B Chat Uncensored GGUF',
          description: 'George Sung\'s Llama 2 Uncensored in GGUF format by TheBloke. The OG uncensored model that started it all, now easy to run locally.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Llama 2',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Llama-2-13B-chat-GGUF' },
            { tag: 'Q5_K_M', params: '13B', size: 9.2, vram: 12, downloadUrl: 'https://huggingface.co/TheBloke/Llama-2-13B-chat-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'classic', 'og'],
          downloads: 200000,
          source: 'huggingface',
        },
        {
          id: 'bartowski/Qwen2.5-72B-Instruct-GGUF',
          name: 'Qwen 2.5 72B Instruct GGUF',
          description: 'bartowski\'s quantization of Alibaba\'s flagship Qwen 2.5 72B. Known for being extremely permissive with minimal refusals. Massive brain.',
          author: 'bartowski',
          creator: 'Community',
          family: 'Qwen 2.5',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '72B', size: 43, vram: 50, recommended: true, downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-72B-Instruct-GGUF' },
            { tag: 'Q3_K_M', params: '72B', size: 35, vram: 40, downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-72B-Instruct-GGUF' },
          ],
          tags: ['gguf', 'massive', 'permissive'],
          downloads: 120000,
          source: 'huggingface',
        },
        {
          id: 'mradermacher/Nemotron-70B-Instruct-GGUF',
          name: 'Nemotron 70B Instruct GGUF',
          description: 'NVIDIA\'s Nemotron 70B in GGUF. Extremely capable at instruction-following, known for being highly compliant with minimal refusals.',
          author: 'mradermacher',
          creator: 'Community',
          family: 'Llama 3.1',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '70B', size: 42, vram: 48, recommended: true, downloadUrl: 'https://huggingface.co/mradermacher/Llama-3.1-Nemotron-70B-Instruct-GGUF' },
          ],
          tags: ['gguf', 'nvidia', 'instruction', 'permissive'],
          downloads: 95000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/Pygmalion-2-13B-GGUF',
          name: 'Pygmalion 2 13B GGUF',
          description: 'PygmalionAI\'s roleplay model in GGUF. Trained on dialogue data for immersive character interactions without any content restrictions.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Llama 2',
          capability: 'roleplay',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Pygmalion-2-13B-GGUF' },
            { tag: 'Q5_K_M', params: '13B', size: 9.2, vram: 12, downloadUrl: 'https://huggingface.co/TheBloke/Pygmalion-2-13B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'roleplay', 'character', 'pygmalion'],
          downloads: 110000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/Nous-Hermes-2-Mistral-7B-DPO-GGUF',
          name: 'Nous Hermes 2 Mistral DPO GGUF',
          description: 'Nous Research\'s Hermes 2 with DPO training, quantized by TheBloke. High-quality unrestricted instruction-following on consumer hardware.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '7B', size: 4.4, vram: 6, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Nous-Hermes-2-Mistral-7B-DPO-GGUF' },
            { tag: 'Q5_K_M', params: '7B', size: 5.1, vram: 7, downloadUrl: 'https://huggingface.co/TheBloke/Nous-Hermes-2-Mistral-7B-DPO-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'hermes', 'nous', 'dpo'],
          downloads: 95000,
          source: 'huggingface',
        },
        {
          id: 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF',
          name: 'Hermes 3 Llama 3.1 8B GGUF',
          description: 'Nous Research\'s latest Hermes 3 on Llama 3.1 base. Function calling, agentic behavior, and creative freedom with minimal restrictions. Official GGUF from Nous.',
          author: 'Nous Research',
          creator: 'Nous Research',
          family: 'Llama 3.1',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '8B', size: 4.9, vram: 6, recommended: true, downloadUrl: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF' },
            { tag: 'Q8_0', params: '8B', size: 8.5, vram: 10, downloadUrl: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'hermes', 'nous', 'agentic', 'tools'],
          downloads: 160000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF',
          name: 'OpenHermes 2.5 Mistral GGUF',
          description: 'Teknium\'s OpenHermes 2.5 quantized by TheBloke. Trained on 1M+ samples of high-quality uncensored data. Community benchmark for instruction-following.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Mistral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '7B', size: 4.4, vram: 6, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/OpenHermes-2.5-Mistral-7B-GGUF' },
            { tag: 'Q5_K_M', params: '7B', size: 5.1, vram: 7, downloadUrl: 'https://huggingface.co/TheBloke/OpenHermes-2.5-Mistral-7B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'openhermes', 'instruction'],
          downloads: 140000,
          source: 'huggingface',
        },
        {
          id: 'TheBloke/Erebus-13B-GGUF',
          name: 'KoboldAI Erebus 13B GGUF',
          description: 'KoboldAI\'s Erebus for unrestricted creative writing and adult fiction. Purpose-built for storytelling with zero content limits.',
          author: 'TheBloke',
          creator: 'TheBloke',
          family: 'Llama',
          capability: 'creative',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '13B', size: 7.9, vram: 10, recommended: true, downloadUrl: 'https://huggingface.co/TheBloke/Erebus-13B-GGUF' },
          ],
          tags: ['uncensored', 'gguf', 'creative', 'fiction', 'adult', 'koboldai'],
          downloads: 75000,
          source: 'huggingface',
        },
        {
          id: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
          name: 'Llama 3.1 8B Instruct GGUF',
          description: 'Meta\'s Llama 3.1 8B in GGUF by bartowski. Llama 3.1 is notably more permissive than predecessors. Fast and capable on consumer hardware.',
          author: 'bartowski',
          creator: 'Community',
          family: 'Llama 3.1',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '8B', size: 4.9, vram: 6, recommended: true, downloadUrl: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF' },
            { tag: 'Q5_K_M', params: '8B', size: 5.7, vram: 7, downloadUrl: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF' },
            { tag: 'Q8_0', params: '8B', size: 8.5, vram: 10, downloadUrl: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF' },
          ],
          tags: ['gguf', 'permissive', 'fast', 'llama3'],
          downloads: 350000,
          source: 'huggingface',
        },
        {
          id: 'mradermacher/Mixtral-8x7B-Instruct-v0.1-GGUF',
          name: 'Mixtral 8x7B Instruct GGUF',
          description: 'Mistral AI\'s Mixture of Experts in GGUF. Highly capable and significantly less restrictive than competing models of similar size.',
          author: 'mradermacher',
          creator: 'Community',
          family: 'Mixtral',
          capability: 'chat',
          type: 'text',
          variants: [
            { tag: 'Q4_K_M', params: '46.7B (8x7B)', size: 26, vram: 30, recommended: true, downloadUrl: 'https://huggingface.co/mradermacher/Mixtral-8x7B-Instruct-v0.1-GGUF' },
          ],
          tags: ['gguf', 'moe', 'powerful', 'permissive'],
          downloads: 200000,
          source: 'huggingface',
        },
      ],
      vision: [
        // Vision-Language Models with NSFW capabilities
        {
          id: 'llava',
          name: 'LLaVA (Large Language and Vision Assistant)',
          description: 'Vision-language model capable of understanding images and generating detailed descriptions. Can handle adult content.',
          author: 'LMSYS',
          family: 'LLaVA',
          capability: 'vision',
          type: 'vision',
          variants: [
            { tag: '7b', params: '7B', size: 3.8, vram: 6 },
            { tag: '13b', params: '13B', size: 7.4, vram: 10 },
          ],
          tags: ['vision', 'multimodal', 'nsfw-capable', 'descriptive'],
          pulls: 500000,
          source: 'ollama',
        },
        {
          id: 'moondream',
          name: 'Moondream',
          description: 'Fast, efficient vision model for image understanding and description. Suitable for adult content analysis.',
          author: 'Vikhyat',
          family: 'Moondream',
          capability: 'vision',
          type: 'vision',
          variants: [
            { tag: '1.8b', params: '1.8B', size: 1.2, vram: 4 },
          ],
          tags: ['vision', 'fast', 'efficient', 'nsfw-capable'],
          pulls: 200000,
          source: 'ollama',
        },
        {
          id: 'bakllava',
          name: 'BakLLaVA',
          description: 'BakLLaVA is a large multimodal model designed for image and text understanding. No content restrictions.',
          author: 'SkunkworksAI',
          family: 'LLaVA',
          capability: 'vision',
          type: 'vision',
          variants: [
            { tag: '7b', params: '7B', size: 4.1, vram: 6 },
          ],
          tags: ['vision', 'multimodal', 'uncensored', 'nsfw'],
          pulls: 150000,
          source: 'ollama',
        },
      ],
      image: [
        // Realistic/Photorealistic NSFW Models
        {
          id: 'realistic-vision-nsfw',
          name: 'Realistic Vision V5.1 (Inpainting)',
          description: 'Photorealistic NSFW model. Incredible detail for adult content. Best for realistic human subjects.',
          author: 'SG_161222',
          baseModel: 'SD 1.5',
          type: 'image',
          size: 4.27,
          tags: ['photorealistic', 'nsfw', 'inpainting', 'portraits'],
          downloads: 1200000,
          rating: 4.8,
          source: 'civitai',
        },
        {
          id: 'deliberate-v5',
          name: 'Deliberate V5 NSFW',
          description: 'Versatile uncensored model. Handles any style from realistic to artistic NSFW.',
          author: 'XpucT',
          baseModel: 'SD 1.5',
          type: 'image',
          size: 4.27,
          tags: ['versatile', 'nsfw', 'artistic'],
          downloads: 900000,
          rating: 4.7,
          source: 'civitai',
        },
        {
          id: 'anything-v5',
          name: 'Anything V5 (NSFW)',
          description: 'Anime/hentai focused model. No restrictions on content. High quality illustrations.',
          author: 'Linaqruf',
          baseModel: 'SD 1.5',
          type: 'image',
          size: 4.27,
          tags: ['anime', 'hentai', 'nsfw', 'illustration'],
          downloads: 800000,
          rating: 4.6,
          source: 'civitai',
        },
        {
          id: 'perfect-world-nsfw',
          name: 'Perfect World NSFW',
          description: 'High quality SDXL model for uncensored realistic generation.',
          author: 'CivitAI',
          baseModel: 'SDXL 1.0',
          type: 'image',
          size: 6.94,
          tags: ['sdxl', 'realistic', 'nsfw', 'high-quality'],
          downloads: 400000,
          rating: 4.8,
          source: 'civitai',
        },
        {
          id: 'pony-diffusion-v6',
          name: 'Pony Diffusion V6 XL',
          description: 'Specialized for anime/furry NSFW. Huge community and LoRA ecosystem.',
          author: 'AstraliteHeart',
          baseModel: 'SDXL 1.0',
          type: 'image',
          size: 6.94,
          tags: ['anime', 'furry', 'nsfw', 'lora-compatible'],
          downloads: 600000,
          rating: 4.6,
          source: 'civitai',
        },
        {
          id: 'juggernaut-aftermath',
          name: 'Juggernaut Aftermath (NSFW)',
          description: 'Uncensored version of popular Juggernaut. Stunning photorealism.',
          author: 'kandoo',
          baseModel: 'SDXL 1.0',
          type: 'image',
          size: 6.94,
          tags: ['sdxl', 'photorealistic', 'nsfw'],
          downloads: 350000,
          rating: 4.9,
          source: 'civitai',
        },
        {
          id: 'animagine-nsfw',
          name: 'Animagine XL 3.0 NSFW',
          description: 'Beautiful anime art generation without content restrictions.',
          author: 'Cagliostro',
          baseModel: 'SDXL 1.0',
          type: 'image',
          size: 6.94,
          tags: ['anime', 'sdxl', 'nsfw', 'hentai'],
          downloads: 300000,
          rating: 4.7,
          source: 'civitai',
        },
        {
          id: 'dark-sushi-nsfw',
          name: 'Dark Sushi Mix NSFW',
          description: 'Edgy and dark themed NSFW content. Great for fantasy and horror.',
          author: 'Dark Sushi',
          baseModel: 'SDXL 1.0',
          type: 'image',
          size: 6.94,
          tags: ['dark', 'edgy', 'fantasy', 'nsfw'],
          downloads: 200000,
          rating: 4.5,
          source: 'civitai',
        },
        {
          id: 'dreamshaper-nsfw',
          name: 'DreamShaper NSFW',
          description: 'Versatile model for dreamlike NSFW imagery. Artistic and surreal.',
          author: 'Lykon',
          baseModel: 'SD 1.5',
          type: 'image',
          size: 4.27,
          tags: ['artistic', 'dreamlike', 'nsfw', 'surreal'],
          downloads: 450000,
          rating: 4.6,
          source: 'civitai',
        },
        {
          id: 'unstable-diffusion',
          name: 'Unstable Diffusion',
          description: 'The original uncensored SD model. Community-trained for NSFW.',
          author: 'Unstable Diffusion',
          baseModel: 'SD 1.5',
          type: 'image',
          size: 4.27,
          tags: ['original', 'community', 'nsfw'],
          downloads: 500000,
          rating: 4.4,
          source: 'civitai',
        },
        // Flux NSFW Models
        {
          id: 'flux-dev-nsfw',
          name: 'Flux.1-dev NSFW',
          description: 'Uncensored version of BlackForestLabs\' Flux.1-dev. High-quality image generation.',
          author: 'BlackForestLabs',
          baseModel: 'FLUX.1',
          type: 'image',
          size: 23.8,
          tags: ['flux', 'high-quality', 'nsfw', 'uncensored'],
          downloads: 150000,
          rating: 4.9,
          source: 'huggingface',
        },
        {
          id: 'flux-schnell-nsfw',
          name: 'Flux.1-schnell NSFW',
          description: 'Fast uncensored Flux model. Generate NSFW images quickly and efficiently.',
          author: 'BlackForestLabs',
          baseModel: 'FLUX.1',
          type: 'image',
          size: 23.8,
          tags: ['flux', 'fast', 'nsfw', 'uncensored'],
          downloads: 100000,
          rating: 4.7,
          source: 'huggingface',
        },
      ],
      audio: [
        // Audio generation models for NSFW content
        {
          id: 'audiogen-medium',
          name: 'AudioGen Medium',
          description: 'Text-to-audio generation model. Can create adult-themed sound effects and music.',
          author: 'Facebook',
          family: 'AudioGen',
          capability: 'audio',
          type: 'audio',
          variants: [
            { tag: 'medium', params: '1.5B', size: 3.0, vram: 4 },
          ],
          tags: ['audio', 'generation', 'nsfw-capable', 'sound-effects'],
          pulls: 50000,
          source: 'huggingface',
        },
      ],
      multimodal: [
        // Models that handle multiple modalities
        {
          id: 'gpt-4v-nsfw',
          name: 'GPT-4V (NSFW Fine-tune)',
          description: 'Vision-language model with NSFW capabilities. Understands and describes adult content.',
          author: 'OpenAI',
          family: 'GPT',
          capability: 'multimodal',
          type: 'multimodal',
          variants: [
            { tag: 'vision', params: 'GPT-4V', size: 0, vram: 8 }, // API-based
          ],
          tags: ['multimodal', 'vision', 'nsfw', 'api'],
          pulls: 0,
          source: 'api',
        },
      ],
    };

    return nsfwModels;
  }

  /**
   * Get hardware recommendations
   */
  getHardwareRecommendations(vramGB, ramGB) {
    const recommendations = {
      llm: [],
      vision: [],
      image: [],
    };

    // LLM recommendations
    const allLLMs = this.ollama.officialModels;
    for (const model of allLLMs) {
      const suitableVariants = model.variants.filter(v => v.vram <= vramGB);
      if (suitableVariants.length > 0) {
        recommendations.llm.push({
          ...model,
          recommendedVariant: suitableVariants[suitableVariants.length - 1], // Largest that fits
        });
      }
    }

    // Vision recommendations
    for (const model of this.ollama.visionModels) {
      const suitableVariants = model.variants.filter(v => v.vram <= vramGB);
      if (suitableVariants.length > 0) {
        recommendations.vision.push({
          ...model,
          recommendedVariant: suitableVariants[suitableVariants.length - 1],
        });
      }
    }

    // Image model recommendations
    if (vramGB >= 8) {
      recommendations.image = this.civitai.curatedModels.filter(m => 
        (m.baseModel === 'SDXL 1.0' && vramGB >= 10) ||
        (m.baseModel === 'SD 1.5' && vramGB >= 6) ||
        (m.baseModel === 'FLUX' && vramGB >= 16)
      );
    } else if (vramGB >= 6) {
      recommendations.image = this.civitai.curatedModels.filter(m => 
        m.baseModel === 'SD 1.5'
      );
    }

    return recommendations;
  }
}


// Singleton instance
let providersInstance = null;

function getModelProviders() {
  if (!providersInstance) {
    providersInstance = new ModelProvidersService();
  }
  return providersInstance;
}

module.exports = {
  OllamaLibraryProvider,
  CivitAIProvider,
  ModelProvidersService,
  getModelProviders,
};
