/**
 * Health Monitor Service
 * Continuously monitors all services and auto-recovers when issues are detected.
 * Designed for 100+ years of stability.
 */

const EventEmitter = require('events');

class HealthMonitor extends EventEmitter {
  constructor() {
    super();
    this.services = new Map();
    this.checkInterval = null;
    this.isRunning = false;
    this.healthHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Register a service for health monitoring
   */
  registerService(serviceId, config) {
    this.services.set(serviceId, {
      id: serviceId,
      name: config.name || serviceId,
      checkFn: config.check,
      recoverFn: config.recover,
      critical: config.critical || false,
      checkIntervalMs: config.interval || 30000,
      lastCheck: null,
      lastStatus: null,
      consecutiveFailures: 0,
      maxRecoveryAttempts: config.maxRecoveryAttempts || 3,
      recoveryAttempts: 0,
      enabled: config.enabled !== false,
    });
  }

  /**
   * Start health monitoring
   */
  start(intervalMs = 120000) { // Reduced from 30s to 120s for lighter resource usage
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('[HealthMonitor] Starting health monitoring (lite mode, 120s interval)...');
    
    // Initial check after a delay to not slow startup
    setTimeout(() => this.checkAllServices(), 5000);
    
    // Periodic checks - much less frequent for lightweight operation
    this.checkInterval = setInterval(() => {
      this.checkAllServices();
    }, intervalMs);
  }

  /**
   * Stop health monitoring
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[HealthMonitor] Stopped health monitoring');
  }

  /**
   * Check all registered services
   */
  async checkAllServices() {
    const results = {};
    
    for (const [serviceId, service] of this.services) {
      if (!service.enabled) continue;
      
      try {
        const status = await this.checkService(serviceId);
        results[serviceId] = status;
      } catch (error) {
        results[serviceId] = {
          healthy: false,
          error: error.message,
        };
      }
    }
    
    // Record in history
    this.healthHistory.push({
      timestamp: Date.now(),
      results,
    });
    
    // Trim history
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
    
    return results;
  }

  /**
   * Check a specific service
   */
  async checkService(serviceId) {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Unknown service: ${serviceId}`);
    }

    try {
      const result = await service.checkFn();
      const healthy = result?.healthy !== false;
      
      service.lastCheck = Date.now();
      service.lastStatus = healthy ? 'healthy' : 'unhealthy';
      
      if (healthy) {
        service.consecutiveFailures = 0;
        service.recoveryAttempts = 0;
      } else {
        service.consecutiveFailures++;
        
        // Emit warning
        this.emit('serviceUnhealthy', {
          serviceId,
          service: service.name,
          failures: service.consecutiveFailures,
          result,
        });
        
        // Attempt recovery if configured
        if (service.recoverFn && service.recoveryAttempts < service.maxRecoveryAttempts) {
          await this.attemptRecovery(serviceId);
        }
      }
      
      return {
        serviceId,
        healthy,
        lastCheck: service.lastCheck,
        consecutiveFailures: service.consecutiveFailures,
        ...result,
      };
    } catch (error) {
      service.lastCheck = Date.now();
      service.lastStatus = 'error';
      service.consecutiveFailures++;
      
      this.emit('serviceError', {
        serviceId,
        service: service.name,
        error: error.message,
      });
      
      return {
        serviceId,
        healthy: false,
        error: error.message,
        lastCheck: service.lastCheck,
      };
    }
  }

  /**
   * Attempt to recover a service
   */
  async attemptRecovery(serviceId) {
    const service = this.services.get(serviceId);
    if (!service || !service.recoverFn) return false;

    service.recoveryAttempts++;
    console.log(`[HealthMonitor] Attempting recovery for ${service.name} (attempt ${service.recoveryAttempts}/${service.maxRecoveryAttempts})`);
    
    this.emit('recoveryAttempt', {
      serviceId,
      service: service.name,
      attempt: service.recoveryAttempts,
    });

    try {
      await service.recoverFn();
      
      // Wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 2000));
      const result = await service.checkFn();
      
      if (result?.healthy !== false) {
        console.log(`[HealthMonitor] Successfully recovered ${service.name}`);
        service.consecutiveFailures = 0;
        service.recoveryAttempts = 0;
        
        this.emit('recoverySuccess', {
          serviceId,
          service: service.name,
        });
        
        return true;
      }
    } catch (error) {
      console.error(`[HealthMonitor] Recovery failed for ${service.name}:`, error.message);
      
      this.emit('recoveryFailed', {
        serviceId,
        service: service.name,
        error: error.message,
        attempt: service.recoveryAttempts,
      });
    }
    
    return false;
  }

  /**
   * Get current health status of all services
   */
  getStatus() {
    const status = {};
    
    for (const [serviceId, service] of this.services) {
      status[serviceId] = {
        name: service.name,
        enabled: service.enabled,
        healthy: service.lastStatus === 'healthy',
        lastCheck: service.lastCheck,
        lastStatus: service.lastStatus,
        consecutiveFailures: service.consecutiveFailures,
        critical: service.critical,
      };
    }
    
    return {
      overall: Object.values(status).every(s => !s.enabled || s.healthy),
      services: status,
      timestamp: Date.now(),
    };
  }

  /**
   * Get health history
   */
  getHistory(limit = 10) {
    return this.healthHistory.slice(-limit);
  }

  /**
   * Enable/disable a service
   */
  setServiceEnabled(serviceId, enabled) {
    const service = this.services.get(serviceId);
    if (service) {
      service.enabled = enabled;
    }
  }
}

// Create singleton instance with default service registrations
const healthMonitor = new HealthMonitor();

// Register Ollama service - check much less frequently for lite mode
healthMonitor.registerService('ollama', {
  name: 'Ollama LLM',
  critical: true,
  interval: 120000, // Reduced from 30s to 120s
  check: async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(3000), // Shorter timeout
      });
      return { healthy: response.ok };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  },
  recover: async () => {
    // Try to start Ollama
    const autoSetup = require('./auto-setup');
    await autoSetup.setupOllama();
  },
});

// Register NPU service (optional) - disabled by default for lite mode
healthMonitor.registerService('npu', {
  name: 'Intel NPU',
  critical: false,
  enabled: false, // Disabled by default - user must explicitly enable
  interval: 300000, // Check every 5 minutes if enabled
  check: async () => {
    try {
      const response = await fetch('http://localhost:8081/status', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return { healthy: response.ok };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  },
});

// Register Image Backend (optional) - disabled by default
healthMonitor.registerService('imageBackend', {
  name: 'Image Generation',
  critical: false,
  enabled: false,
  interval: 300000, // Check every 5 minutes if enabled
  check: async () => {
    try {
      const response = await fetch('http://localhost:8188/system_stats', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return { healthy: response.ok };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  },
});

module.exports = healthMonitor;




