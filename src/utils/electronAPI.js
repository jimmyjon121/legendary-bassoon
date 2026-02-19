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

async function safeResearchCall(method, args = [], defaultValue = null) {
  if (!isElectron()) return defaultValue;
  const raw = getAPI();
  const fn = raw?.research?.[method];
  if (typeof fn !== 'function') {
    console.warn(`[ElectronAPI] Research method not available: ${method}`);
    return defaultValue;
  }
  try {
    const result = await fn(...args);
    return result ?? defaultValue;
  } catch (error) {
    console.error(`[ElectronAPI] Error calling research.${method}:`, error);
    return defaultValue;
  }
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
  getNpuStatus: (options = {}) => safeCall('getNpuStatus', [options], { openvinoInstalled: false, npuAvailable: false, serverRunning: false }),
  startNpuServer: (options = {}) => safeCall('startNpuServer', [options], { success: false }),
  stopNpuServer: () => safeCall('stopNpuServer', [], { success: false }),
  setupNpu: () => safeCall('setupNpu', [], { success: false }),
  autoConfigureNpuModel: (options = {}) => safeCall('autoConfigureNpuModel', [options], { configured: false }),
  clearNpuCache: () => safeCall('clearNpuCache', [], { success: false }),

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
  agentUpdateRunProgress: (payload) => safeCall('agentUpdateRunProgress', [payload], { success: false }),
  agentGetRunProgress: () => safeCall('agentGetRunProgress', [], { status: 'idle', progressPct: 0 }),
  onAgentRunProgress: (callback) => {
    const raw = getAPI();
    if (!raw?.onAgentRunProgress || typeof callback !== 'function') {
      return () => {};
    }
    try {
      const unsubscribe = raw.onAgentRunProgress(callback);
      return typeof unsubscribe === 'function' ? unsubscribe : () => {};
    } catch (error) {
      console.error('[ElectronAPI] Failed to subscribe to agent run progress:', error);
      return () => {};
    }
  },

  // Vibe IDE: Project scanner & terminal
  scanProject: (rootPath, options) => safeCall('scanProject', [rootPath, options], { root: '', tree: [] }),
  analyzeProject: (rootPath) => safeCall('analyzeProject', [rootPath], null),
  getGitStatus: (rootPath) => safeCall('getGitStatus', [rootPath], null),
  stageGitFile: (rootPath, filePath) => safeCall('stageGitFile', [rootPath, filePath], { success: false }),
  commitGitChanges: (rootPath, message) => safeCall('commitGitChanges', [rootPath, message], { success: false }),
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

  // Tooling runtime
  toolHealth: () =>
    safeCall('toolHealth', [], { ok: false, handlersReady: false, error: 'Tooling health unavailable' }),

  toolCreateCheckpoint: (projectRoot, files, reason) =>
    safeCall('toolCreateCheckpoint', [projectRoot, files, reason], { ok: false, success: false }),

  toolRollbackCheckpoint: (checkpointId) =>
    safeCall('toolRollbackCheckpoint', [checkpointId], { ok: false, success: false }),

  getLlmRuntimeState: () =>
    safeCall('getLlmRuntimeState', [], { queue: { queued: 0, active: 0 }, fallbackCounters: {}, recentDecisions: [] }),

  runLlmBenchmark: (payload) =>
    safeCall('runLlmBenchmark', [payload], { ok: false, error: 'Benchmark unavailable' }),

  embedTexts: (payload) =>
    safeCall('embedTexts', [payload], { ok: false, vectors: [], error: 'Embedding unavailable' }),

  // Web Search - Real-time web search for AI
  webSearch: (query, options) =>
    safeCall('webSearch', [query, options], { results: [], query, took: 0, error: 'Not available' }),
  webFetchPage: (url, options) =>
    safeCall('webFetchPage', [url, options], { content: '', title: '', url, error: 'Not available' }),
  webSearchAndFormat: (query, options) =>
    safeCall('webSearchAndFormat', [query, options], { results: [], formatted: '', query, took: 0, error: 'Not available' }),

  // Research system
  research: {
    listProjects: (workspace) => safeResearchCall('listProjects', [workspace], []),
    getProject: (id) => safeResearchCall('getProject', [id], null),
    createProject: (payload) => safeResearchCall('createProject', [payload], { success: false }),
    updateProject: (payload) => safeResearchCall('updateProject', [payload], { success: false }),
    deleteProject: (id) => safeResearchCall('deleteProject', [id], { success: false }),

    linkConversation: (projectId, conversationId) =>
      safeResearchCall('linkConversation', [projectId, conversationId], { success: false }),
    unlinkConversation: (projectId, conversationId) =>
      safeResearchCall('unlinkConversation', [projectId, conversationId], { success: false }),
    listConversations: (projectId, workspace) =>
      safeResearchCall('listConversations', [projectId, workspace], { linked: [], available: [] }),

    linkDocument: (projectId, documentId) =>
      safeResearchCall('linkDocument', [projectId, documentId], { success: false }),
    unlinkDocument: (projectId, documentId) =>
      safeResearchCall('unlinkDocument', [projectId, documentId], { success: false }),
    listDocuments: (projectId, workspace) =>
      safeResearchCall('listDocuments', [projectId, workspace], { linked: [], available: [] }),

    startRun: (payload) => safeResearchCall('startRun', [payload], { success: false }),
    pauseRun: (runId) => safeResearchCall('pauseRun', [runId], { success: false }),
    resumeRun: (runId) => safeResearchCall('resumeRun', [runId], { success: false }),
    cancelRun: (runId) => safeResearchCall('cancelRun', [runId], { success: false }),
    steerRun: (runId, instruction) => safeResearchCall('steerRun', [runId, instruction], { success: false }),
    getRun: (runId) => safeResearchCall('getRun', [runId], null),
    listRuns: (projectId, limit) => safeResearchCall('listRuns', [projectId, limit], []),

    listRecords: (projectId, runId, limit) =>
      safeResearchCall('listRecords', [projectId, runId, limit], []),
    getRecord: (recordId) =>
      safeResearchCall('getRecord', [recordId], null),
    exportRecords: (payload) =>
      safeResearchCall('exportRecords', [payload], { success: false }),

    onRunProgress: (callback) => {
      const raw = getAPI();
      if (!raw?.research?.onRunProgress || typeof callback !== 'function') return () => {};
      try {
        const unsubscribe = raw.research.onRunProgress(callback);
        return typeof unsubscribe === 'function' ? unsubscribe : () => {};
      } catch (error) {
        console.error('[ElectronAPI] Failed to subscribe to research run progress:', error);
        return () => {};
      }
    },
  },
};

export default api;
