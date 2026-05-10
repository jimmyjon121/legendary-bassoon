const { contextBridge, ipcRenderer } = require('electron');

const warnedDeprecated = new Set();
function warnDeprecated(apiName, replacement = '') {
  if (warnedDeprecated.has(apiName)) return;
  warnedDeprecated.add(apiName);
  const suffix = replacement ? ` Use ${replacement} instead.` : '';
  console.warn(`[electronAPI][Deprecated] ${apiName} called.${suffix}`);
}

// Generate a collision-proof stream channel id even when multiple streams are
// opened in the same millisecond. The preload runs in a sandboxed context, so
// we use the Web Crypto API (globalThis.crypto) — not the Node `crypto`
// module, which isn't available here — and fall back to timestamp+random.
function makeStreamChannelId() {
  try {
    const webCrypto = globalThis.crypto;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') {
      return `llm:stream:${webCrypto.randomUUID()}`;
    }
  } catch (_) {
    // non-blocking; fall through to fallback
  }
  return `llm:stream:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  reloadWindow: (options = {}) => ipcRenderer.invoke('window:reload', options),
  restartApp: () => ipcRenderer.invoke('app:restart'),

  // Settings/Store
  getSettings: (key) => ipcRenderer.invoke('store:get', key),
  setSettings: (key, value) => ipcRenderer.invoke('store:set', key, value),
  
  // Batched settings - get multiple keys in one IPC call
  getSettingsBatch: (keys) => ipcRenderer.invoke('store:getBatch', keys),
  setSettingsBatch: (settings) => ipcRenderer.invoke('store:setBatch', settings),
  
  // LLM Communication
  sendToLLM: (payload) => ipcRenderer.invoke('llm:send', payload),
  streamFromLLM: (payload, callback) => {
    const channel = makeStreamChannelId();
    ipcRenderer.on(channel, (_, chunk) => callback(chunk));
    ipcRenderer.invoke('llm:stream', { ...payload, channel }).catch((error) => {
      callback({ error: error?.message || 'Failed to start stream' });
    });
    return () => {
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.invoke('llm:cancel', channel);
    };
  },
  cancelLLMStream: (channel) => ipcRenderer.invoke('llm:cancel', channel),

  // Ensemble cast — multiple personas stream in parallel, multiplexed on
  // one channel. Each chunk has { castId, ... } so the UI can route it.
  parallelStreamFromLLM: (payload, callback) => {
    const channel = `llm:parallel:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
    ipcRenderer.on(channel, (_, chunk) => callback(chunk));
    ipcRenderer.invoke('llm:parallelStream', { ...payload, channel }).catch((error) => {
      callback({ error: error?.message || 'Failed to start parallel stream' });
    });
    return () => {
      ipcRenderer.removeAllListeners(channel);
    };
  },
  getModels: () => ipcRenderer.invoke('llm:models'),
  loadModel: (modelPath) => ipcRenderer.invoke('llm:load', modelPath),
  unloadModel: (modelName) => ipcRenderer.invoke('llm:unload', modelName),
  checkLLMHealth: () => ipcRenderer.invoke('llm:health'),
  warmupModel: (modelName) => ipcRenderer.invoke('llm:warmup', modelName),
  // Detailed warmup with progress events. Returns a small handle so the
  // renderer can subscribe to progress updates and resolve when done.
  warmupModelWithProgress: (modelName, onProgress) => {
    const channel = `llm:warmupProgress:${makeStreamChannelId().split(':').pop()}`;
    const handler = (_, chunk) => {
      try { onProgress?.(chunk); } catch (_) { /* renderer detached */ }
    };
    ipcRenderer.on(channel, handler);
    const finalize = () => ipcRenderer.removeListener(channel, handler);
    const resultPromise = ipcRenderer
      .invoke('llm:warmupWithProgress', { model: modelName, channel })
      .finally(finalize);
    return {
      channel,
      promise: resultPromise,
      unsubscribe: finalize,
    };
  },
  getModelInfo: (modelName) => ipcRenderer.invoke('llm:modelInfo', modelName),
  getRunningModels: () => ipcRenderer.invoke('llm:running'),
  getLlmRuntimeState: () => ipcRenderer.invoke('llm:getRuntimeState'),
  sparkProbe: (options = {}) => ipcRenderer.invoke('llm:sparkProbe', options),
  runLlmBenchmark: (payload) => ipcRenderer.invoke('llm:benchmark', payload),
  embedTexts: (payload) => ipcRenderer.invoke('llm:embed', payload),

  // Spark Model Hub - fixed runtime-control IPC surface
  sparkModelHubDashboard: () => ipcRenderer.invoke('sparkModelHub:dashboard'),
  sparkModelHubStatus: () => ipcRenderer.invoke('sparkModelHub:status'),
  sparkModelHubOllamaHealth: () => ipcRenderer.invoke('sparkModelHub:ollamaHealth'),
  sparkModelHubOllamaModels: () => ipcRenderer.invoke('sparkModelHub:ollamaModels'),
  sparkModelHubLoadedModels: () => ipcRenderer.invoke('sparkModelHub:loadedModels'),
  sparkModelHubScanLmStudio: () => ipcRenderer.invoke('sparkModelHub:scanLmStudio'),
  sparkModelHubRecommendations: () => ipcRenderer.invoke('sparkModelHub:recommendations'),
  sparkModelHubJobs: () => ipcRenderer.invoke('sparkModelHub:jobs'),
  sparkModelHubOpenWebUiStatus: () => ipcRenderer.invoke('sparkModelHub:openWebUiStatus'),
  sparkModelHubPullModel: (modelName) => ipcRenderer.invoke('sparkModelHub:pullModel', modelName),
  sparkModelHubRunModel: (modelName) => ipcRenderer.invoke('sparkModelHub:runModel', modelName),
  sparkModelHubStopModel: (modelName) => ipcRenderer.invoke('sparkModelHub:stopModel', modelName),
  sparkModelHubDeleteModel: (modelName) => ipcRenderer.invoke('sparkModelHub:deleteModel', modelName),
  sparkModelHubRestartOllama: () => ipcRenderer.invoke('sparkModelHub:restartOllama'),
  sparkModelHubImportGgufToOllama: (payload) => ipcRenderer.invoke('sparkModelHub:importGgufToOllama', payload || {}),
  sparkModelHubRegisterLocalGguf: (payload) => ipcRenderer.invoke('sparkModelHub:registerLocalGguf', payload || {}),
  sparkModelHubSetContinueModel: (payload) => ipcRenderer.invoke('sparkModelHub:setContinueModel', payload || {}),
  sparkModelHubGetContinueConfigStatus: () => ipcRenderer.invoke('sparkModelHub:getContinueConfigStatus'),
  onSparkModelHubJob: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('sparkModelHub:job', handler);
    return () => ipcRenderer.removeListener('sparkModelHub:job', handler);
  },
  
  // Image Generation (raw ComfyUI passthrough - prefer imageAuto:* or generateImage for full service)
  imageRawGenerate: (payload) => ipcRenderer.invoke('image:generate', payload),
  imageRawGetModels: () => ipcRenderer.invoke('image:models'),
  imageRawInterrupt: () => ipcRenderer.invoke('image:interrupt'),
  checkImageHealth: () => ipcRenderer.invoke('image:health'),
  
  // File System (scoped v2)
  fsScoped: {
    grantRoot: (rootPath, label) => ipcRenderer.invoke('fs:grantRoot', { rootPath, label }),
    listGrantedRoots: () => ipcRenderer.invoke('fs:listGrantedRoots'),
    revokeRoot: (rootPath) => ipcRenderer.invoke('fs:revokeRoot', { rootPath }),
    read: (targetPath, encoding = 'utf-8') => ipcRenderer.invoke('fs:readScoped', { path: targetPath, encoding }),
    write: (targetPath, content, encoding = 'utf-8') =>
      ipcRenderer.invoke('fs:writeScoped', { path: targetPath, content, encoding }),
    list: (targetPath, options = {}) =>
      ipcRenderer.invoke('fs:listScoped', { path: targetPath, ...(options || {}) }),
    mkdir: (targetPath, recursive = true) =>
      ipcRenderer.invoke('fs:mkdirScoped', { path: targetPath, recursive }),
  },

  // Typed data IPC (v2)
  data: {
    conversationsList: (payload) => ipcRenderer.invoke('conversations:list', payload || {}),
    conversationsCreate: (payload) => ipcRenderer.invoke('conversations:create', payload || {}),
    conversationsGetById: (idOrPayload) =>
      ipcRenderer.invoke(
        'conversations:getById',
        typeof idOrPayload === 'string' ? { id: idOrPayload } : (idOrPayload || {})
      ),
    conversationsUpdateMeta: (payload) => ipcRenderer.invoke('conversations:updateMeta', payload || {}),
    conversationsDelete: (idOrPayload) =>
      ipcRenderer.invoke(
        'conversations:delete',
        typeof idOrPayload === 'string' ? { id: idOrPayload } : (idOrPayload || {})
      ),

    messagesListByConversation: (payload) => ipcRenderer.invoke('messages:listByConversation', payload || {}),
    messagesAppend: (payload) => ipcRenderer.invoke('messages:append', payload || {}),
    messagesUpdate: (payload) => ipcRenderer.invoke('messages:update', payload || {}),
    messagesDelete: (idOrPayload) =>
      ipcRenderer.invoke(
        'messages:delete',
        typeof idOrPayload === 'string' ? { id: idOrPayload } : (idOrPayload || {})
      ),
    messagesDeleteMany: (payload) => ipcRenderer.invoke('messages:deleteMany', payload || {}),
    messagesSearch: (payload) => ipcRenderer.invoke('messages:search', payload || {}),

    attachmentsListByMessage: (messageIdOrPayload) =>
      ipcRenderer.invoke(
        'attachments:listByMessage',
        typeof messageIdOrPayload === 'string'
          ? { messageId: messageIdOrPayload }
          : (messageIdOrPayload || {})
      ),
    attachmentsSave: (payload) => ipcRenderer.invoke('attachments:save', payload || {}),
    attachmentsRead: (payload) => ipcRenderer.invoke('attachments:read', payload || {}),

    branchesList: (conversationIdOrPayload) =>
      ipcRenderer.invoke(
        'branches:list',
        typeof conversationIdOrPayload === 'string'
          ? { conversationId: conversationIdOrPayload }
          : (conversationIdOrPayload || {})
      ),
    branchesCreate: (payload) => ipcRenderer.invoke('branches:create', payload || {}),
    branchesSwitch: (payload) => ipcRenderer.invoke('branches:switch', payload || {}),

    searchConversations: (payload) => ipcRenderer.invoke('search:conversations', payload || {}),
    searchMessages: (payload) => ipcRenderer.invoke('search:messages', payload || {}),
  },

  // Legacy File System (deprecated compatibility window)
  selectFile: (options) => ipcRenderer.invoke('fs:selectFile', options),
  selectFolder: (options) => ipcRenderer.invoke('fs:selectFolder', options),
  readFile: (filePath) => {
    warnDeprecated('readFile', 'fsScoped.read');
    return ipcRenderer.invoke('fs:readFile', filePath);
  },
  readFileBase64: (filePath) => {
    warnDeprecated('readFileBase64', 'fsScoped.read');
    return ipcRenderer.invoke('fs:readFileBase64', filePath);
  },
  writeFile: (filePath, content) => {
    warnDeprecated('writeFile', 'fsScoped.write');
    return ipcRenderer.invoke('fs:writeFile', filePath, content);
  },
  createFolder: (folderPath) => {
    warnDeprecated('createFolder', 'fsScoped.mkdir');
    return ipcRenderer.invoke('fs:createFolder', folderPath);
  },
  listModels: (directory) => {
    warnDeprecated('listModels', 'fsScoped.list');
    return ipcRenderer.invoke('fs:listModels', directory);
  },
  
  // Project Scanning (Code Workspace)
  scanProject: (rootPath, options) => ipcRenderer.invoke('project:scan', rootPath, options),
  
  // Legacy raw SQL IPC (deprecated compatibility window)
  dbQuery: (sql, params) => {
    warnDeprecated('dbQuery', 'data.* typed endpoints');
    return ipcRenderer.invoke('db:query', sql, params);
  },
  dbRun: (sql, params) => {
    warnDeprecated('dbRun', 'data.* typed endpoints');
    return ipcRenderer.invoke('db:run', sql, params);
  },
  
  // ============================================
  // Organization System - Folders, Tags, Pin/Star
  // ============================================
  
  // Folders
  listFolders: (workspace) => ipcRenderer.invoke('folders:list', workspace),
  createConversationFolder: (data) => ipcRenderer.invoke('folders:create', data),
  updateFolder: (data) => ipcRenderer.invoke('folders:update', data),
  deleteFolder: (folderId) => ipcRenderer.invoke('folders:delete', folderId),
  
  // Conversation organization
  moveToFolder: (conversationId, folderId) => ipcRenderer.invoke('conversation:moveToFolder', { conversationId, folderId }),
  toggleStar: (conversationId) => ipcRenderer.invoke('conversation:toggleStar', conversationId),
  togglePin: (conversationId) => ipcRenderer.invoke('conversation:togglePin', conversationId),
  setConversationTags: (conversationId, tags) => ipcRenderer.invoke('conversation:setTags', { conversationId, tags }),
  updateConversationMeta: (conversationId, preview, messageCount) => ipcRenderer.invoke('conversation:updateMeta', { conversationId, preview, messageCount }),
  
  // Tags
  listTagsForWorkspace: (workspace) => ipcRenderer.invoke('tags:listForWorkspace', workspace),
  
  // Search (via SearchService)
  searchConversations: (query, options) => ipcRenderer.invoke('search:conversations', query, options),
  searchMessages: (query, options) => ipcRenderer.invoke('search:messages', query, options),
  searchAll: (query, options) => ipcRenderer.invoke('search:all', query, options),
  
  // Web Search - DuckDuckGo search for real-time information
  webSearch: (query, options) => ipcRenderer.invoke('webSearch:search', query, options),
  webFetchPage: (url, options) => ipcRenderer.invoke('webSearch:fetchPage', url, options),
  webSearchAndFormat: (query, options) => ipcRenderer.invoke('webSearch:searchAndFormat', query, options),
  
  // NSFW Password Management
  setNsfwPassword: (password) => ipcRenderer.invoke('nsfw:setPassword', password),
  verifyNsfwPassword: (password) => ipcRenderer.invoke('nsfw:verifyPassword', password),
  hasNsfwPassword: () => ipcRenderer.invoke('nsfw:hasPassword'),
  rememberNsfwPassword: (password, durationMs) => ipcRenderer.invoke('nsfw:remember', { password, durationMs }),
  getRememberedNsfwPassword: () => ipcRenderer.invoke('nsfw:getRemembered'),
  forgetNsfwPassword: () => ipcRenderer.invoke('nsfw:forget'),

  // Vault Safety: safeword/aftercare configuration and dead switch.
  // Dead switch is two-step (prepare returns a code, execute requires the code).
  vaultSafetyGetConfig: () => ipcRenderer.invoke('vault:safetyGetConfig'),
  vaultSafetySetConfig: (patch) => ipcRenderer.invoke('vault:safetySetConfig', patch),
  vaultDeadSwitchPrepare: () => ipcRenderer.invoke('vault:deadSwitchPrepare'),
  vaultDeadSwitchExecute: (code) => ipcRenderer.invoke('vault:deadSwitchExecute', { code }),
  vaultDeadSwitchCancel: () => ipcRenderer.invoke('vault:deadSwitchCancel'),
  vaultGetProfile: () => ipcRenderer.invoke('vault:getProfile'),
  vaultSetProfile: (patch) => ipcRenderer.invoke('vault:setProfile', patch),
  vaultLoreList: (payload) => ipcRenderer.invoke('vault:loreList', payload),
  vaultLoreSave: (entry) => ipcRenderer.invoke('vault:loreSave', entry),
  vaultLoreDelete: (id) => ipcRenderer.invoke('vault:loreDelete', id),
  vaultLoreLinks: () => ipcRenderer.invoke('vault:loreLinks'),
  vaultLoreLinkSave: (link) => ipcRenderer.invoke('vault:loreLinkSave', link),
  vaultLoreLinkDelete: (id) => ipcRenderer.invoke('vault:loreLinkDelete', id),
  audioGetConfig: () => ipcRenderer.invoke('audio:getConfig'),
  audioSetConfig: (patch) => ipcRenderer.invoke('audio:setConfig', patch),
  audioSynthesize: (payload) => ipcRenderer.invoke('audio:synthesize', payload),
  audioAmbience: (payload) => ipcRenderer.invoke('audio:ambience', payload),
  audioStop: () => ipcRenderer.invoke('audio:stop'),
  audioCleanup: () => ipcRenderer.invoke('audio:cleanup'),
  hapticGetConfig: () => ipcRenderer.invoke('haptic:getConfig'),
  hapticSetConfig: (patch) => ipcRenderer.invoke('haptic:setConfig', patch),
  hapticStatus: () => ipcRenderer.invoke('haptic:status'),
  hapticConnect: () => ipcRenderer.invoke('haptic:connect'),
  hapticDisconnect: () => ipcRenderer.invoke('haptic:disconnect'),
  hapticScan: (payload) => ipcRenderer.invoke('haptic:scan', payload),
  hapticList: () => ipcRenderer.invoke('haptic:list'),
  hapticVibrate: (payload) => ipcRenderer.invoke('haptic:vibrate', payload),
  hapticStop: () => ipcRenderer.invoke('haptic:stop'),
  charEvolutionGetState: (characterId) => ipcRenderer.invoke('charEvolution:getState', characterId),
  charEvolutionSetEnabled: (payload) => ipcRenderer.invoke('charEvolution:setEnabled', payload),
  charEvolutionListHistory: (payload) => ipcRenderer.invoke('charEvolution:listHistory', payload),
  charEvolutionSnapshot: (payload) => ipcRenderer.invoke('charEvolution:snapshot', payload),
  charEvolutionRevertTo: (payload) => ipcRenderer.invoke('charEvolution:revertTo', payload),
  charEvolutionCurrentTraits: (characterId) => ipcRenderer.invoke('charEvolution:currentTraits', characterId),
  charEvolutionExportJsonl: (characterId) => ipcRenderer.invoke('charEvolution:exportJsonl', characterId),

  // Encryption (for NSFW workspace)
  encrypt: (data, password) => ipcRenderer.invoke('crypto:encrypt', data, password),
  decrypt: (data, password) => ipcRenderer.invoke('crypto:decrypt', data, password),
  
  // System Events
  onPanicMode: (callback) => {
    ipcRenderer.on('panic-mode', callback);
    return () => ipcRenderer.removeListener('panic-mode', callback);
  },
  onAutoSetupComplete: (callback) => {
    const handler = (_, result) => callback(result);
    ipcRenderer.on('auto-setup-complete', handler);
    return () => ipcRenderer.removeListener('auto-setup-complete', handler);
  },
  
  // Startup Progress (real-time updates during boot)
  onStartupProgress: (callback) => {
    const handler = (_, progressEvent) => callback(progressEvent);
    ipcRenderer.on('startup:progress', handler);
    return () => ipcRenderer.removeListener('startup:progress', handler);
  },
  
  // App Info
  getAppPath: () => ipcRenderer.invoke('app:getPath'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  getAlphaReadiness: (payload = {}) => ipcRenderer.invoke('alpha:getReadiness', payload || {}),
  getIpcDeprecationStats: () => ipcRenderer.invoke('ipc:getDeprecationStats'),
  perfGetSnapshot: () => ipcRenderer.invoke('perf:getSnapshot'),
  perfSubscribe: () => ipcRenderer.invoke('perf:subscribe'),
  perfUnsubscribe: () => ipcRenderer.invoke('perf:unsubscribe'),
  perfUpdateRenderer: (payload) => ipcRenderer.invoke('perf:updateRenderer', payload || {}),
  onPerfSnapshot: (callback) => {
    const handler = (_, snapshot) => callback(snapshot);
    ipcRenderer.on('perf:snapshot', handler);
    return () => ipcRenderer.removeListener('perf:snapshot', handler);
  },
  getPlatform: () => process.platform,
  
  // GPU Info (legacy)
  getGPUInfo: () => ipcRenderer.invoke('system:gpuInfo'),
  
  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  getDevForgeHandoffStatus: (projectPath) =>
    ipcRenderer.invoke('devforge:getHandoffStatus', { projectPath }),
  openInDevForge: (projectPath, options = {}) =>
    ipcRenderer.invoke('devforge:openProject', { projectPath, ...(options || {}) }),

  // ============================================
  // Hardware Detection & Monitoring
  // ============================================
  
  // Detect all hardware (GPUs, NPU, CPU, RAM)
  detectHardware: () => ipcRenderer.invoke('hardware:detect'),
  
  // Get real-time hardware statistics
  getHardwareStats: () => ipcRenderer.invoke('hardware:getStats'),
  
  // Get detailed GPU information
  getGpuInfo: () => ipcRenderer.invoke('hardware:getGpuInfo'),
  
  // Check CUDA availability
  checkCuda: () => ipcRenderer.invoke('hardware:checkCuda'),
  
  // Check Vulkan availability
  checkVulkan: () => ipcRenderer.invoke('hardware:checkVulkan'),
  
  // Clear hardware cache
  clearHardwareCache: () => ipcRenderer.invoke('hardware:clearCache'),

  // Backend helpers
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  installOllama: () => ipcRenderer.invoke('ollama:install'),
  startOllama: () => ipcRenderer.invoke('ollama:start'),
  stopOllama: () => ipcRenderer.invoke('ollama:stop'),
  createOllamaModelFromFile: (payload) => ipcRenderer.invoke('ollama:createFromFile', payload),
  loadLocalGguf: (payload) => ipcRenderer.invoke('model:loadLocalGguf', payload),
  listLocalGgufs: () => ipcRenderer.invoke('model:listLocalGgufs'),
  unregisterLocalGguf: (payload) => ipcRenderer.invoke('model:unregisterLocalGguf', payload),
  getDraftFor: (mainModelId) => ipcRenderer.invoke('model:getDraftFor', { mainModelId }),
  listSupportedSpecMains: () => ipcRenderer.invoke('model:listSupportedSpecMains'),
  validateSpecPair: (payload) => ipcRenderer.invoke('model:validateSpecPair', payload),
  scanLmStudioImportedDuplicates: () => ipcRenderer.invoke('lmstudio:scanImportedDuplicates'),
  reclaimLmStudioImportedDuplicates: (payload) => ipcRenderer.invoke('lmstudio:reclaim', payload),
  getImageBackendStatus: () => ipcRenderer.invoke('imageBackend:status'),
  installImageBackend: () => ipcRenderer.invoke('imageBackend:install'),
  startImageBackend: (command) => ipcRenderer.invoke('imageBackend:start', command),
  stopImageBackend: (command) => ipcRenderer.invoke('imageBackend:stop', command),

  // NPU / OpenVINO
  getNpuStatus: (options) => ipcRenderer.invoke('npu:getStatus', options),
  getNpuServerStatus: () => ipcRenderer.invoke('npu:getServerStatus'),
  setupNpu: () => ipcRenderer.invoke('npu:setup'),
  startNpuServer: (options) => ipcRenderer.invoke('npu:startServer', options),
  stopNpuServer: () => ipcRenderer.invoke('npu:stopServer'),
  unloadNpuModel: () => ipcRenderer.invoke('npu:unloadModel'),
  autoConfigureNpuModel: (options) => ipcRenderer.invoke('npu:autoConfigureModel', options),
  configureNpuModel: (payload) => ipcRenderer.invoke('npu:configureModel', payload || {}),
  loadNpuModel: (payload) => ipcRenderer.invoke('npu:loadModel', payload || {}),
  clearNpuCache: () => ipcRenderer.invoke('npu:clearCache'),

  // Unified Brain (Hybrid GPU+NPU)
  getHybridCapabilities: () => ipcRenderer.invoke('npu:getHybridCapabilities'),
  getHybridStatus: () => ipcRenderer.invoke('npu:getHybridStatus'),
  enableHybridMode: (modeId) => ipcRenderer.invoke('npu:enableHybridMode', modeId),
  disableHybridMode: () => ipcRenderer.invoke('npu:disableHybridMode'),

  // ============================================
  // Power Mode
  // ============================================
  
  // Enable power mode optimizations
  enablePowerMode: () => ipcRenderer.invoke('powerMode:enable'),
  
  // Disable power mode
  disablePowerMode: () => ipcRenderer.invoke('powerMode:disable'),
  
  // Get power mode status
  getPowerModeStatus: () => ipcRenderer.invoke('powerMode:getStatus'),

  // ============================================
  // Backend Management
  // ============================================
  
  // Get available inference backends
  getBackends: () => ipcRenderer.invoke('llm:getBackends'),
  
  // Set preferred backend
  setBackend: (backendId) => ipcRenderer.invoke('llm:setBackend', backendId),
  getPerformanceProfile: () => ipcRenderer.invoke('llm:getProfile'),
  setPerformanceProfile: (profile) => ipcRenderer.invoke('llm:setProfile', profile),
  getDeviceUtilization: (windowMs) => ipcRenderer.invoke('orchestrator:getDeviceUtilization', windowMs),
  recordStreamEvent: (payload) => ipcRenderer.invoke('orchestrator:recordStreamEvent', payload || {}),
  recordSpecDecodeOutcome: (payload) => ipcRenderer.invoke('orchestrator:recordSpecDecodeOutcome', payload || {}),
  getSpecDecodeStats: (payload) => ipcRenderer.invoke('orchestrator:getSpecDecodeStats', payload || {}),
  isSpecDecodeDisabled: (payload) => ipcRenderer.invoke('orchestrator:isSpecDecodeDisabled', payload || {}),
  prewarmSpecDecodeVerifier: (payload) => ipcRenderer.invoke('orchestrator:prewarmSpecDecodeVerifier', payload || {}),
  isMosaicDevEnabled: () => ipcRenderer.invoke('dev:isMosaicEnabled'),
  mosaicProbe: (payload) => ipcRenderer.invoke('dev:mosaicProbe', payload || {}),
  readMosaicArtifacts: () => ipcRenderer.invoke('dev:readMosaicArtifacts'),

  // ============================================
  // Model Manager
  // ============================================
  
  // Scan directory for models
  scanModels: (directory) => ipcRenderer.invoke('models:scan', directory),
  
  // Get all cached models
  getAllModels: () => ipcRenderer.invoke('models:getAll'),
  
  // Get models by format
  getModelsByFormat: (format) => ipcRenderer.invoke('models:getByFormat', format),
  
  // Get models compatible with backend
  getModelsForBackend: (backendId) => ipcRenderer.invoke('models:getForBackend', backendId),
  
  // Get model statistics
  getModelStats: () => ipcRenderer.invoke('models:getStats'),
  
  // Delete a model
  deleteModel: (modelId) => ipcRenderer.invoke('models:delete', modelId),
  
  // Import a model
  importModel: (sourcePath, options) => ipcRenderer.invoke('models:import', sourcePath, options),
  convertModel: (payload) => ipcRenderer.invoke('models:convert', payload),
  
  // Get backend recommendation for model
  recommendBackend: (model, backends) => ipcRenderer.invoke('models:recommend', model, backends),
  
  // ============================================
  // Conversation Export
  // ============================================

  // Select export destination (file or folder)
  selectExportDestination: (options) => ipcRenderer.invoke('export:selectDestination', options),

  // Export a single conversation
  exportConversation: (payload) => ipcRenderer.invoke('export:conversation', payload),

  // Export all conversations
  exportAllConversations: (payload) => ipcRenderer.invoke('export:allConversations', payload),
  
  // Scan entire system for models
  scanSystemForModels: (options) => ipcRenderer.invoke('models:scanSystem', options),
  
  // Get common model locations
  getCommonModelLocations: () => ipcRenderer.invoke('models:getCommonLocations'),
  
  // Get referenced external models
  getReferencedModels: () => ipcRenderer.invoke('models:getReferencedModels'),
  
  // Bulk import models
  bulkImportModels: (modelPaths, options) => ipcRenderer.invoke('models:bulkImport', modelPaths, options),
  
  // Get disk space info
  getModelsDiskSpace: () => ipcRenderer.invoke('models:getDiskSpace'),
  
  // Set models directory
  setModelsDirectory: (directory) => ipcRenderer.invoke('models:setDirectory', directory),
  
  // Browse for models directory
  browseForModelsDirectory: () => ipcRenderer.invoke('models:browseForDirectory'),
  
  // Browse for model files to import
  browseForModelFiles: () => ipcRenderer.invoke('models:browseForFiles'),
  
  // Open file in explorer
  openInExplorer: (filePath) => ipcRenderer.invoke('models:openInExplorer', filePath),

  // LM Studio model scanning
  scanLMStudioModels: () => ipcRenderer.invoke('models:scanLMStudio'),
  
  // NPU model conversion
  convertModelToNPU: (payload) => ipcRenderer.invoke('models:convertToNPU', payload),

  // ============================================
  // Prompt Templates
  // ============================================

  listTemplates: (workspace) => ipcRenderer.invoke('templates:list', workspace),
  saveTemplate: (template) => ipcRenderer.invoke('templates:save', template),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),

  // Model presets
  getModelPresets: (modelName, workspace) =>
    ipcRenderer.invoke('presets:getForModel', { modelName, workspace }),
  saveModelPreset: (preset) => ipcRenderer.invoke('presets:save', preset),
  deleteModelPreset: (id) => ipcRenderer.invoke('presets:delete', id),
  setDefaultModelPreset: (payload) => ipcRenderer.invoke('presets:setDefault', payload),

  // Backup & restore
  createBackup: (payload) => ipcRenderer.invoke('backup:create', payload),
  restoreBackup: (payload) => ipcRenderer.invoke('backup:restore', payload),
  scheduleBackup: (payload) => ipcRenderer.invoke('backup:schedule', payload),
  listBackups: () => ipcRenderer.invoke('backup:list'),

  // Model Downloads (Ollama / remote)
  browseRemoteModels: () => ipcRenderer.invoke('models:browse'),
  lookupHfRepo: (payload) => {
    if (typeof payload === 'string') {
      return ipcRenderer.invoke('models:hfLookup', { repo: payload });
    }
    return ipcRenderer.invoke('models:hfLookup', payload || {});
  },
  startModelDownload: (payload) => ipcRenderer.invoke('models:download', payload),
  cancelModelDownload: (id) => ipcRenderer.invoke('models:cancelDownload', id),
  getModelDownloads: () => ipcRenderer.invoke('models:getDownloadProgress'),

  // Voice input (Whisper)
  checkVoiceSupport: () => ipcRenderer.invoke('voice:check'),
  transcribeAudio: (audioBuffer) =>
    ipcRenderer.invoke('voice:transcribe', { audioData: audioBuffer }),

  // Documents / RAG
  ingestDocument: (payload) => ipcRenderer.invoke('documents:ingest', payload),
  listDocuments: (workspace) => ipcRenderer.invoke('documents:list', { workspace }),
  deleteDocument: (id) => ipcRenderer.invoke('documents:delete', id),
  searchDocuments: (workspace, query, limit) =>
    ipcRenderer.invoke('documents:search', { workspace, query, limit }),
  exportKnowledgePack: (workspace) => ipcRenderer.invoke('rag:exportWorkspace', { workspace }),
  importKnowledgePack: (workspace) => ipcRenderer.invoke('rag:importWorkspace', { workspace }),

  // Auto‑update
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // ============================================
  // Message Attachments
  // ============================================
  saveMessageAttachments: (messageId, files, password) => {
    warnDeprecated('saveMessageAttachments', 'data.attachmentsSave');
    return ipcRenderer.invoke('saveMessageAttachments', messageId, files, password);
  },
  readAttachment: (filePath, password) => {
    warnDeprecated('readAttachment', 'data.attachmentsRead');
    return ipcRenderer.invoke('readAttachment', filePath, password);
  },

  // ============================================
  // Screenshot
  // ============================================
  captureScreenshot: () => ipcRenderer.invoke('captureScreenshot'),

  // ============================================
  // Agent Tasks
  // ============================================
  listAgentTasks: () => ipcRenderer.invoke('listAgentTasks'),
  createAgentTask: (payload) => ipcRenderer.invoke('createAgentTask', payload),
  getAgentTask: (id) => ipcRenderer.invoke('getAgentTask', id),
  cancelAgentTask: (id) => ipcRenderer.invoke('cancelAgentTask', id),
  agentUpdateRunProgress: (payload) => ipcRenderer.invoke('agent:updateRunProgress', payload),
  agentGetRunProgress: () => ipcRenderer.invoke('agent:getRunProgress'),
  onAgentRunProgress: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('agent:runProgress', handler);
    return () => ipcRenderer.removeListener('agent:runProgress', handler);
  },

  // ============================================
  // Research System - Project-based multi-agent research
  // ============================================
  research: {
    // Projects
    listProjects: (workspace) => ipcRenderer.invoke('research:project:list', { workspace }),
    getProject: (id) => ipcRenderer.invoke('research:project:get', { id }),
    createProject: (payload) => ipcRenderer.invoke('research:project:create', payload),
    updateProject: (payload) => ipcRenderer.invoke('research:project:update', payload),
    deleteProject: (id) => ipcRenderer.invoke('research:project:delete', { id }),

    // Project links (chats + docs)
    linkConversation: (projectId, conversationId) =>
      ipcRenderer.invoke('research:project:linkConversation', { projectId, conversationId }),
    unlinkConversation: (projectId, conversationId) =>
      ipcRenderer.invoke('research:project:unlinkConversation', { projectId, conversationId }),
    listConversations: (projectId, workspace) =>
      ipcRenderer.invoke('research:project:listConversations', { projectId, workspace }),
    linkDocument: (projectId, documentId) =>
      ipcRenderer.invoke('research:project:linkDocument', { projectId, documentId }),
    unlinkDocument: (projectId, documentId) =>
      ipcRenderer.invoke('research:project:unlinkDocument', { projectId, documentId }),
    listDocuments: (projectId, workspace) =>
      ipcRenderer.invoke('research:project:listDocuments', { projectId, workspace }),

    // Runs
    startRun: (payload) => ipcRenderer.invoke('research:run:start', payload),
    pauseRun: (runId) => ipcRenderer.invoke('research:run:pause', { runId }),
    resumeRun: (runId) => ipcRenderer.invoke('research:run:resume', { runId }),
    cancelRun: (runId) => ipcRenderer.invoke('research:run:cancel', { runId }),
    steerRun: (runId, instruction) => ipcRenderer.invoke('research:run:steer', { runId, instruction }),
    getRun: (runId) => ipcRenderer.invoke('research:run:get', { runId }),
    listRuns: (projectId, limit) => ipcRenderer.invoke('research:run:list', { projectId, limit }),
    onRunProgress: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('research:runProgress', handler);
      return () => ipcRenderer.removeListener('research:runProgress', handler);
    },

    // Records / Evidence
    listRecords: (projectId, runId, limit) =>
      ipcRenderer.invoke('research:records:list', { projectId, runId, limit }),
    getRecord: (recordId) => ipcRenderer.invoke('research:records:get', { recordId }),
    exportRecords: (payload) => ipcRenderer.invoke('research:records:export', payload),
  },

  // ============================================
  // Terminal Commands
  // ============================================
  runTerminalCommand: (payload) => ipcRenderer.invoke('runTerminalCommand', payload),

  // ============================================
  // Project Analysis
  // ============================================
  analyzeProject: (rootPath) => ipcRenderer.invoke('project:analyze', rootPath),

  // ============================================
  // Git Integration
  // ============================================
  getGitStatus: (rootPath) => ipcRenderer.invoke('git:status', rootPath),
  stageGitFile: (rootPath, filePath) => ipcRenderer.invoke('git:stage', rootPath, filePath),
  commitGitChanges: (rootPath, message) => ipcRenderer.invoke('git:commit', rootPath, message),

  // ============================================
  // Code Tools - AI-Powered Code Assistance
  // ============================================
  
  // Read file with optional line range
  toolReadFile: (projectRoot, path, startLine, endLine) => 
    ipcRenderer.invoke('tool:readFile', { projectRoot, path, startLine, endLine }),
  
  // List directory contents
  toolListDirectory: (projectRoot, path, recursive, maxDepth) => 
    ipcRenderer.invoke('tool:listDirectory', { projectRoot, path, recursive, maxDepth }),
  
  // Search code (grep-like)
  toolSearchCode: (projectRoot, pattern, fileGlob, maxResults, caseSensitive) => 
    ipcRenderer.invoke('tool:searchCode', { projectRoot, pattern, fileGlob, maxResults, caseSensitive }),
  
  // Run command (sandboxed)
  toolRunCommand: (projectRoot, command, cwd, timeout, options = {}) => 
    ipcRenderer.invoke('tool:runCommand', { projectRoot, command, cwd, timeout, ...(options || {}) }),
  
  // Apply a patch
  toolApplyPatch: (projectRoot, patch, options = {}) => 
    ipcRenderer.invoke('tool:applyPatch', { projectRoot, patch, ...(options || {}) }),

  toolCreateCheckpoint: (projectRoot, files, reason) =>
    ipcRenderer.invoke('tool:createCheckpoint', { projectRoot, files, reason }),

  toolRollbackCheckpoint: (checkpointId) =>
    ipcRenderer.invoke('tool:rollbackCheckpoint', { checkpointId }),
  
  // Generate diff preview
  toolGenerateDiff: (oldContent, newContent, filePath) => 
    ipcRenderer.invoke('tool:generateDiff', { oldContent, newContent, filePath }),
  
  // Check if command is allowed
  toolIsCommandAllowed: (command) => 
    ipcRenderer.invoke('tool:isCommandAllowed', { command }),

  // Tooling health / registration status
  toolHealth: () =>
    ipcRenderer.invoke('tool:health'),

  // Write a full file (create or overwrite) — used by agent harness editFile adapter
  toolWriteFile: (projectRoot, filePath, content) =>
    ipcRenderer.invoke('tool:writeFile', { projectRoot, path: filePath, content }),

  // Agent harness profile persistence
  agentHarnessGetProfile: (modelName) =>
    ipcRenderer.invoke('agent:harness:getProfile', { modelName }),
  agentHarnessSaveProfile: (profile) =>
    ipcRenderer.invoke('agent:harness:saveProfile', { profile }),
  agentHarnessSaveOverride: (modelName, overrides) =>
    ipcRenderer.invoke('agent:harness:saveOverride', { modelName, overrides }),

  // ============================================
  // Model Inspection & Auto-tuning
  // ============================================
  inspectModel: (filePath) => ipcRenderer.invoke('inspectModel', filePath),
  autoTuneModel: (filePath) => ipcRenderer.invoke('autoTuneModel', filePath),

  // ============================================
  // Model Experience Engine (MAEE) - Autonomous
  // ============================================
  
  // Get experience manager status
  getModelExperienceStatus: () => ipcRenderer.invoke('model:experienceStatus'),
  
  // Run comprehensive health check on all MAEE components
  runMAEEHealthCheck: () => ipcRenderer.invoke('model:healthCheck'),
  
  // Analyze model and get full experience profile
  analyzeModelExperience: (modelPath) => ipcRenderer.invoke('model:analyzeExperience', modelPath),

  // Back-compat alias used by older frontend hooks
  getModelExperience: (modelPath) => ipcRenderer.invoke('model:getExperience', modelPath),

  // Resolve the canonical local-first Model Experience Autopilot plan
  resolveModelExperiencePlan: (payload) => ipcRenderer.invoke('model:resolveExperiencePlan', payload || {}),

  // Model Load Confidence - local-only pre-generation readiness and last-good profile
  resolveModelLoadConfidence: (payload) => ipcRenderer.invoke('model:resolveLoadConfidence', payload || {}),
  recordModelLoadOutcome: (payload) => ipcRenderer.invoke('model:recordLoadOutcome', payload || {}),
  getLastKnownGoodModelLoad: (payload) => ipcRenderer.invoke('model:getLastKnownGood', payload || {}),
  recordBackendDecision: (payload) => ipcRenderer.invoke('model:recordBackendDecision', payload || {}),
  getBackendDecisionTimeline: (payload) => ipcRenderer.invoke('model:getBackendDecisionTimeline', payload || {}),
  getModelSelectorInsights: (payload) => ipcRenderer.invoke('model:getSelectorInsights', payload || {}),

  // Model Experience Workbench - local-only plan/profile/eval/history flow
  modelWorkbenchGetSnapshot: (payload) => ipcRenderer.invoke('model:workbenchGetSnapshot', payload || {}),
  modelWorkbenchBuildProfiles: (payload) => ipcRenderer.invoke('model:workbenchBuildProfiles', payload || {}),
  modelWorkbenchRunEval: (payload) => ipcRenderer.invoke('model:workbenchRunEval', payload || {}),
  modelWorkbenchCancelEval: (payload) => ipcRenderer.invoke('model:workbenchCancelEval', payload || {}),
  modelWorkbenchGetHistory: (payload) => ipcRenderer.invoke('model:workbenchGetHistory', payload || {}),
  modelWorkbenchSaveWinner: (payload) => ipcRenderer.invoke('model:workbenchSaveWinner', payload || {}),
  onModelWorkbenchProgress: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('model:workbenchProgress', handler);
    return () => ipcRenderer.removeListener('model:workbenchProgress', handler);
  },
  
  // Load model with experience profile applied
  loadModelWithProfile: (modelPath) => ipcRenderer.invoke('model:loadWithProfile', modelPath),
  
  // Get optimized inference parameters for current model
  // Pass optional presetId to apply a specific preset (accuracy, balanced, creative, etc.)
  getModelInferenceParams: (presetId) => ipcRenderer.invoke('model:getInferenceParams', presetId),
  
  // Get all available inference presets
  getInferencePresets: () => ipcRenderer.invoke('model:getInferencePresets'),
  
  // Get a specific inference preset by ID
  getInferencePreset: (presetId) => ipcRenderer.invoke('model:getInferencePreset', presetId),
  
  // Get accuracy-optimized params (reduces hallucination)
  getAccuracyParams: () => ipcRenderer.invoke('model:getAccuracyParams'),
  
  // Get creative params (higher temperature, more diverse output)
  getCreativeParams: () => ipcRenderer.invoke('model:getCreativeParams'),
  
  // Get UI hints for current model (what to show/hide)
  getModelUIHints: () => ipcRenderer.invoke('model:getUIHints'),
  
  // Get prompt template for current model
  getModelPromptTemplate: () => ipcRenderer.invoke('model:getPromptTemplate'),
  
  // Get capability scores for current model
  getModelCapabilities: () => ipcRenderer.invoke('model:getCapabilities'),
  
  // Check if current model is good for specific task
  isModelGoodFor: (task) => ipcRenderer.invoke('model:isGoodFor', task),
  
  // Get recommended workspace for current model
  getModelRecommendedWorkspace: () => ipcRenderer.invoke('model:getRecommendedWorkspace'),
  
  // Get recommended view for current model
  getModelRecommendedView: () => ipcRenderer.invoke('model:getRecommendedView'),
  
  // Format a prompt using the model's optimal template
  formatPromptForModel: (userMessage, options) => ipcRenderer.invoke('model:formatPrompt', userMessage, options),
  
  // Clear experience profile cache
  clearModelExperienceCache: () => ipcRenderer.invoke('model:clearExperienceCache'),
  
  // Listen for experience profile changes (from backend)
  onExperienceProfileChanged: (callback) => {
    const handler = (_, profile) => callback(profile);
    ipcRenderer.on('experience:profile-changed', handler);
    return () => ipcRenderer.removeListener('experience:profile-changed', handler);
  },
  
  // Listen for experience initialization
  onExperienceInitialized: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('experience:initialized', handler);
    return () => ipcRenderer.removeListener('experience:initialized', handler);
  },
  
  // Listen for profile loaded event (when model analysis completes)
  onExperienceProfileLoaded: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('experience:profile-loaded', handler);
    return () => ipcRenderer.removeListener('experience:profile-loaded', handler);
  },
  
  // Listen for optimization step events (for real-time progress)
  onExperienceOptimizationStep: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('experience:optimization-step', handler);
    return () => ipcRenderer.removeListener('experience:optimization-step', handler);
  },

  // ============================================
  // Additional Image Helpers
  // ============================================
  getImageStatus: () => ipcRenderer.invoke('getImageStatus'),
  detectImageBackend: () => ipcRenderer.invoke('detectImageBackend'),
  pollImageResult: (promptId) => ipcRenderer.invoke('pollImageResult', promptId),
  getImagePresets: () => ipcRenderer.invoke('getImagePresets'),
  generateImage: (params) => ipcRenderer.invoke('generateImage', params),

  // ============================================
  // ComfyUI Manager - Local Image Generation
  // Fully offline, unrestricted, NSFW-capable
  // ============================================
  comfyuiGetStatus: () => ipcRenderer.invoke('comfyui:getStatus'),
  comfyuiInstall: (options) => ipcRenderer.invoke('comfyui:install', options),
  comfyuiStart: () => ipcRenderer.invoke('comfyui:start'),
  comfyuiStop: () => ipcRenderer.invoke('comfyui:stop'),
  comfyuiDownloadModel: (model) => ipcRenderer.invoke('comfyui:downloadModel', model),
  comfyuiGetAvailableModels: () => ipcRenderer.invoke('comfyui:getAvailableModels'),
  comfyuiGetInstalledModels: () => ipcRenderer.invoke('comfyui:getInstalledModels'),
  comfyuiGetSetupInstructions: () => ipcRenderer.invoke('comfyui:getSetupInstructions'),
  
  // ComfyUI event listeners
  onComfyuiDownloadProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('comfyui:downloadProgress', handler);
    return () => ipcRenderer.removeListener('comfyui:downloadProgress', handler);
  },

  // ============================================
  // Auto Image Backend - Fully Self-Contained
  // One-click setup, no manual configuration
  // ============================================
  imageAutoGetStatus: () => ipcRenderer.invoke('imageAuto:getStatus'),
  imageAutoSetup: (options) => ipcRenderer.invoke('imageAuto:setup', options),
  imageAutoStart: () => ipcRenderer.invoke('imageAuto:start'),
  imageAutoStop: () => ipcRenderer.invoke('imageAuto:stop'),
  imageAutoGenerate: (params) => ipcRenderer.invoke('imageAuto:generate', params),
  imageAutoDownloadModel: (model) => ipcRenderer.invoke('imageAuto:downloadModel', model),
  imageAutoEnsureRunning: () => ipcRenderer.invoke('imageAuto:ensureRunning'),
  
  // Auto image backend event listeners
  onImageAutoEvent: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('imageAuto:event', handler);
    return () => ipcRenderer.removeListener('imageAuto:event', handler);
  },
  onImageAutoDownloadProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('imageAuto:downloadProgress', handler);
    return () => ipcRenderer.removeListener('imageAuto:downloadProgress', handler);
  },

  // ============================================
  // Memory Engine - Long conversation support
  // ============================================
  memoryBuildContext: (params) => ipcRenderer.invoke('memory:buildContext', params),
  memoryExtractMemories: (params) => ipcRenderer.invoke('memory:extractMemories', params),
  memoryUpdateSummary: (params) => ipcRenderer.invoke('memory:updateSummary', params),
  memoryPinMessage: (params) => ipcRenderer.invoke('memory:pinMessage', params),
  memoryUnpinMessage: (params) => ipcRenderer.invoke('memory:unpinMessage', params),
  memoryGetPinned: (params) => ipcRenderer.invoke('memory:getPinned', params),
  memoryIsMessagePinned: (params) => ipcRenderer.invoke('memory:isMessagePinned', params),
  memoryGetMemories: (params) => ipcRenderer.invoke('memory:getMemories', params),
  memoryAddMemory: (memory) => ipcRenderer.invoke('memory:addMemory', memory),
  memoryDeleteMemory: (params) => ipcRenderer.invoke('memory:deleteMemory', params),
  memoryGetStats: (params) => ipcRenderer.invoke('memory:getStats', params),

  // ============================================
  // Soul Engine - Personality & Relationship
  // ============================================
  soulGetSoul: () => ipcRenderer.invoke('soul:getSoul'),
  soulGetStats: () => ipcRenderer.invoke('soul:getStats'),
  soulRecordInteraction: (data) => ipcRenderer.invoke('soul:recordInteraction', data),
  soulRecordFeedback: (params) => ipcRenderer.invoke('soul:recordFeedback', params),
  soulGetPersonalizedPrompt: () => ipcRenderer.invoke('soul:getPersonalizedPrompt'),
  soulUpdateUserInfo: (updates) => ipcRenderer.invoke('soul:updateUserInfo', updates),
  soulReset: () => ipcRenderer.invoke('soul:reset'),

  // ============================================
  // Ledger - Event Recording & Analytics
  // ============================================
  ledgerGetSessionId: () => ipcRenderer.invoke('ledger:getSessionId'),
  ledgerGetStats: () => ipcRenderer.invoke('ledger:getStats'),
  ledgerRecordEvent: (event) => ipcRenderer.invoke('ledger:recordEvent', event),
  ledgerRecordMessage: (params) => ipcRenderer.invoke('ledger:recordMessage', params),
  ledgerRecordWorkspaceSwitch: (params) => ipcRenderer.invoke('ledger:recordWorkspaceSwitch', params),
  ledgerRecordModelSwitch: (params) => ipcRenderer.invoke('ledger:recordModelSwitch', params),
  ledgerRecordGenerationStart: (params) => ipcRenderer.invoke('ledger:recordGenerationStart', params),
  ledgerRecordGenerationComplete: (params) => ipcRenderer.invoke('ledger:recordGenerationComplete', params),
  ledgerRecordFileOpen: (params) => ipcRenderer.invoke('ledger:recordFileOpen', params),
  ledgerRecordTypingBurst: (params) => ipcRenderer.invoke('ledger:recordTypingBurst', params),
  ledgerRecordUserAction: (params) => ipcRenderer.invoke('ledger:recordUserAction', params),
  ledgerGetFrictionSignals: (filters) => ipcRenderer.invoke('ledger:getFrictionSignals', filters),
  ledgerListEvents: (filters) => ipcRenderer.invoke('ledger:listEvents', filters),
  ledgerGetSessionEvents: (limit) => ipcRenderer.invoke('ledger:getSessionEvents', limit),
  ledgerGetSessionTimeline: (sessionId, options) => ipcRenderer.invoke('ledger:getSessionTimeline', sessionId, options),
  ledgerVerifyChain: (limit) => ipcRenderer.invoke('ledger:verifyChain', limit),
  ledgerClearEvents: () => ipcRenderer.invoke('ledger:clearEvents'),
  ledgerClearFrictionSignals: () => ipcRenderer.invoke('ledger:clearFrictionSignals'),
  ledgerClearAll: () => ipcRenderer.invoke('ledger:clearAll'),

  // ============================================
  // Sovereignty / Privacy Features
  // ============================================
  getSovereigntyStatus: () => ipcRenderer.invoke('sovereignty:getStatus'),
  setLocalOnlyMode: (enabled) => ipcRenderer.invoke('setLocalOnlyMode', enabled),

  // ============================================
  // File System Helpers
  // ============================================
  checkPath: (targetPath) => ipcRenderer.invoke('checkPath', targetPath),
  scanFolderForModels: (folderPath) => ipcRenderer.invoke('scanFolderForModels', folderPath),

  // ============================================
  // HuggingFace Model Browser
  // ============================================
  
  // Search for GGUF models on HuggingFace
  hfSearch: (query, options) => ipcRenderer.invoke('hf:search', query, options),
  hfSearchPage: (query, options) => ipcRenderer.invoke('hf:searchPage', query, options),
  
  // Get detailed model information
  hfGetModelDetails: (modelId) => ipcRenderer.invoke('hf:getModelDetails', modelId),
  
  // Get model files list
  hfGetModelFiles: (modelId, options) => ipcRenderer.invoke('hf:getModelFiles', modelId, options),
  
  // Get curated collections
  hfGetCollections: () => ipcRenderer.invoke('hf:getCollections'),
  
  // Get collection models with details
  hfGetCollectionModels: (collectionId) => ipcRenderer.invoke('hf:getCollectionModels', collectionId),
  
  // Get quantization guide
  hfGetQuantizationGuide: () => ipcRenderer.invoke('hf:getQuantizationGuide'),
  
  // Get trending models
  hfGetTrending: (limit) => ipcRenderer.invoke('hf:getTrending', limit),
  
  // Get recently updated models
  hfGetRecent: (limit) => ipcRenderer.invoke('hf:getRecent', limit),
  
  // Compare multiple models
  hfCompareModels: (modelIds) => ipcRenderer.invoke('hf:compareModels', modelIds),
  
  // Get hardware-based recommendations
  hfRecommendForHardware: (vramGB, ramGB) => ipcRenderer.invoke('hf:recommendForHardware', vramGB, ramGB),
  
  // Download a model file
  hfDownloadModel: (fileInfo, destDir) => ipcRenderer.invoke('hf:downloadModel', fileInfo, destDir),
  
  // Cancel a download
  hfCancelDownload: (downloadId) => ipcRenderer.invoke('hf:cancelDownload', downloadId),
  
  // Get active downloads
  hfGetDownloads: () => ipcRenderer.invoke('hf:getDownloads'),
  
  // Clear HF browser cache
  hfClearCache: () => ipcRenderer.invoke('hf:clearCache'),
  
  // Import downloaded model to Ollama
  hfImportToOllama: (filePath, modelName) => ipcRenderer.invoke('hf:importToOllama', filePath, modelName),
  
  // Get default download directory
  hfGetDefaultDownloadDir: () => ipcRenderer.invoke('hf:getDefaultDownloadDir'),
  
  // Select custom download directory
  hfSelectDownloadDir: () => ipcRenderer.invoke('hf:selectDownloadDir'),
  
  // Listen for download progress updates
  onHfDownloadProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('hf:downloadProgress', handler);
    return () => ipcRenderer.removeListener('hf:downloadProgress', handler);
  },

  // ============================================
  // Model Providers (Multi-Provider Support)
  // ============================================
  
  // Search across all providers
  providersSearchAll: (query, options) => ipcRenderer.invoke('providers:searchAll', query, options),
  
  // Get Ollama library models
  providersGetOllamaModels: (category, options) => ipcRenderer.invoke('providers:getOllamaModels', category, options),
  
  // Get image generation models (CivitAI)
  providersGetImageModels: (category) => ipcRenderer.invoke('providers:getImageModels', category),
  
  // Get vision models (LLaVA, etc.)
  providersGetVisionModels: () => ipcRenderer.invoke('providers:getVisionModels'),

  // Get protected catalog models from all providers
  providersGetNSFWModels: (type, password = null) => ipcRenderer.invoke('providers:getNSFWModels', type, password),

  // Get all provider categories
  providersGetAllCategories: () => ipcRenderer.invoke('providers:getAllCategories'),
  
  // Get featured models across providers
  providersGetFeatured: () => ipcRenderer.invoke('providers:getFeatured'),
  
  // Get hardware-based recommendations
  providersGetRecommendations: (vramGB, ramGB) => ipcRenderer.invoke('providers:getRecommendations', vramGB, ramGB),
  
  // Get protected catalog models for the vault
  providersGetPrivateVaultModels: (password = null) => ipcRenderer.invoke('providers:getPrivateVaultModels', password),
  
  // Pull an Ollama model
  providersPullOllamaModel: (modelName) => ipcRenderer.invoke('providers:pullOllamaModel', modelName),

  // Download protected catalog model from various sources
  providersDownloadNsfwModel: (modelData, password = null) => ipcRenderer.invoke('providers:downloadNsfwModel', modelData, password),
  providersDownloadModel: (modelData) => ipcRenderer.invoke('providers:downloadModel', modelData),

  // Listen for Ollama pull progress
  onProvidersPullProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('providers:pullProgress', handler);
    return () => ipcRenderer.removeListener('providers:pullProgress', handler);
  },

  // Listen for model download progress (CivitAI, HuggingFace)
  onProvidersDownloadProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('providers:downloadProgress', handler);
    return () => ipcRenderer.removeListener('providers:downloadProgress', handler);
  },

  // ============================================
  // Unified Download Queue Management
  // ============================================
  
  // Get all active downloads from all sources
  downloadsGetAll: () => ipcRenderer.invoke('downloads:getAll'),
  
  // Cancel a download by ID
  downloadsCancel: (downloadId) => ipcRenderer.invoke('downloads:cancel', downloadId),
  
  // Pause a download (Phase 1 - DownloadManagerV2)
  downloadsPause: (downloadId) => ipcRenderer.invoke('downloads:pause', downloadId),
  
  // Resume a paused download (Phase 1 - DownloadManagerV2)
  downloadsResume: (downloadId) => ipcRenderer.invoke('downloads:resume', downloadId),
  
  // Retry a failed download (Phase 1 - DownloadManagerV2)
  downloadsRetry: (downloadId) => ipcRenderer.invoke('downloads:retry', downloadId),
  
  // Set download priority (Phase 1 - DownloadManagerV2)
  downloadsSetPriority: (downloadId, priority) => ipcRenderer.invoke('downloads:setPriority', downloadId, priority),
  
  // Schedule a download for later (Phase 1 - DownloadManagerV2)
  downloadsSchedule: (downloadId, scheduleTime) => ipcRenderer.invoke('downloads:schedule', downloadId, scheduleTime),
  
  // ============================================
  // Download Manager V2 - Persistent + Resumable
  // ============================================
  
  // Create a new download job
  downloadsCreate: (options) => ipcRenderer.invoke('downloads:create', options),
  
  // Get all V2 jobs
  downloadsGetAllV2: () => ipcRenderer.invoke('downloads:getAllV2'),
  
  // Get a specific job by ID
  downloadsGetV2: (id) => ipcRenderer.invoke('downloads:getV2', id),
  
  // Delete a download (and optionally files)
  downloadsDelete: (downloadId, deleteFiles) => ipcRenderer.invoke('downloads:delete', downloadId, deleteFiles),
  
  // Clear all completed downloads
  downloadsClearCompleted: () => ipcRenderer.invoke('downloads:clearCompleted'),
  
  // V2 event listeners
  onDownloadsJobCreated: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobCreated', handler);
    return () => ipcRenderer.removeListener('downloads:jobCreated', handler);
  },
  onDownloadsJobStarted: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobStarted', handler);
    return () => ipcRenderer.removeListener('downloads:jobStarted', handler);
  },
  onDownloadsJobProgress: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobProgress', handler);
    return () => ipcRenderer.removeListener('downloads:jobProgress', handler);
  },
  onDownloadsJobCompleted: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobCompleted', handler);
    return () => ipcRenderer.removeListener('downloads:jobCompleted', handler);
  },
  onDownloadsJobError: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobError', handler);
    return () => ipcRenderer.removeListener('downloads:jobError', handler);
  },
  onDownloadsJobPaused: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobPaused', handler);
    return () => ipcRenderer.removeListener('downloads:jobPaused', handler);
  },
  onDownloadsJobCancelled: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('downloads:jobCancelled', handler);
    return () => ipcRenderer.removeListener('downloads:jobCancelled', handler);
  },
  onDownloadsModelAutoImported: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('downloads:modelAutoImported', handler);
    return () => ipcRenderer.removeListener('downloads:modelAutoImported', handler);
  },

  // ============================================
  // Installer Registry - Model Installation
  // ============================================
  
  // Get available engines
  installerGetEngines: () => ipcRenderer.invoke('installer:getEngines'),
  
  // Get engines compatible with a model type
  installerGetEnginesForType: (modelType) => ipcRenderer.invoke('installer:getEnginesForType', modelType),
  
  // Get recommended engine for a model
  installerGetRecommendedEngine: (modelInfo) => ipcRenderer.invoke('installer:getRecommendedEngine', modelInfo),
  
  // Install a model
  installerInstall: (filePath, modelInfo, options) => ipcRenderer.invoke('installer:install', { filePath, modelInfo, options }),
  
  // Validate an installed model
  installerValidate: (modelInfo, engineId) => ipcRenderer.invoke('installer:validate', { modelInfo, engineId }),
  
  // Run readiness check
  installerReadinessCheck: (modelInfo, engineId) => ipcRenderer.invoke('installer:readinessCheck', { modelInfo, engineId }),
  
  // Uninstall a model
  installerUninstall: (modelInfo, engineId) => ipcRenderer.invoke('installer:uninstall', { modelInfo, engineId }),
  
  // Set engine path
  installerSetEnginePath: (engineId, enginePath) => ipcRenderer.invoke('installer:setEnginePath', { engineId, path: enginePath }),
  
  // Installer event listeners
  onInstallerStarted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('installer:started', handler);
    return () => ipcRenderer.removeListener('installer:started', handler);
  },
  onInstallerProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('installer:progress', handler);
    return () => ipcRenderer.removeListener('installer:progress', handler);
  },
  onInstallerCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('installer:completed', handler);
    return () => ipcRenderer.removeListener('installer:completed', handler);
  },
  onInstallerDependenciesRequired: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('installer:dependenciesRequired', handler);
    return () => ipcRenderer.removeListener('installer:dependenciesRequired', handler);
  },
  onInstallerUninstallCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('installer:uninstallCompleted', handler);
    return () => ipcRenderer.removeListener('installer:uninstallCompleted', handler);
  },

  // ============================================
  // Local Model Scanner
  // ============================================
  
  // Get all configured sources
  scannerGetSources: () => ipcRenderer.invoke('scanner:getSources'),
  
  // Scan all sources
  scannerScanAll: (options) => ipcRenderer.invoke('scanner:scanAll', options),
  
  // Get all discovered models
  scannerGetAllModels: () => ipcRenderer.invoke('scanner:getAllModels'),
  
  // Get models by source
  scannerGetBySource: (sourceId) => ipcRenderer.invoke('scanner:getBySource', sourceId),
  
  // Get models by type
  scannerGetByType: (modelType) => ipcRenderer.invoke('scanner:getByType', modelType),
  
  // Get specific model
  scannerGetModel: (modelPath) => ipcRenderer.invoke('scanner:getModel', modelPath),
  
  // Add custom scan path
  scannerAddCustomPath: (scanPath, options) => ipcRenderer.invoke('scanner:addCustomPath', { path: scanPath, options }),
  
  // Remove custom scan path
  scannerRemoveCustomPath: (scanPath) => ipcRenderer.invoke('scanner:removeCustomPath', scanPath),
  
  // Import model (copy)
  scannerImportModel: (modelPath, targetDir) => ipcRenderer.invoke('scanner:importModel', { modelPath, targetDir }),
  
  // Link model (symlink)
  scannerLinkModel: (modelPath, targetDir) => ipcRenderer.invoke('scanner:linkModel', { modelPath, targetDir }),
  
  // Move model
  scannerMoveModel: (modelPath, targetDir) => ipcRenderer.invoke('scanner:moveModel', { modelPath, targetDir }),
  
  // Start watching for changes
  scannerStartWatching: (sourceId) => ipcRenderer.invoke('scanner:startWatching', sourceId),
  
  // Stop watching
  scannerStopWatching: (sourceId) => ipcRenderer.invoke('scanner:stopWatching', sourceId),
  
  // Clear discovered models
  scannerClear: () => ipcRenderer.invoke('scanner:clear'),
  
  // Scanner event listeners
  onScannerStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('scanner:started', handler);
    return () => ipcRenderer.removeListener('scanner:started', handler);
  },
  onScannerSource: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scanner:source', handler);
    return () => ipcRenderer.removeListener('scanner:source', handler);
  },
  onScannerCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scanner:completed', handler);
    return () => ipcRenderer.removeListener('scanner:completed', handler);
  },
  onScannerModelDiscovered: (callback) => {
    const handler = (_, model) => callback(model);
    ipcRenderer.on('scanner:modelDiscovered', handler);
    return () => ipcRenderer.removeListener('scanner:modelDiscovered', handler);
  },
  onScannerModelChanged: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scanner:modelChanged', handler);
    return () => ipcRenderer.removeListener('scanner:modelChanged', handler);
  },
  onScannerImportProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scanner:importProgress', handler);
    return () => ipcRenderer.removeListener('scanner:importProgress', handler);
  },
  onScannerMoveProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scanner:moveProgress', handler);
    return () => ipcRenderer.removeListener('scanner:moveProgress', handler);
  },

  // ============================================
  // Storage Service
  // ============================================
  
  // Get available drives
  storageGetDrives: () => ipcRenderer.invoke('storage:getDrives'),
  
  // Get model storage usage
  storageGetUsage: () => ipcRenderer.invoke('storage:getUsage'),
  
  // Get directory breakdown
  storageGetBreakdown: (dirPath) => ipcRenderer.invoke('storage:getBreakdown', dirPath),
  
  // Find orphaned files
  storageFindOrphaned: (libraryModels) => ipcRenderer.invoke('storage:findOrphaned', libraryModels),
  
  // Find duplicates
  storageFindDuplicates: () => ipcRenderer.invoke('storage:findDuplicates'),
  
  // Move model
  storageMoveModel: (sourcePath, targetDir) => ipcRenderer.invoke('storage:moveModel', { sourcePath, targetDir }),
  
  // Delete files
  storageDeleteFiles: (filePaths) => ipcRenderer.invoke('storage:deleteFiles', filePaths),
  
  // Get recommendations
  storageGetRecommendations: () => ipcRenderer.invoke('storage:getRecommendations'),
  
  // Clear cache
  storageClearCache: () => ipcRenderer.invoke('storage:clearCache'),
  
  // Storage event listeners
  onStorageModelMoved: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('storage:modelMoved', handler);
    return () => ipcRenderer.removeListener('storage:modelMoved', handler);
  },
  onStorageFileDeleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('storage:fileDeleted', handler);
    return () => ipcRenderer.removeListener('storage:fileDeleted', handler);
  },
  onStorageMoveProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('storage:moveProgress', handler);
    return () => ipcRenderer.removeListener('storage:moveProgress', handler);
  },

  // ============================================
  // Hardware Checker
  // ============================================
  
  // Get comprehensive hardware info
  hardwareGetInfo: (forceRefresh) => ipcRenderer.invoke('hardwareChecker:getInfo', forceRefresh),
  
  // Check if model can run
  hardwareCanRunModel: (modelInfo) => ipcRenderer.invoke('hardwareChecker:canRunModel', modelInfo),
  
  // Get model recommendations
  hardwareGetRecommendations: (targetSizeB) => ipcRenderer.invoke('hardwareChecker:getRecommendations', targetSizeB),
  
  // Precheck before download
  hardwarePrecheck: (modelInfo) => ipcRenderer.invoke('hardwareChecker:precheck', modelInfo),
  
  // Estimate VRAM needed
  hardwareEstimateVram: (sizeB, quant) => ipcRenderer.invoke('hardwareChecker:estimateVram', { sizeB, quant }),

  // ============================================
  // Catalog Service
  // ============================================
  
  // Search models
  catalogSearch: (query, options) => ipcRenderer.invoke('catalog:search', query, options),
  
  // Get trending
  catalogGetTrending: (options) => ipcRenderer.invoke('catalog:getTrending', options),
  
  // Get recent
  catalogGetRecent: (options) => ipcRenderer.invoke('catalog:getRecent', options),
  
  // Get model details
  catalogGetModelDetails: (provider, modelId) => ipcRenderer.invoke('catalog:getModelDetails', provider, modelId),
  
  // Get model files
  catalogGetModelFiles: (provider, modelId) => ipcRenderer.invoke('catalog:getModelFiles', provider, modelId),
  
  // Subscribe to updates
  catalogSubscribe: (modelId, provider, installedVersion, options) => 
    ipcRenderer.invoke('catalog:subscribe', modelId, provider, installedVersion, options),
  
  // Unsubscribe
  catalogUnsubscribe: (subscriptionId) => ipcRenderer.invoke('catalog:unsubscribe', subscriptionId),
  
  // Get subscriptions
  catalogGetSubscriptions: () => ipcRenderer.invoke('catalog:getSubscriptions'),
  
  // Check for updates
  catalogCheckUpdates: () => ipcRenderer.invoke('catalog:checkUpdates'),
  
  // Get discovery feed
  catalogGetDiscoveryFeed: (options) => ipcRenderer.invoke('catalog:getDiscoveryFeed', options),
  
  // Get categories
  catalogGetCategories: () => ipcRenderer.invoke('catalog:getCategories'),
  
  // Clear cache
  catalogClearCache: (pattern) => ipcRenderer.invoke('catalog:clearCache', pattern),
  
  // Get cache stats
  catalogGetCacheStats: () => ipcRenderer.invoke('catalog:getCacheStats'),
  
  // Catalog event listeners
  onCatalogSubscriptionAdded: (callback) => {
    const handler = (_, sub) => callback(sub);
    ipcRenderer.on('catalog:subscriptionAdded', handler);
    return () => ipcRenderer.removeListener('catalog:subscriptionAdded', handler);
  },
  onCatalogUpdateAvailable: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('catalog:updateAvailable', handler);
    return () => ipcRenderer.removeListener('catalog:updateAvailable', handler);
  },

  // ============================================
  // Library Service
  // ============================================
  
  // Model operations
  libraryAddModel: (modelData) => ipcRenderer.invoke('library:addModel', modelData),
  libraryUpdateModel: (id, updates) => ipcRenderer.invoke('library:updateModel', id, updates),
  libraryDeleteModel: (id) => ipcRenderer.invoke('library:deleteModel', id),
  libraryGetModel: (id) => ipcRenderer.invoke('library:getModel', id),
  libraryGetModelByPath: (modelPath) => ipcRenderer.invoke('library:getModelByPath', modelPath),
  libraryGetAllModels: (options) => ipcRenderer.invoke('library:getAllModels', options),
  libraryRecordUsage: (id, tokens, responseTime) => ipcRenderer.invoke('library:recordUsage', id, tokens, responseTime),
  
  // Tag operations
  libraryGetAllTags: () => ipcRenderer.invoke('library:getAllTags'),
  libraryAddTagToModel: (modelId, tagName) => ipcRenderer.invoke('library:addTagToModel', modelId, tagName),
  libraryRemoveTagFromModel: (modelId, tagName) => ipcRenderer.invoke('library:removeTagFromModel', modelId, tagName),
  
  // Collection operations
  libraryCreateCollection: (data) => ipcRenderer.invoke('library:createCollection', data),
  libraryUpdateCollection: (id, updates) => ipcRenderer.invoke('library:updateCollection', id, updates),
  libraryDeleteCollection: (id) => ipcRenderer.invoke('library:deleteCollection', id),
  libraryGetCollection: (id) => ipcRenderer.invoke('library:getCollection', id),
  libraryGetAllCollections: () => ipcRenderer.invoke('library:getAllCollections'),
  libraryAddToCollection: (collectionId, modelId) => ipcRenderer.invoke('library:addToCollection', collectionId, modelId),
  libraryRemoveFromCollection: (collectionId, modelId) => ipcRenderer.invoke('library:removeFromCollection', collectionId, modelId),
  libraryGetCollectionModels: (collectionId) => ipcRenderer.invoke('library:getCollectionModels', collectionId),
  
  // Bulk operations
  libraryBulkUpdate: (modelIds, updates) => ipcRenderer.invoke('library:bulkUpdate', modelIds, updates),
  libraryBulkDelete: (modelIds) => ipcRenderer.invoke('library:bulkDelete', modelIds),
  libraryBulkAddToCollection: (collectionId, modelIds) => ipcRenderer.invoke('library:bulkAddToCollection', collectionId, modelIds),
  
  // Statistics
  libraryGetStats: () => ipcRenderer.invoke('library:getStats'),
  
  // Library event listeners
  onLibraryModelAdded: (callback) => {
    const handler = (_, model) => callback(model);
    ipcRenderer.on('library:modelAdded', handler);
    return () => ipcRenderer.removeListener('library:modelAdded', handler);
  },
  onLibraryModelUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('library:modelUpdated', handler);
    return () => ipcRenderer.removeListener('library:modelUpdated', handler);
  },
  onLibraryModelDeleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('library:modelDeleted', handler);
    return () => ipcRenderer.removeListener('library:modelDeleted', handler);
  },
  onLibraryCollectionCreated: (callback) => {
    const handler = (_, collection) => callback(collection);
    ipcRenderer.on('library:collectionCreated', handler);
    return () => ipcRenderer.removeListener('library:collectionCreated', handler);
  },
  onLibraryCollectionUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('library:collectionUpdated', handler);
    return () => ipcRenderer.removeListener('library:collectionUpdated', handler);
  },
  onLibraryCollectionDeleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('library:collectionDeleted', handler);
    return () => ipcRenderer.removeListener('library:collectionDeleted', handler);
  },

  // ============================================
  // Audio Models (Phase 5 expansion)
  // ============================================
  
  providersGetAudioModels: () => ipcRenderer.invoke('providers:getAudioModels'),
  
  // ============================================
  // Video Models (Phase 5 expansion)
  // ============================================
  
  providersGetVideoModels: () => ipcRenderer.invoke('providers:getVideoModels'),
  
  // ============================================
  // Embedding Models (Phase 5 expansion)
  // ============================================
  
  providersGetEmbeddingModels: () => ipcRenderer.invoke('providers:getEmbeddingModels'),
  
  // ============================================
  // FORMAT CONVERTER (Phase 8)
  // ============================================
  
  // Get supported conversions for a file
  converterGetSupportedConversions: (filePath) => ipcRenderer.invoke('converter:getSupportedConversions', filePath),
  
  // Create a conversion job
  converterCreateJob: (type, sourcePath, options) => ipcRenderer.invoke('converter:createJob', type, sourcePath, options),
  
  // Get all jobs
  converterGetAllJobs: () => ipcRenderer.invoke('converter:getAllJobs'),
  
  // Get a specific job
  converterGetJob: (jobId) => ipcRenderer.invoke('converter:getJob', jobId),
  
  // Cancel a job
  converterCancelJob: (jobId) => ipcRenderer.invoke('converter:cancelJob', jobId),
  
  // Clear completed jobs
  converterClearCompleted: () => ipcRenderer.invoke('converter:clearCompleted'),
  
  // Get available quantization types
  converterGetQuantTypes: () => ipcRenderer.invoke('converter:getQuantTypes'),
  
  // Estimate conversion time
  converterEstimateTime: (sourcePath, type, options) => ipcRenderer.invoke('converter:estimateTime', sourcePath, type, options),
  
  // Converter event listeners
  onConverterJobCreated: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobCreated', handler);
    return () => ipcRenderer.removeListener('converter:jobCreated', handler);
  },
  onConverterJobStarted: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobStarted', handler);
    return () => ipcRenderer.removeListener('converter:jobStarted', handler);
  },
  onConverterJobProgress: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobProgress', handler);
    return () => ipcRenderer.removeListener('converter:jobProgress', handler);
  },
  onConverterJobCompleted: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobCompleted', handler);
    return () => ipcRenderer.removeListener('converter:jobCompleted', handler);
  },
  onConverterJobError: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobError', handler);
    return () => ipcRenderer.removeListener('converter:jobError', handler);
  },
  onConverterJobCancelled: (callback) => {
    const handler = (_, job) => callback(job);
    ipcRenderer.on('converter:jobCancelled', handler);
    return () => ipcRenderer.removeListener('converter:jobCancelled', handler);
  },
  
  // ============================================
  // COLLECTIONS SERVICE (Phase 9)
  // ============================================
  
  // Get all collections
  collectionsGetAll: (options) => ipcRenderer.invoke('collections:getAll', options),
  
  // Get starter packs
  collectionsGetStarterPacks: () => ipcRenderer.invoke('collections:getStarterPacks'),
  
  // Get user collections
  collectionsGetUserCollections: () => ipcRenderer.invoke('collections:getUserCollections'),
  
  // Get collection by ID
  collectionsGetById: (collectionId) => ipcRenderer.invoke('collections:getById', collectionId),
  
  // Create collection
  collectionsCreate: (data) => ipcRenderer.invoke('collections:create', data),
  
  // Update collection
  collectionsUpdate: (collectionId, updates) => ipcRenderer.invoke('collections:update', collectionId, updates),
  
  // Delete collection
  collectionsDelete: (collectionId) => ipcRenderer.invoke('collections:delete', collectionId),
  
  // Add model to collection
  collectionsAddModel: (collectionId, modelData) => ipcRenderer.invoke('collections:addModel', collectionId, modelData),
  
  // Remove model from collection
  collectionsRemoveModel: (collectionId, provider, modelId) => ipcRenderer.invoke('collections:removeModel', collectionId, provider, modelId),
  
  // Export manifest
  collectionsExportManifest: (collectionId) => ipcRenderer.invoke('collections:exportManifest', collectionId),
  
  // Import manifest
  collectionsImportManifest: (manifest) => ipcRenderer.invoke('collections:importManifest', manifest),
  
  // Generate share code
  collectionsGenerateShareCode: (collectionId) => ipcRenderer.invoke('collections:generateShareCode', collectionId),
  
  // Get collection by share code
  collectionsGetByShareCode: (shareCode) => ipcRenderer.invoke('collections:getByShareCode', shareCode),
  
  // Get installation status
  collectionsGetInstallStatus: (collectionId) => ipcRenderer.invoke('collections:getInstallStatus', collectionId),
  
  // Track installation
  collectionsTrackInstall: (collectionId, modelsInstalled, modelsTotal) => 
    ipcRenderer.invoke('collections:trackInstall', collectionId, modelsInstalled, modelsTotal),
  
  // Get categories
  collectionsGetCategories: () => ipcRenderer.invoke('collections:getCategories'),
  
  // Collection event listeners
  onCollectionCreated: (callback) => {
    const handler = (_, collection) => callback(collection);
    ipcRenderer.on('collections:created', handler);
    return () => ipcRenderer.removeListener('collections:created', handler);
  },
  onCollectionUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('collections:updated', handler);
    return () => ipcRenderer.removeListener('collections:updated', handler);
  },
  onCollectionDeleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('collections:deleted', handler);
    return () => ipcRenderer.removeListener('collections:deleted', handler);
  },
  onCollectionImported: (callback) => {
    const handler = (_, collection) => callback(collection);
    ipcRenderer.on('collections:imported', handler);
    return () => ipcRenderer.removeListener('collections:imported', handler);
  },
  onCollectionInstallProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('collections:installProgress', handler);
    return () => ipcRenderer.removeListener('collections:installProgress', handler);
  },
  
  // ============================================
  // MODEL TESTING SERVICE (Phase 10)
  // ============================================
  
  // Get test prompts
  testingGetPrompts: (modelType) => ipcRenderer.invoke('testing:getPrompts', modelType),
  
  // Run quick test
  testingRunQuickTest: (modelId, provider, prompt, options) => 
    ipcRenderer.invoke('testing:runQuickTest', modelId, provider, prompt, options),
  
  // Run benchmark
  testingRunBenchmark: (modelId, provider, options) => 
    ipcRenderer.invoke('testing:runBenchmark', modelId, provider, options),
  
  // Check readiness
  testingCheckReadiness: (modelId, provider) => 
    ipcRenderer.invoke('testing:checkReadiness', modelId, provider),
  
  // Get community benchmarks
  testingGetCommunityBenchmarks: (modelId) => 
    ipcRenderer.invoke('testing:getCommunityBenchmarks', modelId),
  
  // Get local benchmarks
  testingGetLocalBenchmarks: (modelId) => 
    ipcRenderer.invoke('testing:getLocalBenchmarks', modelId),
  
  // Get test history
  testingGetHistory: (modelId, limit) => 
    ipcRenderer.invoke('testing:getHistory', modelId, limit),
  
  // Cancel test
  testingCancelTest: (testId) => ipcRenderer.invoke('testing:cancelTest', testId),
  
  // Get active tests
  testingGetActiveTests: () => ipcRenderer.invoke('testing:getActiveTests'),
  
  // Testing event listeners
  onTestingStarted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:started', handler);
    return () => ipcRenderer.removeListener('testing:started', handler);
  },
  onTestingProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:progress', handler);
    return () => ipcRenderer.removeListener('testing:progress', handler);
  },
  onTestingCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:completed', handler);
    return () => ipcRenderer.removeListener('testing:completed', handler);
  },
  onTestingError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:error', handler);
    return () => ipcRenderer.removeListener('testing:error', handler);
  },
  onBenchmarkStarted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:benchmarkStarted', handler);
    return () => ipcRenderer.removeListener('testing:benchmarkStarted', handler);
  },
  onBenchmarkProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:benchmarkProgress', handler);
    return () => ipcRenderer.removeListener('testing:benchmarkProgress', handler);
  },
  onBenchmarkCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:benchmarkCompleted', handler);
    return () => ipcRenderer.removeListener('testing:benchmarkCompleted', handler);
  },
  onReadinessChecked: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('testing:readinessChecked', handler);
    return () => ipcRenderer.removeListener('testing:readinessChecked', handler);
  },
  
  // ============================================
  // EXPORT/BACKUP SERVICE (Phase 11)
  // ============================================
  
  // Export manifest
  backupExportManifest: (options) => ipcRenderer.invoke('backup:exportManifest', options),
  
  // Export to file
  backupExportToFile: (filePath, options) => ipcRenderer.invoke('backup:exportToFile', filePath, options),
  
  // Import manifest
  backupImportManifest: (manifest, options) => ipcRenderer.invoke('backup:importManifest', manifest, options),
  
  // Import from file
  backupImportFromFile: (filePath, options) => ipcRenderer.invoke('backup:importFromFile', filePath, options),
  
  // Create backup
  backupCreate: (name) => ipcRenderer.invoke('backup:create', name),
  
  // List backups
  backupList: () => ipcRenderer.invoke('backup:list'),
  
  // Restore from backup
  backupRestore: (backupPath, options) => ipcRenderer.invoke('backup:restore', backupPath, options),
  
  // Delete backup
  backupDelete: (backupPath) => ipcRenderer.invoke('backup:delete', backupPath),
  
  // Get export preview
  backupGetPreview: () => ipcRenderer.invoke('backup:getPreview'),
  
  // Backup event listeners
  onBackupExportCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('backup:exportCompleted', handler);
    return () => ipcRenderer.removeListener('backup:exportCompleted', handler);
  },
  onBackupImportCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('backup:importCompleted', handler);
    return () => ipcRenderer.removeListener('backup:importCompleted', handler);
  },
  onBackupCreated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('backup:created', handler);
    return () => ipcRenderer.removeListener('backup:created', handler);
  },
  
  // ============================================
  // SECRETS STORE (Phase 13)
  // ============================================
  
  // Set token
  secretsSetToken: (provider, token) => ipcRenderer.invoke('secrets:setToken', provider, token),
  
  // Get token status (redacted)
  secretsGetTokenStatus: (provider) => ipcRenderer.invoke('secrets:getTokenStatus', provider),
  
  // Delete token
  secretsDeleteToken: (provider) => ipcRenderer.invoke('secrets:deleteToken', provider),
  
  // Validate token
  secretsValidateToken: (provider, token) => ipcRenderer.invoke('secrets:validateToken', provider, token),
  
  // Get all provider statuses
  secretsGetAllStatuses: () => ipcRenderer.invoke('secrets:getAllStatuses'),
  
  // Get configured providers
  secretsGetConfiguredProviders: () => ipcRenderer.invoke('secrets:getConfiguredProviders'),
  
  // Secrets event listeners
  onSecretsTokenSet: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('secrets:tokenSet', handler);
    return () => ipcRenderer.removeListener('secrets:tokenSet', handler);
  },
  onSecretsTokenDeleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('secrets:tokenDeleted', handler);
    return () => ipcRenderer.removeListener('secrets:tokenDeleted', handler);
  },
  onSecretsRateLimitHit: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('secrets:rateLimitHit', handler);
    return () => ipcRenderer.removeListener('secrets:rateLimitHit', handler);
  },
  
  // ============================================
  // LICENSING SERVICE (Phase 14)
  // ============================================
  
  // License acceptance
  licensingRequiresAcceptance: (modelId, provider, licenseId) => 
    ipcRenderer.invoke('licensing:requiresAcceptance', modelId, provider, licenseId),
  licensingAcceptLicense: (modelId, provider, licenseId, licenseName) => 
    ipcRenderer.invoke('licensing:acceptLicense', modelId, provider, licenseId, licenseName),
  licensingGetLicenseStatus: (modelId, provider) => 
    ipcRenderer.invoke('licensing:getLicenseStatus', modelId, provider),
  
  // ToS acceptance
  licensingAcceptToS: (provider, version) => ipcRenderer.invoke('licensing:acceptToS', provider, version),
  licensingGetToSStatus: (provider) => ipcRenderer.invoke('licensing:getToSStatus', provider),
  
  // Age verification
  licensingVerifyAge: (dateOfBirth) => ipcRenderer.invoke('licensing:verifyAge', dateOfBirth),
  licensingIsAgeVerified: () => ipcRenderer.invoke('licensing:isAgeVerified'),
  licensingGetVaultAccess: () => ipcRenderer.invoke('licensing:getVaultAccess'),
  
  // Vault password
  licensingSetVaultPassword: (password) => ipcRenderer.invoke('licensing:setVaultPassword', password),
  licensingVerifyVaultPassword: (password) => ipcRenderer.invoke('licensing:verifyVaultPassword', password),
  licensingHasVaultPassword: () => ipcRenderer.invoke('licensing:hasVaultPassword'),
  
  // License parsing
  licensingParseLicense: (licenseString) => ipcRenderer.invoke('licensing:parseLicense', licenseString),
  licensingGetLicenseSummary: (license) => ipcRenderer.invoke('licensing:getLicenseSummary', license),
  
  // Acceptances management
  licensingGetAllAcceptances: () => ipcRenderer.invoke('licensing:getAllAcceptances'),
  licensingRevokeAcceptance: (modelId, provider, licenseId) => 
    ipcRenderer.invoke('licensing:revokeAcceptance', modelId, provider, licenseId),
  
  // Licensing event listeners
  onLicensingAccepted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('licensing:accepted', handler);
    return () => ipcRenderer.removeListener('licensing:accepted', handler);
  },
  onLicensingToSAccepted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('licensing:tosAccepted', handler);
    return () => ipcRenderer.removeListener('licensing:tosAccepted', handler);
  },
  onLicensingAgeVerified: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('licensing:ageVerified', handler);
    return () => ipcRenderer.removeListener('licensing:ageVerified', handler);
  },
});

// Prevent prototype pollution
Object.freeze(window.electronAPI);
