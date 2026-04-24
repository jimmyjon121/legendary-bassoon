/**
 * Flow State Monitor Service
 * 
 * Monitors developer activity to detect when they're in a productive "flow state"
 * and protects that state by queueing non-urgent notifications and reducing interruptions.
 */

import { pollingCoordinator } from './pollingCoordinator';

// Flow state detection thresholds
const FLOW_CONFIG = {
  // Minimum duration of consistent activity to consider "flow"
  minFlowDuration: 900000,      // 15 minutes
  
  // Activity indicators
  activityWindow: 60000,        // 1 minute window for activity checks
  minKeystrokesPerMinute: 10,   // Minimum typing activity
  maxFileSwitches: 2,           // Max file switches per minute while in flow
  maxSearches: 1,               // Max searches per minute while in flow
  
  // Flow decay
  idleTimeout: 120000,          // 2 minutes of no activity breaks flow
  switchPenalty: 60000,         // Penalty for file switches
  
  // Notification queue
  maxQueuedNotifications: 20,
  urgentTypes: ['error', 'security', 'build_failure'],
  
  // Flow depth levels
  depthLevels: {
    shallow: { minDuration: 900000, aiIntensity: 'normal' },     // 15 min
    moderate: { minDuration: 1800000, aiIntensity: 'minimal' },  // 30 min
    deep: { minDuration: 3600000, aiIntensity: 'silent' }        // 60 min
  }
};

// Activity types that contribute to flow
const FLOW_ACTIVITIES = {
  typing: { weight: 1.0, decayRate: 0.1 },
  navigation: { weight: 0.3, decayRate: 0.2 },
  reading: { weight: 0.5, decayRate: 0.15 },
  debugging: { weight: 0.8, decayRate: 0.1 }
};

class FlowStateMonitor {
  constructor() {
    // Flow state
    this.flowState = {
      isInFlow: false,
      flowStartedAt: null,
      flowDepth: 0,           // 0-1, higher = deeper flow
      currentLevel: null,     // 'shallow', 'moderate', 'deep'
      lastActivity: Date.now(),
      activityScore: 0
    };
    
    // Activity tracking
    this.activities = {
      keystrokes: [],
      fileSwitches: [],
      searches: [],
      mouseMovements: []
    };
    
    // Notification queue
    this.notificationQueue = [];
    
    // Focus tracking
    this.focusSession = {
      currentFile: null,
      focusStartedAt: null,
      filesVisited: new Set(),
      searchCount: 0
    };
    
    // Listeners
    this.listeners = new Set();
    this.checkInterval = null;
    this.isEnabled = true;
    
    // History for analytics
    this.flowHistory = [];
  }

  /**
   * Start flow state monitoring
   */
  start() {
    if (this._unsubscribe) return;

    this._unsubscribe = pollingCoordinator.subscribe('flowStateMonitor', {
      run: () => { if (this.isEnabled) this.updateFlowState(); },
      intervalMs: 5000,
      runWhenHidden: false,
    });
  }

  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Enable/disable flow monitoring
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled && this.flowState.isInFlow) {
      this.endFlowSession('disabled');
    }
  }

  /**
   * Record a keystroke event
   */
  recordKeystroke() {
    const now = Date.now();
    this.activities.keystrokes.push(now);
    this.flowState.lastActivity = now;
    this.pruneOldActivities();
  }

  /**
   * Record a file switch
   */
  recordFileSwitch(newFilePath) {
    const now = Date.now();
    this.activities.fileSwitches.push({ timestamp: now, file: newFilePath });
    
    // Update focus session
    if (this.focusSession.currentFile !== newFilePath) {
      this.focusSession.filesVisited.add(newFilePath);
      this.focusSession.currentFile = newFilePath;
      
      if (!this.focusSession.focusStartedAt) {
        this.focusSession.focusStartedAt = now;
      }
    }
    
    this.flowState.lastActivity = now;
    this.pruneOldActivities();
  }

  /**
   * Record a search action
   */
  recordSearch(query) {
    const now = Date.now();
    this.activities.searches.push({ timestamp: now, query });
    this.focusSession.searchCount++;
    this.flowState.lastActivity = now;
    this.pruneOldActivities();
  }

  /**
   * Record mouse movement (for reading detection)
   */
  recordMouseMovement() {
    const now = Date.now();
    // Only track periodic movements, not every pixel
    const lastMovement = this.activities.mouseMovements[this.activities.mouseMovements.length - 1];
    if (!lastMovement || now - lastMovement > 1000) {
      this.activities.mouseMovements.push(now);
      this.flowState.lastActivity = now;
    }
    this.pruneOldActivities();
  }

  /**
   * Remove old activity records
   */
  pruneOldActivities() {
    const cutoff = Date.now() - FLOW_CONFIG.activityWindow * 5;
    
    this.activities.keystrokes = this.activities.keystrokes.filter(t => t > cutoff);
    this.activities.fileSwitches = this.activities.fileSwitches.filter(a => a.timestamp > cutoff);
    this.activities.searches = this.activities.searches.filter(a => a.timestamp > cutoff);
    this.activities.mouseMovements = this.activities.mouseMovements.filter(t => t > cutoff);
  }

  /**
   * Update flow state based on recent activity
   */
  updateFlowState() {
    const now = Date.now();
    const wasInFlow = this.flowState.isInFlow;
    
    // Check for idle timeout
    const idleTime = now - this.flowState.lastActivity;
    if (idleTime > FLOW_CONFIG.idleTimeout) {
      if (this.flowState.isInFlow) {
        this.endFlowSession('idle');
      }
      return;
    }
    
    // Calculate activity metrics
    const recentWindow = FLOW_CONFIG.activityWindow;
    const keystrokesPerMinute = this.activities.keystrokes.filter(
      t => t > now - recentWindow
    ).length;
    
    const fileSwitchesPerMinute = this.activities.fileSwitches.filter(
      a => a.timestamp > now - recentWindow
    ).length;
    
    const searchesPerMinute = this.activities.searches.filter(
      a => a.timestamp > now - recentWindow
    ).length;
    
    // Calculate activity score (0-1)
    let activityScore = 0;
    
    // Keystrokes contribute positively
    if (keystrokesPerMinute >= FLOW_CONFIG.minKeystrokesPerMinute) {
      activityScore += 0.4;
    } else if (keystrokesPerMinute > 0) {
      activityScore += 0.2 * (keystrokesPerMinute / FLOW_CONFIG.minKeystrokesPerMinute);
    }
    
    // File switches (some is okay, too many breaks flow)
    if (fileSwitchesPerMinute <= FLOW_CONFIG.maxFileSwitches) {
      activityScore += 0.3;
    } else {
      activityScore += 0.1;
    }
    
    // Searches (some exploration is okay)
    if (searchesPerMinute <= FLOW_CONFIG.maxSearches) {
      activityScore += 0.2;
    }
    
    // Mouse movement indicates reading/thinking
    const mouseActivity = this.activities.mouseMovements.filter(
      t => t > now - recentWindow
    ).length;
    if (mouseActivity > 0 && keystrokesPerMinute < 5) {
      activityScore += 0.1; // Reading bonus
    }
    
    this.flowState.activityScore = Math.min(1, activityScore);
    
    // Determine if in flow
    if (!this.flowState.isInFlow) {
      // Check if entering flow
      if (activityScore >= 0.5) {
        this.startFlowSession();
      }
    } else {
      // Already in flow - update depth
      const flowDuration = now - this.flowState.flowStartedAt;
      
      // Calculate flow depth based on duration and consistency
      let depth = Math.min(1, flowDuration / FLOW_CONFIG.depthLevels.deep.minDuration);
      
      // Adjust for activity score
      depth *= (0.5 + 0.5 * activityScore);
      
      this.flowState.flowDepth = depth;
      
      // Determine level
      if (flowDuration >= FLOW_CONFIG.depthLevels.deep.minDuration) {
        this.flowState.currentLevel = 'deep';
      } else if (flowDuration >= FLOW_CONFIG.depthLevels.moderate.minDuration) {
        this.flowState.currentLevel = 'moderate';
      } else if (flowDuration >= FLOW_CONFIG.depthLevels.shallow.minDuration) {
        this.flowState.currentLevel = 'shallow';
      }
      
      // Check if flow is breaking
      if (activityScore < 0.3 && fileSwitchesPerMinute > FLOW_CONFIG.maxFileSwitches * 2) {
        this.endFlowSession('disrupted');
      }
    }
    
    // Notify listeners if state changed
    if (wasInFlow !== this.flowState.isInFlow) {
      this.notifyListeners();
    }
  }

  /**
   * Start a new flow session
   */
  startFlowSession() {
    this.flowState = {
      ...this.flowState,
      isInFlow: true,
      flowStartedAt: Date.now(),
      flowDepth: 0,
      currentLevel: null
    };
    
    this.focusSession = {
      currentFile: this.focusSession.currentFile,
      focusStartedAt: Date.now(),
      filesVisited: new Set([this.focusSession.currentFile].filter(Boolean)),
      searchCount: 0
    };
    
    this.notifyListeners();
  }

  /**
   * End current flow session
   */
  endFlowSession(reason = 'unknown') {
    if (!this.flowState.isInFlow) return;
    
    const session = {
      startedAt: this.flowState.flowStartedAt,
      endedAt: Date.now(),
      duration: Date.now() - this.flowState.flowStartedAt,
      maxDepth: this.flowState.flowDepth,
      maxLevel: this.flowState.currentLevel,
      endReason: reason,
      filesVisited: Array.from(this.focusSession.filesVisited),
      searchCount: this.focusSession.searchCount
    };
    
    this.flowHistory.push(session);
    if (this.flowHistory.length > 50) {
      this.flowHistory = this.flowHistory.slice(-50);
    }
    
    this.flowState = {
      ...this.flowState,
      isInFlow: false,
      flowStartedAt: null,
      flowDepth: 0,
      currentLevel: null
    };
    
    // Process queued notifications
    this.processNotificationQueue();
    
    this.notifyListeners();
  }

  /**
   * Queue a notification (will be shown after flow ends if not urgent)
   */
  queueNotification(notification) {
    const { type, title, message, priority = 'normal', action } = notification;
    
    // Check if urgent
    if (FLOW_CONFIG.urgentTypes.includes(type) || priority === 'urgent') {
      // Show immediately
      return { queued: false, notification };
    }
    
    // If not in flow, don't queue
    if (!this.flowState.isInFlow) {
      return { queued: false, notification };
    }
    
    // Queue the notification
    const queuedNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      priority,
      action,
      queuedAt: Date.now(),
      flowDepthWhenQueued: this.flowState.flowDepth
    };
    
    this.notificationQueue.push(queuedNotification);
    
    // Trim queue if too long
    if (this.notificationQueue.length > FLOW_CONFIG.maxQueuedNotifications) {
      this.notificationQueue = this.notificationQueue.slice(-FLOW_CONFIG.maxQueuedNotifications);
    }
    
    return { queued: true, notification: queuedNotification };
  }

  /**
   * Get pending notifications
   */
  getPendingNotifications() {
    return [...this.notificationQueue];
  }

  /**
   * Process notification queue (usually called when flow ends)
   */
  processNotificationQueue() {
    const notifications = [...this.notificationQueue];
    this.notificationQueue = [];
    return notifications;
  }

  /**
   * Clear a specific notification from queue
   */
  clearNotification(notificationId) {
    this.notificationQueue = this.notificationQueue.filter(n => n.id !== notificationId);
  }

  /**
   * Get current flow state
   */
  getFlowState() {
    const now = Date.now();
    return {
      ...this.flowState,
      duration: this.flowState.isInFlow ? now - this.flowState.flowStartedAt : 0,
      queuedNotifications: this.notificationQueue.length,
      aiIntensity: this.getRecommendedAIIntensity()
    };
  }

  /**
   * Get recommended AI interaction intensity based on flow state
   */
  getRecommendedAIIntensity() {
    if (!this.flowState.isInFlow) {
      return 'normal';
    }
    
    const level = this.flowState.currentLevel;
    if (level && FLOW_CONFIG.depthLevels[level]) {
      return FLOW_CONFIG.depthLevels[level].aiIntensity;
    }
    
    return 'normal';
  }

  /**
   * Check if a specific action should be delayed
   */
  shouldDelayAction(actionType) {
    if (!this.flowState.isInFlow) return false;
    
    // Actions to delay during flow
    const delayableActions = [
      'suggestion',
      'tip',
      'update_available',
      'sync_notification',
      'telemetry'
    ];
    
    return delayableActions.includes(actionType);
  }

  /**
   * Get flow statistics
   */
  getStatistics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    
    const todaySessions = this.flowHistory.filter(s => s.startedAt >= todayMs);
    const totalFlowTime = todaySessions.reduce((sum, s) => sum + s.duration, 0);
    const avgDepth = todaySessions.length > 0
      ? todaySessions.reduce((sum, s) => sum + s.maxDepth, 0) / todaySessions.length
      : 0;
    
    return {
      todaySessions: todaySessions.length,
      totalFlowTime,
      totalFlowTimeFormatted: this.formatDuration(totalFlowTime),
      averageDepth: Math.round(avgDepth * 100),
      currentSession: this.flowState.isInFlow ? {
        duration: Date.now() - this.flowState.flowStartedAt,
        depth: Math.round(this.flowState.flowDepth * 100),
        level: this.flowState.currentLevel
      } : null
    };
  }

  /**
   * Format duration for display
   */
  formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Add a state change listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners() {
    const state = this.getFlowState();
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Flow state listener error:', error);
      }
    });
  }

  /**
   * Reset the monitor
   */
  reset() {
    this.flowState = {
      isInFlow: false,
      flowStartedAt: null,
      flowDepth: 0,
      currentLevel: null,
      lastActivity: Date.now(),
      activityScore: 0
    };
    this.activities = {
      keystrokes: [],
      fileSwitches: [],
      searches: [],
      mouseMovements: []
    };
    this.notificationQueue = [];
    this.focusSession = {
      currentFile: null,
      focusStartedAt: null,
      filesVisited: new Set(),
      searchCount: 0
    };
    this.notifyListeners();
  }
}

// Singleton instance
let instance = null;

export function getFlowStateMonitor() {
  if (!instance) {
    instance = new FlowStateMonitor();
  }
  return instance;
}

export function createFlowStateMonitor() {
  return new FlowStateMonitor();
}

export { FLOW_CONFIG };
export default FlowStateMonitor;
