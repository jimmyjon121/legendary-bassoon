/**
 * Lazy Service Loader
 * 
 * Loads services on-demand to reduce startup time.
 * Services are cached after first load.
 * 
 * Supports service lifecycle management:
 * - Load on demand
 * - Unload unused services to free memory
 * - Track last access time for idle cleanup
 */

const serviceCache = new Map();
const loadErrors = new Map();
const serviceLastAccess = new Map();

// Services that should never be unloaded (core functionality)
const PROTECTED_SERVICES = new Set([
  'ollama-helper',
  'model-manager',
  'power-mode',
  'hardware-detection',
]);

/**
 * Get a service by name, loading it on first access
 * @param {string} name - Service name (without path prefix)
 * @returns {any} The loaded service module
 */
function getService(name) {
  // Return cached service and update access time
  if (serviceCache.has(name)) {
    serviceLastAccess.set(name, Date.now());
    return serviceCache.get(name);
  }

  // Return null if we already tried and failed
  if (loadErrors.has(name)) {
    return null;
  }

  // Try to load the service
  try {
    const servicePath = getServicePath(name);
    const service = require(servicePath);
    serviceCache.set(name, service);
    serviceLastAccess.set(name, Date.now());
    console.log(`[LazyLoader] Loaded service: ${name}`);
    return service;
  } catch (error) {
    console.warn(`[LazyLoader] Failed to load service '${name}':`, error.message);
    loadErrors.set(name, error.message);
    return null;
  }
}

/**
 * Unload a service to free memory
 * Calls cleanup() method if the service has one
 * @param {string} name - Service name to unload
 * @returns {boolean} Whether the service was unloaded
 */
function unloadService(name) {
  // Don't unload protected services
  if (PROTECTED_SERVICES.has(name)) {
    console.log(`[LazyLoader] Cannot unload protected service: ${name}`);
    return false;
  }

  if (!serviceCache.has(name)) {
    return false;
  }

  try {
    const service = serviceCache.get(name);
    
    // Call cleanup method if it exists
    if (service && typeof service.cleanup === 'function') {
      service.cleanup();
    }
    
    // Also try common cleanup method names
    if (service && typeof service.dispose === 'function') {
      service.dispose();
    }
    if (service && typeof service.shutdown === 'function') {
      service.shutdown();
    }

    // Remove from cache
    serviceCache.delete(name);
    serviceLastAccess.delete(name);

    // Clear from Node's require cache to fully release memory
    try {
      const servicePath = getServicePath(name);
      const resolvedPath = require.resolve(servicePath);
      delete require.cache[resolvedPath];
    } catch (e) {
      // Path resolution may fail, that's okay
    }

    console.log(`[LazyLoader] Unloaded service: ${name}`);
    return true;
  } catch (error) {
    console.error(`[LazyLoader] Error unloading service '${name}':`, error.message);
    return false;
  }
}

/**
 * Unload services that haven't been accessed recently
 * @param {number} maxIdleMs - Maximum idle time in milliseconds (default: 10 minutes)
 * @returns {string[]} Names of services that were unloaded
 */
function unloadIdleServices(maxIdleMs = 10 * 60 * 1000) {
  const now = Date.now();
  const unloaded = [];

  for (const [name, lastAccess] of serviceLastAccess.entries()) {
    if (PROTECTED_SERVICES.has(name)) continue;
    
    const idleTime = now - lastAccess;
    if (idleTime > maxIdleMs) {
      if (unloadService(name)) {
        unloaded.push(name);
      }
    }
  }

  if (unloaded.length > 0) {
    console.log(`[LazyLoader] Unloaded ${unloaded.length} idle services:`, unloaded.join(', '));
  }

  return unloaded;
}

/**
 * Get the last access time for a service
 * @param {string} name - Service name
 * @returns {number|null} Timestamp of last access, or null if never accessed
 */
function getServiceLastAccess(name) {
  return serviceLastAccess.get(name) || null;
}

/**
 * Map service names to their paths
 */
function getServicePath(name) {
  const serviceMap = {
    // Core services
    'hardware-detection': './hardware-detection',
    'power-mode': './power-mode',
    'npu-bridge': './npu-bridge',
    'npu-setup': './npu-setup',
    'inference-orchestrator': './inference-orchestrator',
    'model-manager': './model-manager',
    
    // Export/Import services
    'export-service': './export-service',
    'backup-service': './backup-service',
    'model-downloader': './model-downloader',
    'model-converter': './model-converter',
    
    // AI Backend services
    'ollama-helper': './ollama-helper',
    'image-backend-helper': './image-backend-helper',
    'image-service': './image-service',
    'comfyui-manager': './comfyui-manager',
    'image-backend-auto': './image-backend-auto',
    'whisper-service': './whisper-service',
    'rag-service': './rag-service',
    
    // Utility services
    'updater-service': './updater-service',
    'project-scanner': './project-scanner',
    
    // Ledger services
    'ledger-service': './ledger/ledger-service',
    
    // Soul Engine services
    'state-inference': './soul/state-inference',
    
    // Intent compiler services
    'intent-schema': './intent-compiler/schema',
    'intent-executor': './intent-compiler/executor',
    
    // LMA services
    'llama-bridge': './llama/llama-bridge',
    'dataset-builder': './lma/dataset-builder',
    'training-scheduler': './lma/training-scheduler',
    'ollama-adapters': './lma/ollama-adapters',
    
    // Character services
    'character-engine': './character-engine',
    
    // Autonomous agent
    'autonomous-agent': './autonomous-agent',
    
    // Browser agent
    'browser-agent': './browser-agent',
    
    // Model experience
    'model-experience-engine': './model-experience-engine',
  };

  const servicePath = serviceMap[name];
  if (!servicePath) {
    throw new Error(`Unknown service: ${name}`);
  }
  return servicePath;
}

/**
 * Preload services that are commonly used
 * Called after app is ready but before window is shown
 */
async function preloadCriticalServices() {
  // Load only the most essential services for startup
  const criticalServices = [
    'ollama-helper',
    'model-manager',
  ];

  for (const name of criticalServices) {
    getService(name);
  }
}

/**
 * Check if a service is loaded
 */
function isServiceLoaded(name) {
  return serviceCache.has(name);
}

/**
 * Clear the service cache (for testing/development)
 */
function clearCache() {
  serviceCache.clear();
  loadErrors.clear();
}

/**
 * Get stats about loaded services
 */
function getStats() {
  const now = Date.now();
  const servicesWithAge = Array.from(serviceCache.keys()).map(name => ({
    name,
    loadedAgo: Math.round((now - (serviceLastAccess.get(name) || now)) / 1000),
    protected: PROTECTED_SERVICES.has(name),
  }));

  return {
    loaded: serviceCache.size,
    failed: loadErrors.size,
    services: servicesWithAge,
    errors: Object.fromEntries(loadErrors),
    protectedCount: PROTECTED_SERVICES.size,
  };
}

/**
 * Start automatic idle service cleanup
 * Runs every 5 minutes to unload services idle for more than 10 minutes
 */
let cleanupInterval = null;
function startIdleCleanup(intervalMs = 5 * 60 * 1000, maxIdleMs = 10 * 60 * 1000) {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    unloadIdleServices(maxIdleMs);
  }, intervalMs);
  
  console.log('[LazyLoader] Started idle service cleanup');
}

function stopIdleCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[LazyLoader] Stopped idle service cleanup');
  }
}

module.exports = {
  getService,
  unloadService,
  unloadIdleServices,
  getServiceLastAccess,
  preloadCriticalServices,
  isServiceLoaded,
  clearCache,
  getStats,
  startIdleCleanup,
  stopIdleCleanup,
  PROTECTED_SERVICES,
};



