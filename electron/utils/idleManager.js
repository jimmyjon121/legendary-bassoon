/**
 * Idle Manager - Detects user idle state and manages power profiles
 * Optimizes resource usage when user is inactive
 * 
 * Integrates with PowerModeService for system-level optimizations:
 * - Performance profile -> PowerMode enabled (high priority, GPU boost)
 * - Balanced profile -> PowerMode disabled (normal priority)
 * - PowerSaver/Idle -> PowerMode disabled + reduced resources
 */

const { powerMonitor, BrowserWindow, ipcMain } = require('electron');

// Lazy load PowerModeService to avoid circular dependencies
let powerModeService = null;
function getPowerModeService() {
  if (!powerModeService) {
    try {
      const { getPowerMode } = require('../services/power-mode');
      powerModeService = getPowerMode();
    } catch (e) {
      console.warn('[IdleManager] PowerModeService not available:', e.message);
    }
  }
  return powerModeService;
}

/**
 * Power profile configurations
 */
const POWER_PROFILES = {
  performance: {
    name: 'Performance',
    description: 'Maximum performance, higher resource usage',
    healthCheckInterval: 30000,    // 30 seconds
    modelCacheSize: 256,           // MB
    maxConcurrentRequests: 10,
    enableAnimations: true,
    backgroundTasks: true,
    autoSaveInterval: 30000,       // 30 seconds
  },
  balanced: {
    name: 'Balanced',
    description: 'Good performance with moderate resource usage',
    healthCheckInterval: 60000,    // 1 minute
    modelCacheSize: 128,           // MB
    maxConcurrentRequests: 5,
    enableAnimations: true,
    backgroundTasks: true,
    autoSaveInterval: 60000,       // 1 minute
  },
  powersaver: {
    name: 'Power Saver',
    description: 'Minimal resource usage, reduced performance',
    healthCheckInterval: 300000,   // 5 minutes
    modelCacheSize: 64,            // MB
    maxConcurrentRequests: 2,
    enableAnimations: false,
    backgroundTasks: false,
    autoSaveInterval: 120000,      // 2 minutes
  },
  idle: {
    name: 'Idle',
    description: 'User is away, minimal activity',
    healthCheckInterval: 600000,   // 10 minutes
    modelCacheSize: 32,            // MB
    maxConcurrentRequests: 1,
    enableAnimations: false,
    backgroundTasks: false,
    autoSaveInterval: 300000,      // 5 minutes
  }
};

/**
 * Idle Manager class
 */
class IdleManager {
  constructor() {
    this.currentProfile = 'balanced';
    this.userProfile = 'balanced'; // User's preferred profile
    this.idleThresholdSeconds = 300; // 5 minutes
    this.isIdle = false;
    this.lastActivity = Date.now();
    this.listeners = new Set();
    this.checkInterval = null;
    this.isMonitoring = false;

    // Activity events to track
    this.activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
  }

  /**
   * Start idle monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;

    // Check idle state periodically
    this.checkInterval = setInterval(() => {
      this.checkIdleState();
    }, 10000); // Check every 10 seconds

    // Listen for system power events
    powerMonitor.on('suspend', () => this.onSystemSuspend());
    powerMonitor.on('resume', () => this.onSystemResume());
    powerMonitor.on('on-ac', () => this.onPowerSourceChange('ac'));
    powerMonitor.on('on-battery', () => this.onPowerSourceChange('battery'));
    powerMonitor.on('lock-screen', () => this.onScreenLock());
    powerMonitor.on('unlock-screen', () => this.onScreenUnlock());

    console.log('[IdleManager] Monitoring started');
  }

  /**
   * Stop idle monitoring
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isMonitoring = false;
    console.log('[IdleManager] Monitoring stopped');
  }

  /**
   * Record user activity
   */
  recordActivity() {
    this.lastActivity = Date.now();
    
    if (this.isIdle) {
      this.isIdle = false;
      this.setProfile(this.userProfile);
      this.notifyListeners('active');
    }
  }

  /**
   * Check if user is idle
   */
  checkIdleState() {
    const systemIdleTime = powerMonitor.getSystemIdleTime();
    const isSystemIdle = systemIdleTime > this.idleThresholdSeconds;
    
    // Also check our own activity tracking
    const timeSinceActivity = (Date.now() - this.lastActivity) / 1000;
    const isAppIdle = timeSinceActivity > this.idleThresholdSeconds;

    const wasIdle = this.isIdle;
    this.isIdle = isSystemIdle || isAppIdle;

    if (this.isIdle && !wasIdle) {
      console.log(`[IdleManager] User idle (system: ${systemIdleTime}s, app: ${timeSinceActivity.toFixed(0)}s)`);
      this.setProfile('idle');
      this.notifyListeners('idle');
    } else if (!this.isIdle && wasIdle) {
      console.log('[IdleManager] User active');
      this.setProfile(this.userProfile);
      this.notifyListeners('active');
    }

    return this.isIdle;
  }

  /**
   * Set the current power profile
   * Also integrates with PowerModeService for system-level optimizations
   */
  setProfile(profileName) {
    if (!POWER_PROFILES[profileName]) {
      console.warn(`[IdleManager] Unknown profile: ${profileName}`);
      return false;
    }

    const oldProfile = this.currentProfile;
    this.currentProfile = profileName;

    if (oldProfile !== profileName) {
      console.log(`[IdleManager] Profile changed: ${oldProfile} -> ${profileName}`);
      
      // Integrate with PowerModeService for system-level optimizations
      this._syncPowerModeService(profileName);
      
      this.notifyListeners('profile-change', {
        oldProfile,
        newProfile: profileName,
        config: POWER_PROFILES[profileName]
      });

      // Notify renderer processes
      this.broadcastToRenderers('power-profile-change', {
        profile: profileName,
        config: POWER_PROFILES[profileName]
      });
    }

    return true;
  }

  /**
   * Sync with PowerModeService based on profile
   * Performance = enable PowerMode (high priority, GPU boost, CUDA optimizations)
   * Other profiles = disable PowerMode (normal priority)
   */
  async _syncPowerModeService(profileName) {
    const powerMode = getPowerModeService();
    if (!powerMode) return;

    try {
      if (profileName === 'performance') {
        // Enable all system optimizations for max performance
        await powerMode.enable();
        console.log('[IdleManager] PowerMode enabled for performance profile');
      } else {
        // Disable system optimizations for balanced/powersaver/idle
        await powerMode.disable();
        console.log(`[IdleManager] PowerMode disabled for ${profileName} profile`);
      }
    } catch (e) {
      console.error('[IdleManager] Failed to sync PowerModeService:', e.message);
    }
  }

  /**
   * Set user's preferred profile
   */
  setUserProfile(profileName) {
    if (!POWER_PROFILES[profileName] || profileName === 'idle') {
      return false;
    }
    
    this.userProfile = profileName;
    
    // Apply immediately if not idle
    if (!this.isIdle) {
      this.setProfile(profileName);
    }
    
    return true;
  }

  /**
   * Get current profile configuration
   */
  getCurrentConfig() {
    return {
      profile: this.currentProfile,
      config: POWER_PROFILES[this.currentProfile],
      isIdle: this.isIdle,
      userProfile: this.userProfile
    };
  }

  /**
   * Get all available profiles
   */
  getProfiles() {
    return Object.entries(POWER_PROFILES)
      .filter(([key]) => key !== 'idle')
      .map(([key, config]) => ({
        id: key,
        name: config.name,
        description: config.description,
        isActive: this.currentProfile === key,
        isUserDefault: this.userProfile === key
      }));
  }

  /**
   * Handle system suspend
   */
  onSystemSuspend() {
    console.log('[IdleManager] System suspending');
    this.notifyListeners('suspend');
  }

  /**
   * Handle system resume
   */
  onSystemResume() {
    console.log('[IdleManager] System resuming');
    this.lastActivity = Date.now();
    this.notifyListeners('resume');
    
    // Give user a moment to interact
    setTimeout(() => this.checkIdleState(), 5000);
  }

  /**
   * Handle power source change
   */
  onPowerSourceChange(source) {
    console.log(`[IdleManager] Power source: ${source}`);
    
    // Auto-switch to power saver on battery
    if (source === 'battery' && this.userProfile === 'performance') {
      console.log('[IdleManager] On battery, switching to balanced');
      this.setProfile('balanced');
    } else if (source === 'ac' && !this.isIdle) {
      this.setProfile(this.userProfile);
    }

    this.notifyListeners('power-source', { source });
  }

  /**
   * Handle screen lock
   */
  onScreenLock() {
    console.log('[IdleManager] Screen locked');
    this.isIdle = true;
    this.setProfile('idle');
    this.notifyListeners('lock');
  }

  /**
   * Handle screen unlock
   */
  onScreenUnlock() {
    console.log('[IdleManager] Screen unlocked');
    this.isIdle = false;
    this.lastActivity = Date.now();
    this.setProfile(this.userProfile);
    this.notifyListeners('unlock');
  }

  /**
   * Add a listener for idle events
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data = {}) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        console.error('[IdleManager] Listener error:', e);
      }
    }
  }

  /**
   * Broadcast to all renderer processes
   */
  broadcastToRenderers(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    }
  }

  /**
   * Get idle statistics
   */
  getStats() {
    return {
      isIdle: this.isIdle,
      currentProfile: this.currentProfile,
      userProfile: this.userProfile,
      lastActivityAgo: Math.floor((Date.now() - this.lastActivity) / 1000),
      systemIdleTime: powerMonitor.getSystemIdleTime(),
      isMonitoring: this.isMonitoring,
      idleThreshold: this.idleThresholdSeconds
    };
  }
}

// Singleton instance
const idleManager = new IdleManager();

/**
 * Setup IPC handlers for idle manager
 */
function setupIdleManagerIPC() {
  ipcMain.handle('idle:getConfig', () => idleManager.getCurrentConfig());
  ipcMain.handle('idle:getProfiles', () => idleManager.getProfiles());
  ipcMain.handle('idle:setProfile', (_, profile) => idleManager.setUserProfile(profile));
  ipcMain.handle('idle:getStats', () => idleManager.getStats());
  ipcMain.handle('idle:recordActivity', () => {
    idleManager.recordActivity();
    return true;
  });
}

module.exports = {
  idleManager,
  IdleManager,
  POWER_PROFILES,
  setupIdleManagerIPC,
};






