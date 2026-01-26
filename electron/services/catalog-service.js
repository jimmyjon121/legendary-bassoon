/**
 * CatalogService - Model discovery and catalog management
 * 
 * Features:
 * - TTL/ETag caching for API responses
 * - Discovery feed with trending/new models
 * - Model subscriptions (watch for updates)
 * - Installed model update detection
 * - Multi-provider aggregation
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

// Cache TTL settings (in milliseconds)
const CACHE_TTL = {
  catalog: 30 * 60 * 1000, // 30 minutes
  trending: 15 * 60 * 1000, // 15 minutes
  search: 5 * 60 * 1000, // 5 minutes
  modelDetails: 60 * 60 * 1000, // 1 hour
};

/**
 * In-memory cache with TTL and ETag support
 */
class CacheStore {
  constructor() {
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry;
  }

  set(key, data, ttl, etag = null) {
    this.cache.set(key, {
      data,
      etag,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    });
  }

  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    let validEntries = 0;
    let expiredEntries = 0;
    const now = Date.now();
    
    for (const [, entry] of this.cache) {
      if (now > entry.expiresAt) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }
    
    return {
      total: this.cache.size,
      valid: validEntries,
      expired: expiredEntries,
    };
  }
}

/**
 * Model subscription for update tracking
 */
class Subscription {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.modelId = data.modelId;
    this.provider = data.provider;
    this.installedVersion = data.installedVersion;
    this.latestVersion = data.latestVersion || null;
    this.hasUpdate = false;
    this.lastChecked = null;
    this.autoUpdate = data.autoUpdate || false;
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      modelId: this.modelId,
      provider: this.provider,
      installedVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      hasUpdate: this.hasUpdate,
      lastChecked: this.lastChecked,
      autoUpdate: this.autoUpdate,
      createdAt: this.createdAt,
    };
  }
}

/**
 * CatalogService class
 */
class CatalogService extends EventEmitter {
  constructor() {
    super();
    this.cache = new CacheStore();
    this.subscriptions = new Map();
    this.providers = new Map();
    this.updateCheckInterval = null;
  }

  /**
   * Register a provider adapter
   */
  registerProvider(providerId, adapter) {
    this.providers.set(providerId, adapter);
  }

  /**
   * Get a registered provider
   */
  getProvider(providerId) {
    return this.providers.get(providerId);
  }

  /**
   * Search models across all providers
   */
  async search(query, options = {}) {
    const cacheKey = `search:${query}:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const results = {
      query,
      providers: {},
      models: [],
      total: 0,
    };
    
    const providerPromises = [];
    const targetProviders = options.providers || [...this.providers.keys()];
    
    for (const providerId of targetProviders) {
      const provider = this.providers.get(providerId);
      if (!provider || !provider.search) continue;
      
      providerPromises.push(
        provider.search(query, options)
          .then(models => ({ providerId, models }))
          .catch(error => ({ providerId, error: error.message, models: [] }))
      );
    }
    
    const providerResults = await Promise.all(providerPromises);
    
    for (const { providerId, models, error } of providerResults) {
      if (error) {
        results.providers[providerId] = { error, count: 0 };
      } else {
        results.providers[providerId] = { count: models.length };
        
        // Add provider info to each model
        for (const model of models) {
          results.models.push({
            ...model,
            provider: providerId,
          });
        }
      }
    }
    
    // Sort by relevance/downloads
    results.models.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    
    // Apply limit
    if (options.limit) {
      results.models = results.models.slice(0, options.limit);
    }
    
    results.total = results.models.length;
    
    this.cache.set(cacheKey, results, CACHE_TTL.search);
    
    return results;
  }

  /**
   * Get trending models
   */
  async getTrending(options = {}) {
    const cacheKey = `trending:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const results = {
      models: [],
      providers: {},
    };
    
    const providerPromises = [];
    
    for (const [providerId, provider] of this.providers) {
      if (!provider.getTrending) continue;
      
      providerPromises.push(
        provider.getTrending(options.limit || 10)
          .then(models => ({ providerId, models }))
          .catch(error => ({ providerId, error: error.message, models: [] }))
      );
    }
    
    const providerResults = await Promise.all(providerPromises);
    
    for (const { providerId, models, error } of providerResults) {
      if (!error) {
        for (const model of models) {
          results.models.push({
            ...model,
            provider: providerId,
          });
        }
      }
    }
    
    // Sort by trending score
    results.models.sort((a, b) => (b.trendingScore || b.downloads || 0) - (a.trendingScore || a.downloads || 0));
    
    if (options.limit) {
      results.models = results.models.slice(0, options.limit);
    }
    
    this.cache.set(cacheKey, results, CACHE_TTL.trending);
    
    return results;
  }

  /**
   * Get recently updated models
   */
  async getRecent(options = {}) {
    const cacheKey = `recent:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const results = {
      models: [],
    };
    
    const providerPromises = [];
    
    for (const [providerId, provider] of this.providers) {
      if (!provider.getRecent) continue;
      
      providerPromises.push(
        provider.getRecent(options.limit || 20)
          .then(models => ({ providerId, models }))
          .catch(() => ({ providerId, models: [] }))
      );
    }
    
    const providerResults = await Promise.all(providerPromises);
    
    for (const { providerId, models } of providerResults) {
      for (const model of models) {
        results.models.push({
          ...model,
          provider: providerId,
        });
      }
    }
    
    // Sort by update date
    results.models.sort((a, b) => 
      new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    );
    
    if (options.limit) {
      results.models = results.models.slice(0, options.limit);
    }
    
    this.cache.set(cacheKey, results, CACHE_TTL.trending);
    
    return results;
  }

  /**
   * Get model details
   */
  async getModelDetails(provider, modelId) {
    const cacheKey = `details:${provider}:${modelId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const providerAdapter = this.providers.get(provider);
    if (!providerAdapter || !providerAdapter.getModelDetails) {
      throw new Error(`Provider ${provider} not found or doesn't support model details`);
    }
    
    const details = await providerAdapter.getModelDetails(modelId);
    
    this.cache.set(cacheKey, details, CACHE_TTL.modelDetails);
    
    return details;
  }

  /**
   * Get model files
   */
  async getModelFiles(provider, modelId) {
    const cacheKey = `files:${provider}:${modelId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const providerAdapter = this.providers.get(provider);
    if (!providerAdapter || !providerAdapter.getModelFiles) {
      throw new Error(`Provider ${provider} not found or doesn't support model files`);
    }
    
    const files = await providerAdapter.getModelFiles(modelId);
    
    this.cache.set(cacheKey, files, CACHE_TTL.modelDetails);
    
    return files;
  }

  /**
   * Subscribe to model updates
   */
  subscribe(modelId, provider, installedVersion, options = {}) {
    const subscription = new Subscription({
      modelId,
      provider,
      installedVersion,
      autoUpdate: options.autoUpdate || false,
    });
    
    this.subscriptions.set(subscription.id, subscription);
    this.emit('subscription:added', subscription.toJSON());
    
    return subscription.id;
  }

  /**
   * Unsubscribe from model updates
   */
  unsubscribe(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.subscriptions.delete(subscriptionId);
      this.emit('subscription:removed', subscription.toJSON());
      return true;
    }
    return false;
  }

  /**
   * Get all subscriptions
   */
  getSubscriptions() {
    return Array.from(this.subscriptions.values()).map(s => s.toJSON());
  }

  /**
   * Check for updates on subscribed models
   */
  async checkUpdates() {
    const updates = [];
    
    for (const [, subscription] of this.subscriptions) {
      try {
        const provider = this.providers.get(subscription.provider);
        if (!provider || !provider.getLatestVersion) continue;
        
        const latestVersion = await provider.getLatestVersion(subscription.modelId);
        subscription.lastChecked = new Date().toISOString();
        
        if (latestVersion && latestVersion !== subscription.installedVersion) {
          subscription.latestVersion = latestVersion;
          subscription.hasUpdate = true;
          
          updates.push({
            subscription: subscription.toJSON(),
            currentVersion: subscription.installedVersion,
            latestVersion,
          });
          
          this.emit('subscription:update-available', {
            subscription: subscription.toJSON(),
            latestVersion,
          });
        }
      } catch (error) {
        console.error(`[CatalogService] Update check failed for ${subscription.modelId}:`, error);
      }
    }
    
    return updates;
  }

  /**
   * Start automatic update checking
   */
  startUpdateChecking(intervalMs = 60 * 60 * 1000) { // Default: 1 hour
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }
    
    this.updateCheckInterval = setInterval(() => {
      this.checkUpdates().catch(error => {
        console.error('[CatalogService] Automatic update check failed:', error);
      });
    }, intervalMs);
    
    // Run immediately
    this.checkUpdates().catch(() => {});
  }

  /**
   * Stop automatic update checking
   */
  stopUpdateChecking() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * Get discovery feed (curated mix of trending, new, and recommended)
   */
  async getDiscoveryFeed(options = {}) {
    const cacheKey = `discovery:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const [trending, recent] = await Promise.all([
      this.getTrending({ limit: 10 }),
      this.getRecent({ limit: 10 }),
    ]);
    
    const feed = {
      sections: [
        {
          id: 'trending',
          title: 'Trending Models',
          models: trending.models.slice(0, 5),
        },
        {
          id: 'recent',
          title: 'Recently Updated',
          models: recent.models.slice(0, 5),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    
    // Add provider-specific sections
    for (const [providerId, provider] of this.providers) {
      if (provider.getFeatured) {
        try {
          const featured = await provider.getFeatured(5);
          if (featured.length > 0) {
            feed.sections.push({
              id: `featured-${providerId}`,
              title: `Featured from ${providerId}`,
              models: featured.map(m => ({ ...m, provider: providerId })),
            });
          }
        } catch (error) {
          // Skip this provider
        }
      }
    }
    
    this.cache.set(cacheKey, feed, CACHE_TTL.trending);
    
    return feed;
  }

  /**
   * Get categories across all providers
   */
  async getCategories() {
    const cacheKey = 'categories:all';
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached.data;
    }
    
    const categories = new Set();
    const categoriesByProvider = {};
    
    for (const [providerId, provider] of this.providers) {
      if (!provider.getCategories) continue;
      
      try {
        const providerCategories = await provider.getCategories();
        categoriesByProvider[providerId] = providerCategories;
        
        for (const cat of providerCategories) {
          categories.add(cat.id || cat.name);
        }
      } catch (error) {
        // Skip
      }
    }
    
    const result = {
      all: Array.from(categories),
      byProvider: categoriesByProvider,
    };
    
    this.cache.set(cacheKey, result, CACHE_TTL.catalog);
    
    return result;
  }

  /**
   * Clear all caches
   */
  clearCache(pattern = null) {
    if (pattern) {
      this.cache.invalidate(pattern);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Save subscriptions to disk
   */
  async saveSubscriptions(filePath) {
    const data = Array.from(this.subscriptions.values()).map(s => s.toJSON());
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load subscriptions from disk
   */
  async loadSubscriptions(filePath) {
    try {
      const data = await fsPromises.readFile(filePath, 'utf-8');
      const subscriptions = JSON.parse(data);
      
      this.subscriptions.clear();
      for (const sub of subscriptions) {
        const subscription = new Subscription(sub);
        this.subscriptions.set(subscription.id, subscription);
      }
      
      return true;
    } catch (error) {
      // File doesn't exist or is invalid
      return false;
    }
  }
}

// Singleton
let catalogInstance = null;

function getCatalogService() {
  if (!catalogInstance) {
    catalogInstance = new CatalogService();
  }
  return catalogInstance;
}

module.exports = {
  CatalogService,
  getCatalogService,
  CacheStore,
  Subscription,
  CACHE_TTL,
};



