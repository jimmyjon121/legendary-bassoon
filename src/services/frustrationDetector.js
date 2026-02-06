/**
 * Frustration Detection Service
 * 
 * Monitors developer behavior patterns to detect when they're stuck
 * and proactively offer assistance.
 */

// Frustration signal thresholds
const FRUSTRATION_SIGNALS = {
  rapidUndoRedo: { 
    threshold: 5, 
    window: 30000,      // 5 undo/redo in 30 seconds
    weight: 0.3,
    message: 'Rapid undo/redo detected'
  },
  cursorJumping: { 
    threshold: 10, 
    window: 60000,      // 10 jumps to same lines in 60 seconds
    weight: 0.2,
    message: 'Cursor jumping between same locations'
  },
  longPause: { 
    threshold: 300000,  // 5 minutes with no meaningful progress
    weight: 0.25,
    message: 'Extended pause with no progress'
  },
  deletionCycles: { 
    threshold: 3, 
    window: 120000,     // Delete/retype similar code 3 times in 2 minutes
    weight: 0.35,
    message: 'Repeated deletion and retyping cycles'
  },
  sameFileStuck: { 
    threshold: 1200000, // 20 minutes on same file with minimal changes
    minChanges: 50,     // Must have at least some activity
    weight: 0.15,
    message: 'Stuck on same file for extended period'
  },
  errorLoops: {
    threshold: 5,
    window: 300000,     // 5 similar errors in 5 minutes
    weight: 0.4,
    message: 'Repeated similar errors'
  }
};

// Help suggestions based on detected frustration type
const HELP_SUGGESTIONS = {
  rapidUndoRedo: [
    { id: 'explain', label: 'Explain what I\'m trying to do', icon: '🎯' },
    { id: 'alternatives', label: 'Show alternative approaches', icon: '🔀' },
    { id: 'step-back', label: 'Help me step back and think', icon: '🤔' }
  ],
  cursorJumping: [
    { id: 'find-connection', label: 'Help find the connection between these parts', icon: '🔗' },
    { id: 'visualize', label: 'Visualize the code flow', icon: '📊' },
    { id: 'explain-relationship', label: 'Explain how these relate', icon: '💡' }
  ],
  longPause: [
    { id: 'rubber-duck', label: 'Let me talk through this (rubber duck)', icon: '🦆' },
    { id: 'suggest-next', label: 'Suggest what to do next', icon: '➡️' },
    { id: 'break-down', label: 'Break this problem down', icon: '📋' }
  ],
  deletionCycles: [
    { id: 'show-examples', label: 'Show working examples', icon: '📝' },
    { id: 'explain-concept', label: 'Explain the underlying concept', icon: '🎓' },
    { id: 'different-approach', label: 'Try a completely different approach', icon: '🔄' }
  ],
  sameFileStuck: [
    { id: 'take-break', label: 'Remind me to take a break', icon: '☕' },
    { id: 'fresh-perspective', label: 'Get a fresh perspective', icon: '👀' },
    { id: 'simplify', label: 'Help simplify my approach', icon: '✂️' }
  ],
  errorLoops: [
    { id: 'debug-step', label: 'Debug this step by step', icon: '🐛' },
    { id: 'root-cause', label: 'Find the root cause', icon: '🔍' },
    { id: 'similar-solutions', label: 'Find similar solved issues', icon: '📚' }
  ],
  general: [
    { id: 'leave-alone', label: 'I\'ve got this, leave me alone', icon: '❌' }
  ]
};

class FrustrationDetector {
  constructor() {
    this.events = {
      undoRedo: [],
      cursorPositions: [],
      deletions: [],
      errors: [],
      fileActivity: new Map() // path -> { openedAt, lastChange, changeCount }
    };
    
    this.currentFrustration = {
      score: 0,
      signals: [],
      suggestions: [],
      lastChecked: Date.now(),
      dismissed: false,
      dismissedUntil: null
    };
    
    this.listeners = new Set();
    this.checkInterval = null;
    this.isEnabled = true;
    this.cooldownPeriod = 300000; // 5 minutes after dismissal
  }

  /**
   * Start monitoring for frustration signals
   */
  start() {
    if (this.checkInterval) return;
    
    this.checkInterval = setInterval(() => {
      if (this.isEnabled) {
        this.analyzeSignals();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Enable/disable frustration detection
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  /**
   * Record an undo or redo action
   */
  recordUndoRedo(type, filePath) {
    this.events.undoRedo.push({
      type,
      filePath,
      timestamp: Date.now()
    });
    this.pruneOldEvents('undoRedo', FRUSTRATION_SIGNALS.rapidUndoRedo.window);
  }

  /**
   * Record cursor position change
   */
  recordCursorPosition(filePath, line, column) {
    this.events.cursorPositions.push({
      filePath,
      line,
      column,
      timestamp: Date.now()
    });
    this.pruneOldEvents('cursorPositions', FRUSTRATION_SIGNALS.cursorJumping.window);
  }

  /**
   * Record a deletion event
   */
  recordDeletion(filePath, deletedText, line) {
    this.events.deletions.push({
      filePath,
      deletedText: deletedText.substring(0, 100), // Truncate for memory
      textHash: this.hashText(deletedText),
      line,
      timestamp: Date.now()
    });
    this.pruneOldEvents('deletions', FRUSTRATION_SIGNALS.deletionCycles.window);
  }

  /**
   * Record an error occurrence
   */
  recordError(filePath, errorMessage, line) {
    this.events.errors.push({
      filePath,
      errorMessage: errorMessage.substring(0, 200),
      errorHash: this.hashText(errorMessage),
      line,
      timestamp: Date.now()
    });
    this.pruneOldEvents('errors', FRUSTRATION_SIGNALS.errorLoops.window);
  }

  /**
   * Record file activity
   */
  recordFileActivity(filePath, changeType = 'edit') {
    const now = Date.now();
    const activity = this.events.fileActivity.get(filePath) || {
      openedAt: now,
      lastChange: now,
      changeCount: 0
    };
    
    activity.lastChange = now;
    activity.changeCount++;
    this.events.fileActivity.set(filePath, activity);
  }

  /**
   * Record when a file is opened
   */
  recordFileOpen(filePath) {
    this.events.fileActivity.set(filePath, {
      openedAt: Date.now(),
      lastChange: Date.now(),
      changeCount: 0
    });
  }

  /**
   * Simple hash function for comparing similar text
   */
  hashText(text) {
    if (!text) return 0;
    let hash = 0;
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    for (let i = 0; i < Math.min(normalized.length, 50); i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Remove events older than the window
   */
  pruneOldEvents(eventType, windowMs) {
    const cutoff = Date.now() - windowMs;
    this.events[eventType] = this.events[eventType].filter(e => e.timestamp > cutoff);
  }

  /**
   * Analyze all signals and calculate frustration score
   */
  analyzeSignals() {
    // Check if we're in cooldown after dismissal
    if (this.currentFrustration.dismissedUntil && 
        Date.now() < this.currentFrustration.dismissedUntil) {
      return;
    }

    const now = Date.now();
    const signals = [];
    let totalScore = 0;

    // Check rapid undo/redo
    const recentUndoRedo = this.events.undoRedo.filter(
      e => e.timestamp > now - FRUSTRATION_SIGNALS.rapidUndoRedo.window
    );
    if (recentUndoRedo.length >= FRUSTRATION_SIGNALS.rapidUndoRedo.threshold) {
      signals.push({
        type: 'rapidUndoRedo',
        count: recentUndoRedo.length,
        message: FRUSTRATION_SIGNALS.rapidUndoRedo.message
      });
      totalScore += FRUSTRATION_SIGNALS.rapidUndoRedo.weight;
    }

    // Check cursor jumping (same lines repeatedly)
    const cursorJumpScore = this.analyzeCursorJumping();
    if (cursorJumpScore > 0) {
      signals.push({
        type: 'cursorJumping',
        score: cursorJumpScore,
        message: FRUSTRATION_SIGNALS.cursorJumping.message
      });
      totalScore += FRUSTRATION_SIGNALS.cursorJumping.weight * cursorJumpScore;
    }

    // Check deletion cycles (similar content deleted multiple times)
    const deletionCycleScore = this.analyzeDeletionCycles();
    if (deletionCycleScore > 0) {
      signals.push({
        type: 'deletionCycles',
        score: deletionCycleScore,
        message: FRUSTRATION_SIGNALS.deletionCycles.message
      });
      totalScore += FRUSTRATION_SIGNALS.deletionCycles.weight * deletionCycleScore;
    }

    // Check error loops
    const errorLoopScore = this.analyzeErrorLoops();
    if (errorLoopScore > 0) {
      signals.push({
        type: 'errorLoops',
        score: errorLoopScore,
        message: FRUSTRATION_SIGNALS.errorLoops.message
      });
      totalScore += FRUSTRATION_SIGNALS.errorLoops.weight * errorLoopScore;
    }

    // Check same file stuck
    const stuckFileSignal = this.analyzeFileStuck();
    if (stuckFileSignal) {
      signals.push({
        type: 'sameFileStuck',
        file: stuckFileSignal.file,
        duration: stuckFileSignal.duration,
        message: FRUSTRATION_SIGNALS.sameFileStuck.message
      });
      totalScore += FRUSTRATION_SIGNALS.sameFileStuck.weight;
    }

    // Normalize score to 0-1
    totalScore = Math.min(1, totalScore);

    // Build suggestions based on detected signals
    const suggestions = this.buildSuggestions(signals);

    // Update current frustration state
    const previousScore = this.currentFrustration.score;
    this.currentFrustration = {
      score: totalScore,
      signals,
      suggestions,
      lastChecked: now,
      dismissed: false,
      dismissedUntil: null
    };

    // Notify listeners if frustration is detected
    if (totalScore >= 0.3 && totalScore > previousScore) {
      this.notifyListeners();
    }
  }

  /**
   * Analyze cursor jumping patterns
   */
  analyzeCursorJumping() {
    const positions = this.events.cursorPositions;
    if (positions.length < 5) return 0;

    // Group by file and line
    const lineVisits = new Map();
    positions.forEach(pos => {
      const key = `${pos.filePath}:${pos.line}`;
      lineVisits.set(key, (lineVisits.get(key) || 0) + 1);
    });

    // Find lines visited multiple times
    let maxVisits = 0;
    lineVisits.forEach(count => {
      if (count > maxVisits) maxVisits = count;
    });

    // Score based on repetition
    if (maxVisits >= FRUSTRATION_SIGNALS.cursorJumping.threshold) {
      return Math.min(1, maxVisits / (FRUSTRATION_SIGNALS.cursorJumping.threshold * 2));
    }
    return 0;
  }

  /**
   * Analyze deletion cycles (similar content deleted multiple times)
   */
  analyzeDeletionCycles() {
    const deletions = this.events.deletions;
    if (deletions.length < 3) return 0;

    // Group by text hash
    const hashCounts = new Map();
    deletions.forEach(del => {
      hashCounts.set(del.textHash, (hashCounts.get(del.textHash) || 0) + 1);
    });

    // Find similar deletions
    let maxRepeats = 0;
    hashCounts.forEach(count => {
      if (count > maxRepeats) maxRepeats = count;
    });

    if (maxRepeats >= FRUSTRATION_SIGNALS.deletionCycles.threshold) {
      return Math.min(1, maxRepeats / (FRUSTRATION_SIGNALS.deletionCycles.threshold * 2));
    }
    return 0;
  }

  /**
   * Analyze error loops
   */
  analyzeErrorLoops() {
    const errors = this.events.errors;
    if (errors.length < 3) return 0;

    // Group by error hash
    const hashCounts = new Map();
    errors.forEach(err => {
      hashCounts.set(err.errorHash, (hashCounts.get(err.errorHash) || 0) + 1);
    });

    let maxRepeats = 0;
    hashCounts.forEach(count => {
      if (count > maxRepeats) maxRepeats = count;
    });

    if (maxRepeats >= FRUSTRATION_SIGNALS.errorLoops.threshold) {
      return Math.min(1, maxRepeats / (FRUSTRATION_SIGNALS.errorLoops.threshold * 2));
    }
    return 0;
  }

  /**
   * Check if user is stuck on same file
   */
  analyzeFileStuck() {
    const now = Date.now();
    
    for (const [filePath, activity] of this.events.fileActivity.entries()) {
      const duration = now - activity.openedAt;
      
      if (duration >= FRUSTRATION_SIGNALS.sameFileStuck.threshold &&
          activity.changeCount >= FRUSTRATION_SIGNALS.sameFileStuck.minChanges) {
        // Check if there's been recent activity (not just abandoned)
        if (now - activity.lastChange < 60000) {
          return {
            file: filePath,
            duration,
            changeCount: activity.changeCount
          };
        }
      }
    }
    return null;
  }

  /**
   * Build help suggestions based on detected signals
   */
  buildSuggestions(signals) {
    const suggestions = [];
    const addedTypes = new Set();

    signals.forEach(signal => {
      const signalSuggestions = HELP_SUGGESTIONS[signal.type] || [];
      signalSuggestions.forEach(suggestion => {
        if (!addedTypes.has(suggestion.id)) {
          suggestions.push({
            ...suggestion,
            triggerType: signal.type
          });
          addedTypes.add(suggestion.id);
        }
      });
    });

    // Always add the "leave me alone" option
    suggestions.push(...HELP_SUGGESTIONS.general);

    return suggestions.slice(0, 5); // Limit to 5 suggestions
  }

  /**
   * Get current frustration state
   */
  getFrustrationState() {
    return { ...this.currentFrustration };
  }

  /**
   * Check if frustration level warrants showing help
   */
  shouldShowHelp() {
    return this.currentFrustration.score >= 0.3 && 
           !this.currentFrustration.dismissed &&
           this.currentFrustration.suggestions.length > 0;
  }

  /**
   * Dismiss the current frustration alert
   */
  dismiss(permanent = false) {
    this.currentFrustration.dismissed = true;
    if (permanent) {
      this.currentFrustration.dismissedUntil = Date.now() + this.cooldownPeriod;
    }
    this.notifyListeners();
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.events = {
      undoRedo: [],
      cursorPositions: [],
      deletions: [],
      errors: [],
      fileActivity: new Map()
    };
    this.currentFrustration = {
      score: 0,
      signals: [],
      suggestions: [],
      lastChecked: Date.now(),
      dismissed: false,
      dismissedUntil: null
    };
    this.notifyListeners();
  }

  /**
   * Add a listener for frustration state changes
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of state change
   */
  notifyListeners() {
    const state = this.getFrustrationState();
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Frustration detector listener error:', error);
      }
    });
  }

  /**
   * Get a human-readable summary of current frustration
   */
  getSummary() {
    const { score, signals } = this.currentFrustration;
    
    if (score < 0.3) {
      return null;
    }

    const level = score >= 0.7 ? 'high' : score >= 0.5 ? 'moderate' : 'mild';
    const mainSignal = signals[0];
    
    return {
      level,
      score: Math.round(score * 100),
      mainReason: mainSignal?.message || 'Multiple frustration signals detected',
      signalCount: signals.length
    };
  }
}

// Singleton instance
let instance = null;

export function getFrustrationDetector() {
  if (!instance) {
    instance = new FrustrationDetector();
  }
  return instance;
}

export function createFrustrationDetector() {
  return new FrustrationDetector();
}

export { FRUSTRATION_SIGNALS, HELP_SUGGESTIONS };
export default FrustrationDetector;
