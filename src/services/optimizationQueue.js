/**
 * Optimization Queue Service (Renderer)
 * 
 * Manages the queue of background optimization suggestions
 * and coordinates with the main process optimizer.
 */

// Optimization types
const OPTIMIZATION_TYPES = {
  EXTRACT_DUPLICATE: {
    id: 'extract_duplicate',
    name: 'Extract Duplicate Code',
    description: 'Similar code found in multiple locations',
    icon: '📦',
    autoApply: false,
    riskLevel: 'medium'
  },
  MODERNIZE_SYNTAX: {
    id: 'modernize_syntax',
    name: 'Modernize Syntax',
    description: 'Update to modern JavaScript/TypeScript patterns',
    icon: '✨',
    autoApply: true,
    riskLevel: 'low'
  },
  ADD_TYPES: {
    id: 'add_types',
    name: 'Add TypeScript Types',
    description: 'Add missing type annotations',
    icon: '🔷',
    autoApply: true,
    riskLevel: 'low'
  },
  OPTIMIZE_IMPORTS: {
    id: 'optimize_imports',
    name: 'Optimize Imports',
    description: 'Remove unused imports, sort, and organize',
    icon: '📥',
    autoApply: true,
    riskLevel: 'low'
  },
  SIMPLIFY_LOGIC: {
    id: 'simplify_logic',
    name: 'Simplify Logic',
    description: 'Reduce complexity or improve readability',
    icon: '🎯',
    autoApply: false,
    riskLevel: 'medium'
  },
  FIX_LINT: {
    id: 'fix_lint',
    name: 'Fix Lint Issues',
    description: 'Auto-fixable linting problems',
    icon: '🧹',
    autoApply: true,
    riskLevel: 'low'
  },
  IMPROVE_PERFORMANCE: {
    id: 'improve_performance',
    name: 'Improve Performance',
    description: 'Optimization opportunities detected',
    icon: '⚡',
    autoApply: false,
    riskLevel: 'medium'
  },
  UPDATE_DEPRECATED: {
    id: 'update_deprecated',
    name: 'Update Deprecated API',
    description: 'Replace deprecated APIs with modern alternatives',
    icon: '🔄',
    autoApply: false,
    riskLevel: 'medium'
  }
};

// Queue item status
const STATUS = {
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  READY: 'ready',
  APPLYING: 'applying',
  APPLIED: 'applied',
  SKIPPED: 'skipped',
  FAILED: 'failed'
};

class OptimizationQueue {
  constructor() {
    this.queue = [];
    this.applied = [];
    this.skipped = [];
    this.listeners = new Set();
    this.isProcessing = false;
    this.settings = {
      autoApplyLowRisk: false,
      notifyOnReady: true,
      maxQueueSize: 50,
      batchSize: 10
    };
  }

  /**
   * Add an optimization to the queue
   */
  addOptimization(optimization) {
    const type = OPTIMIZATION_TYPES[optimization.type] || OPTIMIZATION_TYPES.SIMPLIFY_LOGIC;
    
    const item = {
      id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...optimization,
      typeInfo: type,
      status: STATUS.QUEUED,
      createdAt: Date.now(),
      priority: this.calculatePriority(optimization, type)
    };

    // Check for duplicates
    const exists = this.queue.find(q => 
      q.file === item.file && 
      q.type === item.type &&
      q.location === item.location
    );
    
    if (!exists) {
      this.queue.push(item);
      this.sortQueue();
      this.trimQueue();
      this.notifyListeners();
    }

    return item;
  }

  /**
   * Calculate priority (higher = more important)
   */
  calculatePriority(optimization, type) {
    let priority = 50; // Base priority

    // Risk level affects priority
    if (type.riskLevel === 'low') priority += 20;
    if (type.riskLevel === 'medium') priority += 10;
    if (type.riskLevel === 'high') priority -= 10;

    // Auto-apply items get lower priority (less review needed)
    if (type.autoApply) priority -= 5;

    // Size of change
    if (optimization.linesChanged) {
      if (optimization.linesChanged < 5) priority += 10;
      else if (optimization.linesChanged > 50) priority -= 10;
    }

    // File importance
    if (optimization.file?.includes('test')) priority -= 10;
    if (optimization.file?.includes('index')) priority += 5;

    return priority;
  }

  /**
   * Sort queue by priority
   */
  sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Trim queue to max size
   */
  trimQueue() {
    if (this.queue.length > this.settings.maxQueueSize) {
      const removed = this.queue.splice(this.settings.maxQueueSize);
      removed.forEach(item => {
        this.skipped.push({ ...item, status: STATUS.SKIPPED, reason: 'Queue overflow' });
      });
    }
  }

  /**
   * Get queued items
   */
  getQueue() {
    return [...this.queue];
  }

  /**
   * Get ready items (analyzed and safe to apply)
   */
  getReadyItems() {
    return this.queue.filter(item => item.status === STATUS.READY);
  }

  /**
   * Get item by ID
   */
  getItem(itemId) {
    return this.queue.find(item => item.id === itemId);
  }

  /**
   * Update item status
   */
  updateStatus(itemId, status, details = {}) {
    const item = this.queue.find(i => i.id === itemId);
    if (item) {
      item.status = status;
      item.updatedAt = Date.now();
      Object.assign(item, details);
      this.notifyListeners();
    }
  }

  /**
   * Mark item as ready (analyzed)
   */
  markReady(itemId, analysisResult) {
    this.updateStatus(itemId, STATUS.READY, {
      analysis: analysisResult,
      readyAt: Date.now()
    });
  }

  /**
   * Apply an optimization
   */
  async applyOptimization(itemId, applyFn) {
    const item = this.queue.find(i => i.id === itemId);
    if (!item) return null;

    this.updateStatus(itemId, STATUS.APPLYING);

    try {
      const result = await applyFn(item);
      
      // Move to applied
      this.queue = this.queue.filter(i => i.id !== itemId);
      this.applied.push({
        ...item,
        status: STATUS.APPLIED,
        appliedAt: Date.now(),
        result
      });

      this.notifyListeners();
      return result;
    } catch (error) {
      this.updateStatus(itemId, STATUS.FAILED, { error: error.message });
      return null;
    }
  }

  /**
   * Skip an optimization
   */
  skipOptimization(itemId, reason = '') {
    const item = this.queue.find(i => i.id === itemId);
    if (!item) return;

    this.queue = this.queue.filter(i => i.id !== itemId);
    this.skipped.push({
      ...item,
      status: STATUS.SKIPPED,
      skippedAt: Date.now(),
      reason
    });

    this.notifyListeners();
  }

  /**
   * Apply all low-risk optimizations
   */
  async applyAllLowRisk(applyFn) {
    const lowRiskItems = this.queue.filter(
      item => item.status === STATUS.READY && 
              item.typeInfo.riskLevel === 'low'
    );

    const results = [];
    for (const item of lowRiskItems) {
      const result = await this.applyOptimization(item.id, applyFn);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const byType = {};
    const byStatus = {};

    for (const item of this.queue) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    }

    return {
      queued: this.queue.length,
      ready: this.getReadyItems().length,
      applied: this.applied.length,
      skipped: this.skipped.length,
      byType,
      byStatus,
      potentialSavings: this.calculatePotentialSavings()
    };
  }

  /**
   * Calculate potential savings
   */
  calculatePotentialSavings() {
    let linesRemovable = 0;
    let filesAffected = new Set();

    for (const item of this.queue) {
      if (item.linesRemovable) linesRemovable += item.linesRemovable;
      if (item.file) filesAffected.add(item.file);
    }

    return {
      linesRemovable,
      filesAffected: filesAffected.size
    };
  }

  /**
   * Clear queue
   */
  clearQueue() {
    this.queue = [];
    this.notifyListeners();
  }

  /**
   * Clear applied history
   */
  clearApplied() {
    this.applied = [];
    this.notifyListeners();
  }

  /**
   * Export queue state
   */
  exportState() {
    return {
      queue: this.queue,
      applied: this.applied,
      skipped: this.skipped,
      settings: this.settings
    };
  }

  /**
   * Import queue state
   */
  importState(state) {
    if (state.queue) this.queue = state.queue;
    if (state.applied) this.applied = state.applied;
    if (state.skipped) this.skipped = state.skipped;
    if (state.settings) this.settings = { ...this.settings, ...state.settings };
    this.notifyListeners();
  }

  /**
   * Update settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      queue: this.queue,
      statistics: this.getStatistics(),
      settings: this.settings
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Optimization queue listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getOptimizationQueue() {
  if (!instance) {
    instance = new OptimizationQueue();
  }
  return instance;
}

export { OPTIMIZATION_TYPES, STATUS };
export default OptimizationQueue;
