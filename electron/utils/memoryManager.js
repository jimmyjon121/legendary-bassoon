/**
 * Memory Manager - Optimizes memory usage across the application
 * Implements LRU cache, cleanup routines, and memory pressure detection
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

/**
 * LRU (Least Recently Used) Cache implementation
 */
class LRUCache {
  constructor(maxSize = 100, maxMemoryMB = 256) {
    this.maxSize = maxSize;
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    this.cache = new Map();
    this.accessOrder = [];
    this.currentMemory = 0;
  }

  /**
   * Estimate memory size of a value
   */
  estimateSize(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (Buffer.isBuffer(value)) return value.length;
    if (Array.isArray(value)) {
      return value.reduce((acc, item) => acc + this.estimateSize(item), 0);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value).length * 2;
    }
    return 64; // Default estimate
  }

  /**
   * Get a value from cache
   */
  get(key) {
    if (!this.cache.has(key)) return undefined;
    
    // Move to front of access order
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.push(key);
    }
    
    return this.cache.get(key).value;
  }

  /**
   * Set a value in cache
   */
  set(key, value, ttlMs = null) {
    const size = this.estimateSize(value);
    
    // Evict items if necessary
    while (
      (this.cache.size >= this.maxSize || this.currentMemory + size > this.maxMemoryBytes) &&
      this.accessOrder.length > 0
    ) {
      this.evictOldest();
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key);
      this.currentMemory -= existing.size;
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);
    }

    // Add new entry
    const entry = {
      value,
      size,
      timestamp: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : null
    };

    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.currentMemory += size;

    return true;
  }

  /**
   * Delete a value from cache
   */
  delete(key) {
    if (!this.cache.has(key)) return false;
    
    const entry = this.cache.get(key);
    this.currentMemory -= entry.size;
    this.cache.delete(key);
    
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) this.accessOrder.splice(idx, 1);
    
    return true;
  }

  /**
   * Evict the oldest (least recently used) item
   */
  evictOldest() {
    if (this.accessOrder.length === 0) return;
    
    const key = this.accessOrder.shift();
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      this.currentMemory -= entry.size;
      this.cache.delete(key);
    }
  }

  /**
   * Clear expired items
   */
  clearExpired() {
    const now = Date.now();
    const expired = [];
    
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && entry.expiresAt < now) {
        expired.push(key);
      }
    }
    
    expired.forEach(key => this.delete(key));
    return expired.length;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsed: this.currentMemory,
      maxMemory: this.maxMemoryBytes,
      memoryUsedMB: (this.currentMemory / 1024 / 1024).toFixed(2),
      utilizationPercent: ((this.cache.size / this.maxSize) * 100).toFixed(1)
    };
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
    this.currentMemory = 0;
  }
}

/**
 * Memory Manager singleton
 */
class MemoryManager {
  constructor() {
    this.caches = new Map();
    this.cleanupCallbacks = [];
    this.memoryThresholdMB = 512; // Start cleanup when app uses > 512MB
    this.checkIntervalMs = 30000; // Check every 30 seconds
    this.isMonitoring = false;
    this.lastCleanup = Date.now();
    this.stats = {
      cleanupCount: 0,
      itemsEvicted: 0,
      memoryFreed: 0
    };
  }

  /**
   * Get or create a named cache
   */
  getCache(name, options = {}) {
    if (!this.caches.has(name)) {
      const { maxSize = 100, maxMemoryMB = 64 } = options;
      this.caches.set(name, new LRUCache(maxSize, maxMemoryMB));
    }
    return this.caches.get(name);
  }

  /**
   * Register a cleanup callback
   */
  onCleanup(callback) {
    this.cleanupCallbacks.push(callback);
  }

  /**
   * Start memory monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.monitorInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, this.checkIntervalMs);

    // Also check on app events
    app.on('browser-window-blur', () => this.onWindowBlur());
    
    console.log('[MemoryManager] Monitoring started');
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    console.log('[MemoryManager] Monitoring stopped');
  }

  /**
   * Handle window blur (user switched away)
   */
  onWindowBlur() {
    // Delay cleanup to avoid interrupting quick app switches
    setTimeout(() => {
      if (!app.isReady()) return;
      const windows = require('electron').BrowserWindow.getAllWindows();
      const anyFocused = windows.some(w => w.isFocused());
      
      if (!anyFocused) {
        this.performLightCleanup();
      }
    }, 5000);
  }

  /**
   * Check current memory pressure
   */
  checkMemoryPressure() {
    const memInfo = process.memoryUsage();
    const heapUsedMB = memInfo.heapUsed / 1024 / 1024;
    const rssMB = memInfo.rss / 1024 / 1024;

    if (rssMB > this.memoryThresholdMB) {
      console.log(`[MemoryManager] High memory usage detected: ${rssMB.toFixed(0)}MB`);
      this.performCleanup('high_pressure');
    } else if (rssMB > this.memoryThresholdMB * 0.75) {
      this.performLightCleanup();
    }

    return {
      heapUsedMB: heapUsedMB.toFixed(2),
      rssMB: rssMB.toFixed(2),
      thresholdMB: this.memoryThresholdMB,
      pressure: rssMB > this.memoryThresholdMB ? 'high' : 
                rssMB > this.memoryThresholdMB * 0.75 ? 'medium' : 'low'
    };
  }

  /**
   * Perform light cleanup (expired items only)
   */
  performLightCleanup() {
    let itemsCleared = 0;
    
    for (const [name, cache] of this.caches) {
      itemsCleared += cache.clearExpired();
    }

    if (itemsCleared > 0) {
      console.log(`[MemoryManager] Light cleanup: ${itemsCleared} expired items`);
    }

    return itemsCleared;
  }

  /**
   * Perform full cleanup
   */
  async performCleanup(reason = 'manual') {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().rss;
    let itemsEvicted = 0;

    console.log(`[MemoryManager] Starting cleanup (reason: ${reason})`);

    // Clear expired items from all caches
    for (const [name, cache] of this.caches) {
      itemsEvicted += cache.clearExpired();
      
      // If high pressure, also evict 25% of each cache
      if (reason === 'high_pressure') {
        const toEvict = Math.floor(cache.cache.size * 0.25);
        for (let i = 0; i < toEvict; i++) {
          cache.evictOldest();
          itemsEvicted++;
        }
      }
    }

    // Run registered cleanup callbacks
    for (const callback of this.cleanupCallbacks) {
      try {
        await callback(reason);
      } catch (e) {
        console.error('[MemoryManager] Cleanup callback error:', e);
      }
    }

    // Clean temp files older than 1 hour
    await this.cleanTempFiles(3600000);

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().rss;
    const freedMB = (initialMemory - finalMemory) / 1024 / 1024;
    const duration = Date.now() - startTime;

    this.stats.cleanupCount++;
    this.stats.itemsEvicted += itemsEvicted;
    this.stats.memoryFreed += Math.max(0, freedMB);
    this.lastCleanup = Date.now();

    console.log(`[MemoryManager] Cleanup complete in ${duration}ms, freed ${freedMB.toFixed(1)}MB`);

    return {
      itemsEvicted,
      freedMB: freedMB.toFixed(2),
      duration
    };
  }

  /**
   * Clean temporary files
   */
  async cleanTempFiles(maxAgeMs = 3600000) {
    const tempDir = path.join(app.getPath('userData'), 'temp');
    
    try {
      const files = await fs.readdir(tempDir);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.unlink(filePath);
            deleted++;
          }
        } catch (e) {
          // File may have been deleted already
        }
      }

      if (deleted > 0) {
        console.log(`[MemoryManager] Cleaned ${deleted} temp files`);
      }
      return deleted;
    } catch (e) {
      // Temp directory may not exist
      return 0;
    }
  }

  /**
   * Get overall memory statistics
   */
  getStats() {
    const memInfo = process.memoryUsage();
    const cacheStats = {};
    
    for (const [name, cache] of this.caches) {
      cacheStats[name] = cache.getStats();
    }

    return {
      process: {
        heapUsedMB: (memInfo.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (memInfo.heapTotal / 1024 / 1024).toFixed(2),
        rssMB: (memInfo.rss / 1024 / 1024).toFixed(2),
        externalMB: (memInfo.external / 1024 / 1024).toFixed(2),
      },
      caches: cacheStats,
      manager: {
        cleanupCount: this.stats.cleanupCount,
        itemsEvicted: this.stats.itemsEvicted,
        memoryFreedMB: this.stats.memoryFreed.toFixed(2),
        lastCleanup: new Date(this.lastCleanup).toISOString(),
        isMonitoring: this.isMonitoring
      }
    };
  }

  /**
   * Clear all caches
   */
  clearAll() {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    console.log('[MemoryManager] All caches cleared');
  }
}

// Singleton instance
const memoryManager = new MemoryManager();

module.exports = {
  memoryManager,
  MemoryManager,
  LRUCache,
};






