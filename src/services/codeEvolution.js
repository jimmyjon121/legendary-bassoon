/**
 * Code Evolution Tracker
 * 
 * Tracks code complexity and health metrics over time to identify
 * technical debt accumulation and suggest preventive refactoring.
 */

// Metrics tracked
const EVOLUTION_METRICS = {
  complexity: {
    name: 'Cyclomatic Complexity',
    description: 'Number of independent paths through code',
    thresholds: { good: 10, warning: 20, critical: 30 }
  },
  lines: {
    name: 'Lines of Code',
    description: 'Total lines including comments',
    thresholds: { good: 200, warning: 400, critical: 800 }
  },
  functions: {
    name: 'Function Count',
    description: 'Number of functions/methods',
    thresholds: { good: 10, warning: 20, critical: 40 }
  },
  dependencies: {
    name: 'Import Count',
    description: 'Number of imports/dependencies',
    thresholds: { good: 10, warning: 20, critical: 30 }
  },
  nesting: {
    name: 'Max Nesting Depth',
    description: 'Deepest nesting level',
    thresholds: { good: 3, warning: 5, critical: 7 }
  },
  comments: {
    name: 'Comment Ratio',
    description: 'Percentage of comment lines',
    thresholds: { good: 0.1, warning: 0.05, critical: 0.02 }
  }
};

// Health status
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  ATTENTION: 'attention',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

// Trend direction
const TREND = {
  IMPROVING: 'improving',
  STABLE: 'stable',
  DECLINING: 'declining'
};

class CodeEvolution {
  constructor() {
    this.fileHistory = new Map();  // path -> { snapshots: [], events: [] }
    this.globalMetrics = {
      totalFiles: 0,
      totalLines: 0,
      avgComplexity: 0,
      healthScore: 100
    };
    this.listeners = new Set();
  }

  /**
   * Analyze a file and record metrics
   */
  analyzeFile(filePath, content, metadata = {}) {
    const metrics = this.calculateMetrics(content);
    const snapshot = {
      timestamp: Date.now(),
      metrics,
      metadata: {
        ...metadata,
        commitHash: metadata.commitHash || null,
        author: metadata.author || null
      }
    };

    // Get or create file history
    let history = this.fileHistory.get(filePath);
    if (!history) {
      history = { snapshots: [], events: [] };
      this.fileHistory.set(filePath, history);
    }

    // Check for significant changes
    const previousSnapshot = history.snapshots[history.snapshots.length - 1];
    if (previousSnapshot) {
      const events = this.detectEvents(previousSnapshot, snapshot);
      history.events.push(...events);
    }

    // Add snapshot
    history.snapshots.push(snapshot);
    
    // Trim old snapshots (keep last 100)
    if (history.snapshots.length > 100) {
      history.snapshots = history.snapshots.slice(-100);
    }

    this.updateGlobalMetrics();
    this.notifyListeners();

    return { snapshot, health: this.getFileHealth(filePath) };
  }

  /**
   * Calculate metrics for file content
   */
  calculateMetrics(content) {
    const lines = content.split('\n');
    const metrics = {};

    // Lines of code
    metrics.lines = lines.length;
    
    // Non-empty lines
    metrics.codeLines = lines.filter(l => l.trim().length > 0).length;
    
    // Comment lines
    const commentLines = lines.filter(l => {
      const trimmed = l.trim();
      return trimmed.startsWith('//') || 
             trimmed.startsWith('/*') || 
             trimmed.startsWith('*') ||
             trimmed.startsWith('#');
    }).length;
    metrics.commentLines = commentLines;
    metrics.commentRatio = metrics.codeLines > 0 ? commentLines / metrics.codeLines : 0;

    // Function count
    const functionPatterns = [
      /function\s+\w+/g,
      /\w+\s*:\s*function/g,
      /\w+\s*=\s*\([^)]*\)\s*=>/g,
      /\w+\s*=\s*async\s*\([^)]*\)\s*=>/g,
      /async\s+function/g,
      /^\s*(get|set)\s+\w+/gm
    ];
    let functionCount = 0;
    functionPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) functionCount += matches.length;
    });
    metrics.functions = functionCount;

    // Import/dependency count
    const importPatterns = [
      /import\s+.*from/g,
      /require\s*\(/g,
      /from\s+['"][^'"]+['"]/g
    ];
    let importCount = 0;
    importPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) importCount += matches.length;
    });
    metrics.dependencies = importCount;

    // Cyclomatic complexity (simplified)
    const complexityKeywords = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\?\s*[^:]+\s*:/g,  // Ternary
      /&&/g,
      /\|\|/g,
      /\?\./g  // Optional chaining
    ];
    let complexity = 1; // Base complexity
    complexityKeywords.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) complexity += matches.length;
    });
    metrics.complexity = complexity;

    // Max nesting depth
    let maxNesting = 0;
    let currentNesting = 0;
    for (const char of content) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting--;
      }
    }
    metrics.nesting = maxNesting;

    // Calculate overall score (0-100)
    metrics.healthScore = this.calculateHealthScore(metrics);

    return metrics;
  }

  /**
   * Calculate health score from metrics
   */
  calculateHealthScore(metrics) {
    let score = 100;
    
    // Deduct for complexity
    if (metrics.complexity > EVOLUTION_METRICS.complexity.thresholds.critical) {
      score -= 30;
    } else if (metrics.complexity > EVOLUTION_METRICS.complexity.thresholds.warning) {
      score -= 15;
    } else if (metrics.complexity > EVOLUTION_METRICS.complexity.thresholds.good) {
      score -= 5;
    }

    // Deduct for file length
    if (metrics.lines > EVOLUTION_METRICS.lines.thresholds.critical) {
      score -= 20;
    } else if (metrics.lines > EVOLUTION_METRICS.lines.thresholds.warning) {
      score -= 10;
    }

    // Deduct for nesting
    if (metrics.nesting > EVOLUTION_METRICS.nesting.thresholds.critical) {
      score -= 20;
    } else if (metrics.nesting > EVOLUTION_METRICS.nesting.thresholds.warning) {
      score -= 10;
    }

    // Deduct for too many functions
    if (metrics.functions > EVOLUTION_METRICS.functions.thresholds.critical) {
      score -= 15;
    } else if (metrics.functions > EVOLUTION_METRICS.functions.thresholds.warning) {
      score -= 7;
    }

    // Bonus for good comment ratio
    if (metrics.commentRatio >= EVOLUTION_METRICS.comments.thresholds.good) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Detect significant events between snapshots
   */
  detectEvents(previousSnapshot, currentSnapshot) {
    const events = [];
    const prev = previousSnapshot.metrics;
    const curr = currentSnapshot.metrics;

    // Complexity increase
    if (curr.complexity > prev.complexity * 1.2) {
      events.push({
        type: 'complexity_increase',
        timestamp: currentSnapshot.timestamp,
        change: curr.complexity - prev.complexity,
        severity: curr.complexity > EVOLUTION_METRICS.complexity.thresholds.critical ? 'high' : 'medium',
        message: `Complexity increased from ${prev.complexity} to ${curr.complexity}`
      });
    }

    // File grew significantly
    if (curr.lines > prev.lines * 1.3 && curr.lines > 50) {
      events.push({
        type: 'file_growth',
        timestamp: currentSnapshot.timestamp,
        change: curr.lines - prev.lines,
        severity: curr.lines > EVOLUTION_METRICS.lines.thresholds.critical ? 'high' : 'low',
        message: `File grew from ${prev.lines} to ${curr.lines} lines`
      });
    }

    // Health declined
    if (curr.healthScore < prev.healthScore - 10) {
      events.push({
        type: 'health_decline',
        timestamp: currentSnapshot.timestamp,
        change: curr.healthScore - prev.healthScore,
        severity: curr.healthScore < 50 ? 'high' : 'medium',
        message: `Health score dropped from ${prev.healthScore} to ${curr.healthScore}`
      });
    }

    // Many new dependencies
    if (curr.dependencies > prev.dependencies + 3) {
      events.push({
        type: 'dependency_growth',
        timestamp: currentSnapshot.timestamp,
        change: curr.dependencies - prev.dependencies,
        severity: 'low',
        message: `Added ${curr.dependencies - prev.dependencies} new dependencies`
      });
    }

    return events;
  }

  /**
   * Get health status for a file
   */
  getFileHealth(filePath) {
    const history = this.fileHistory.get(filePath);
    if (!history || history.snapshots.length === 0) {
      return { status: HEALTH_STATUS.HEALTHY, score: 100, trend: TREND.STABLE };
    }

    const current = history.snapshots[history.snapshots.length - 1];
    const score = current.metrics.healthScore;

    // Determine status
    let status;
    if (score >= 80) status = HEALTH_STATUS.HEALTHY;
    else if (score >= 60) status = HEALTH_STATUS.ATTENTION;
    else if (score >= 40) status = HEALTH_STATUS.WARNING;
    else status = HEALTH_STATUS.CRITICAL;

    // Calculate trend
    let trend = TREND.STABLE;
    if (history.snapshots.length >= 3) {
      const recent = history.snapshots.slice(-3);
      const avgRecent = recent.reduce((s, r) => s + r.metrics.healthScore, 0) / 3;
      const older = history.snapshots.slice(-6, -3);
      if (older.length >= 3) {
        const avgOlder = older.reduce((s, r) => s + r.metrics.healthScore, 0) / 3;
        if (avgRecent > avgOlder + 5) trend = TREND.IMPROVING;
        else if (avgRecent < avgOlder - 5) trend = TREND.DECLINING;
      }
    }

    return {
      status,
      score,
      trend,
      metrics: current.metrics,
      recentEvents: history.events.slice(-5)
    };
  }

  /**
   * Get evolution timeline for a file
   */
  getFileTimeline(filePath) {
    const history = this.fileHistory.get(filePath);
    if (!history) return null;

    return {
      snapshots: history.snapshots.map(s => ({
        timestamp: s.timestamp,
        healthScore: s.metrics.healthScore,
        complexity: s.metrics.complexity,
        lines: s.metrics.lines,
        metadata: s.metadata
      })),
      events: history.events,
      currentHealth: this.getFileHealth(filePath)
    };
  }

  /**
   * Predict future health based on trends
   */
  predictHealth(filePath, monthsAhead = 3) {
    const timeline = this.getFileTimeline(filePath);
    if (!timeline || timeline.snapshots.length < 3) {
      return null;
    }

    // Calculate rate of change
    const snapshots = timeline.snapshots;
    const timeSpan = snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp;
    const scoreChange = snapshots[snapshots.length - 1].healthScore - snapshots[0].healthScore;
    
    if (timeSpan < 86400000) { // Less than a day of data
      return null;
    }

    const ratePerMonth = (scoreChange / timeSpan) * (30 * 24 * 60 * 60 * 1000);
    const predictedScore = Math.max(0, Math.min(100, 
      snapshots[snapshots.length - 1].healthScore + (ratePerMonth * monthsAhead)
    ));

    return {
      currentScore: snapshots[snapshots.length - 1].healthScore,
      predictedScore: Math.round(predictedScore),
      monthsAhead,
      trend: ratePerMonth > 0 ? 'improving' : ratePerMonth < 0 ? 'declining' : 'stable',
      warning: predictedScore < 50 ? 'File may become critical if trend continues' : null
    };
  }

  /**
   * Get refactoring suggestions for a file
   */
  getSuggestions(filePath) {
    const health = this.getFileHealth(filePath);
    if (!health || health.status === HEALTH_STATUS.HEALTHY) {
      return [];
    }

    const suggestions = [];
    const metrics = health.metrics;

    if (metrics.complexity > EVOLUTION_METRICS.complexity.thresholds.warning) {
      suggestions.push({
        type: 'reduce_complexity',
        priority: 'high',
        title: 'Reduce Cyclomatic Complexity',
        description: `Current complexity is ${metrics.complexity}. Consider breaking into smaller functions.`,
        impact: 'Easier testing and maintenance'
      });
    }

    if (metrics.lines > EVOLUTION_METRICS.lines.thresholds.warning) {
      suggestions.push({
        type: 'split_file',
        priority: 'medium',
        title: 'Consider Splitting File',
        description: `File has ${metrics.lines} lines. Consider extracting related functionality.`,
        impact: 'Better organization and reusability'
      });
    }

    if (metrics.nesting > EVOLUTION_METRICS.nesting.thresholds.warning) {
      suggestions.push({
        type: 'reduce_nesting',
        priority: 'medium',
        title: 'Reduce Nesting Depth',
        description: `Max nesting is ${metrics.nesting} levels. Use early returns or extract functions.`,
        impact: 'Improved readability'
      });
    }

    if (metrics.functions > EVOLUTION_METRICS.functions.thresholds.warning) {
      suggestions.push({
        type: 'extract_module',
        priority: 'low',
        title: 'Extract Functions to Module',
        description: `File has ${metrics.functions} functions. Group related functions into separate modules.`,
        impact: 'Better code organization'
      });
    }

    if (metrics.commentRatio < EVOLUTION_METRICS.comments.thresholds.critical) {
      suggestions.push({
        type: 'add_documentation',
        priority: 'low',
        title: 'Add Documentation',
        description: `Comment ratio is ${(metrics.commentRatio * 100).toFixed(1)}%. Consider adding JSDoc comments.`,
        impact: 'Easier onboarding and maintenance'
      });
    }

    return suggestions;
  }

  /**
   * Update global metrics across all files
   */
  updateGlobalMetrics() {
    let totalLines = 0;
    let totalComplexity = 0;
    let totalScore = 0;
    let fileCount = 0;

    for (const [_, history] of this.fileHistory) {
      if (history.snapshots.length > 0) {
        const latest = history.snapshots[history.snapshots.length - 1];
        totalLines += latest.metrics.lines;
        totalComplexity += latest.metrics.complexity;
        totalScore += latest.metrics.healthScore;
        fileCount++;
      }
    }

    this.globalMetrics = {
      totalFiles: fileCount,
      totalLines,
      avgComplexity: fileCount > 0 ? Math.round(totalComplexity / fileCount) : 0,
      healthScore: fileCount > 0 ? Math.round(totalScore / fileCount) : 100
    };
  }

  /**
   * Get global metrics
   */
  getGlobalMetrics() {
    return { ...this.globalMetrics };
  }

  /**
   * Get all tracked files
   */
  getTrackedFiles() {
    const files = [];
    for (const [path, history] of this.fileHistory) {
      if (history.snapshots.length > 0) {
        const health = this.getFileHealth(path);
        files.push({
          path,
          ...health,
          lastUpdated: history.snapshots[history.snapshots.length - 1].timestamp
        });
      }
    }
    return files.sort((a, b) => a.score - b.score); // Worst first
  }

  /**
   * Export history for persistence
   */
  exportHistory() {
    const data = {};
    for (const [path, history] of this.fileHistory) {
      data[path] = history;
    }
    return data;
  }

  /**
   * Import history from persistence
   */
  importHistory(data) {
    for (const [path, history] of Object.entries(data)) {
      this.fileHistory.set(path, history);
    }
    this.updateGlobalMetrics();
    this.notifyListeners();
  }

  /**
   * Clear all history
   */
  clear() {
    this.fileHistory.clear();
    this.globalMetrics = {
      totalFiles: 0,
      totalLines: 0,
      avgComplexity: 0,
      healthScore: 100
    };
    this.notifyListeners();
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
      globalMetrics: this.globalMetrics,
      trackedFiles: this.getTrackedFiles()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Code evolution listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getCodeEvolution() {
  if (!instance) {
    instance = new CodeEvolution();
  }
  return instance;
}

export { EVOLUTION_METRICS, HEALTH_STATUS, TREND };
export default CodeEvolution;
