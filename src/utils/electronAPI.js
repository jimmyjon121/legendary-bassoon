/**
 * Safe Electron API wrapper
 * Provides graceful degradation when running outside Electron
 * and consistent error handling for all API calls.
 */

// Check if we're running in Electron
export const isElectron = () => {
  return typeof window !== 'undefined' && 
         typeof window.electronAPI !== 'undefined' &&
         window.electronAPI !== null;
};

/**
 * Resolve a method name to its actual property on window.electronAPI.
 * Handles colon-separated IPC channel names (e.g. 'ledger:recordMessage' → 'ledgerRecordMessage').
 */
const _methodCache = new Map();
function resolveMethod(method) {
  if (_methodCache.has(method)) return _methodCache.get(method);

  const api = window.electronAPI;
  // Direct match first
  if (typeof api[method] === 'function') {
    _methodCache.set(method, method);
    return method;
  }

  // Convert colon-separated to camelCase: 'ledger:recordMessage' → 'ledgerRecordMessage'
  if (method.includes(':')) {
    const camel = method.replace(/:([a-zA-Z])/g, (_, c) => c.toUpperCase());
    if (typeof api[camel] === 'function') {
      _methodCache.set(method, camel);
      return camel;
    }
  }

  // Not found
  _methodCache.set(method, null);
  return null;
}

/**
 * Safely call an Electron API method
 * Returns null/default value if API is unavailable or call fails
 */
export async function safeCall(method, args = [], defaultValue = null) {
  if (!isElectron()) {
    return defaultValue;
  }

  const resolved = resolveMethod(method);
  if (!resolved) {
    console.warn(`[ElectronAPI] Method not available: ${method}`);
    return defaultValue;
  }

  try {
    const result = await window.electronAPI[resolved](...args);
    return result ?? defaultValue;
  } catch (error) {
    console.error(`[ElectronAPI] Error calling ${method}:`, error);
    return defaultValue;
  }
}

/**
 * Safely call an Electron API method with error propagation
 * Throws if the call fails (for cases where you need to handle errors)
 */
export async function safeCallOrThrow(method, args = []) {
  if (!isElectron()) {
    throw new Error(`Electron API not available`);
  }

  const resolved = resolveMethod(method);
  if (!resolved) {
    throw new Error(`Method not available: ${method}`);
  }

  return await window.electronAPI[resolved](...args);
}

/**
 * Check if a specific API method is available
 */
export function hasMethod(method) {
  return isElectron() && resolveMethod(method) !== null;
}

/**
 * Get the raw API (with null check)
 */
export function getAPI() {
  return isElectron() ? window.electronAPI : null;
}

// Pre-bound safe callers for common operations
export const api = {
  // Settings
  getSettings: (key) => safeCall('getSettings', [key]),
  setSettings: (key, value) => safeCall('setSettings', [key, value]),

  // Hardware
  detectHardware: () => safeCall('detectHardware', [], { error: 'Not available' }),
  getHardwareStats: () => safeCall('getHardwareStats', [], { error: 'Not available', cpu: { usage: 0 }, memory: { usagePercent: 0 }, gpus: [] }),

  // Ollama
  getOllamaStatus: () => safeCall('getOllamaStatus', [], { running: false }),
  startOllama: () => safeCall('startOllama', [], { success: false }),
  stopOllama: () => safeCall('stopOllama', [], { success: false }),
  getModels: () => safeCall('getModels', [], []),

  // NPU
  getNpuStatus: () => safeCall('getNpuStatus', [], { openvinoInstalled: false, npuAvailable: false, serverRunning: false }),
  startNpuServer: () => safeCall('startNpuServer', [], { success: false }),
  stopNpuServer: () => safeCall('stopNpuServer', [], { success: false }),
  setupNpu: () => safeCall('setupNpu', [], { success: false }),
  autoConfigureNpuModel: () => safeCall('autoConfigureNpuModel', [], { configured: false }),

  // Models
  scanSystemForModels: (options) => safeCall('scanSystemForModels', [options], { models: [], locations: [] }),
  bulkImportModels: (paths, options) => safeCall('bulkImportModels', [paths, options], { success: false }),
  
  // Image Backend
  getImageBackendStatus: () => safeCall('getImageBackendStatus', [], { running: false }),

  // Backend
  getBackends: () => safeCall('getBackends', [], []),
  setBackend: (id) => safeCall('setBackend', [id]),
  getPerformanceProfile: () => safeCall('getPerformanceProfile', [], 'balanced'),
  setPerformanceProfile: (profile) => safeCall('setPerformanceProfile', [profile]),

  // Power Mode
  getPowerModeStatus: () => safeCall('getPowerModeStatus', [], { enabled: false }),
  enablePowerMode: () => safeCall('enablePowerMode', [], { enabled: false }),
  disablePowerMode: () => safeCall('disablePowerMode', [], { enabled: true }),

  // Documents/RAG
  searchDocuments: (workspace, query, limit) => safeCall('searchDocuments', [workspace, query, limit], []),
  listDocuments: (workspace) => safeCall('listDocuments', [workspace], []),
  ingestDocument: (payload) => safeCall('ingestDocument', [payload], { success: false }),
  deleteDocument: (id) => safeCall('deleteDocument', [id], { success: false }),

  // Templates
  listTemplates: (workspace) => safeCall('listTemplates', [workspace], []),
  saveTemplate: (template) => safeCall('saveTemplate', [template], { success: false }),
  deleteTemplate: (id) => safeCall('deleteTemplate', [id], { success: false }),

  // Model Presets
  getModelPresets: (model, workspace) => safeCall('getModelPresets', [model, workspace], []),
  saveModelPreset: (preset) => safeCall('saveModelPreset', [preset], { success: false }),

  // Export
  exportConversation: (payload) => safeCall('exportConversation', [payload], { success: false }),
  exportAllConversations: (payload) => safeCall('exportAllConversations', [payload], { success: false }),
  selectExportDestination: (options) => safeCall('selectExportDestination', [options], null),

  // Backup
  createBackup: (payload) => safeCall('createBackup', [payload], { success: false }),
  restoreBackup: (payload) => safeCall('restoreBackup', [payload], { success: false }),
  listBackups: () => safeCall('listBackups', [], []),

  // File System
  selectFile: (options) => safeCall('selectFile', [options], null),
  selectFolder: (options) => safeCall('selectFolder', [options], null),
  browseForModelsDirectory: () => safeCall('browseForModelsDirectory', [], null),
  readFile: (filePath) => safeCall('readFile', [filePath], ''),
  writeFile: (filePath, content) => safeCall('writeFile', [filePath, content], false),
  createFolder: (folderPath) => safeCall('createFolder', [folderPath], false),
  checkPath: (targetPath) => safeCall('checkPath', [targetPath], { exists: false }),
  scanLMStudioModels: () => safeCall('scanLMStudioModels', [], { models: [], searchedPaths: [] }),
  scanFolderForModels: (folderPath) => safeCall('scanFolderForModels', [folderPath], { models: [], error: null }),

  // Message attachments (with optional encryption for Private workspace)
  saveMessageAttachments: (messageId, files, password = null) =>
    safeCall('saveMessageAttachments', [messageId, files, password], { success: false, saved: [] }),
  
  // Read attachment (with decryption for Private workspace)
  readAttachment: (filePath, password = null) =>
    safeCall('readAttachment', [filePath, password], { success: false }),

  // Screenshot
  captureScreenshot: () =>
    safeCall('captureScreenshot', [], { success: false }),

  // Agents
  listAgentTasks: () => safeCall('listAgentTasks', [], []),
  createAgentTask: (payload) => safeCall('createAgentTask', [payload], null),
  getAgentTask: (id) => safeCall('getAgentTask', [id], null),
  cancelAgentTask: (id) => safeCall('cancelAgentTask', [id], { success: false }),

  // Vibe IDE: Project scanner & terminal
  scanProject: (rootPath, options) => safeCall('scanProject', [rootPath, options], { root: '', tree: [] }),
  analyzeProject: (rootPath) => safeCall('project:analyze', [rootPath], null),
  getGitStatus: (rootPath) => safeCall('git:status', [rootPath], null),
  stageGitFile: (rootPath, filePath) => safeCall('git:stage', [rootPath, filePath], { success: false }),
  commitGitChanges: (rootPath, message) => safeCall('git:commit', [rootPath, message], { success: false }),
  runTerminalCommand: (payload) => safeCall('runTerminalCommand', [payload], {
    success: false,
    code: -1,
    stdout: '',
    stderr: 'Terminal not available',
  }),

  // Image Generation
  getImageStatus: () => safeCall('getImageStatus', [], { running: false }),
  detectImageBackend: () => safeCall('detectImageBackend', [], { running: false }),
  generateImage: (params) => safeCall('generateImage', [params], { success: false }),
  getImageModels: () => safeCall('getImageModels', [], []),
  getImagePresets: () => safeCall('getImagePresets', [], {}),
  checkImageHealth: () => safeCall('checkImageHealth', [], { healthy: false }),
  pollImageResult: (promptId) => safeCall('pollImageResult', [promptId], { completed: false }),
  interruptGeneration: (promptId) => safeCall('interruptGeneration', [promptId], { success: false }),

  // Sovereignty / Privacy
  getSovereigntyStatus: () =>
    safeCall('getSovereigntyStatus', [], {
      localOnly: false,
      data: {},
      network: { totalRequests: 0, externalRequests: 0, blockedExternalRequests: 0, lastExternal: null },
    }),
  setLocalOnlyMode: (enabled) => safeCall('setLocalOnlyMode', [enabled], { success: false, localOnly: enabled }),

  // Model inspection / auto-tune
  inspectModel: (filePath) =>
    safeCall('inspectModel', [filePath], { error: 'Inspector not available' }),
  autoTuneModel: (filePath) =>
    safeCall('autoTuneModel', [filePath], { error: 'Auto-tuner not available' }),

  // Web Search - Real-time web search for AI
  webSearch: (query, options) =>
    safeCall('webSearch', [query, options], { results: [], query, took: 0, error: 'Not available' }),
  webFetchPage: (url, options) =>
    safeCall('webFetchPage', [url, options], { content: '', title: '', url, error: 'Not available' }),
  webSearchAndFormat: (query, options) =>
    safeCall('webSearchAndFormat', [query, options], { results: [], formatted: '', query, took: 0, error: 'Not available' }),
};

export default api;

