/**
 * IPC Handlers - Main Entry Point
 * 
 * NOTE: This file is being refactored into modular domain handlers.
 * New handlers should be added to the appropriate file in electron/ipc/:
 * 
 * - system-handlers.js: Window, hardware, power, settings
 * - storage-handlers.js: Database, backup, export
 * - ai-handlers.js: LLM, RAG, whisper
 * - model-handlers.js: Downloads, conversion, library
 * - image-handlers.js: ComfyUI, image generation
 * 
 * This file is preserved for backwards compatibility and will be
 * gradually migrated to the modular architecture.
 */

const { dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');

// =============================================================================
// LAZY SERVICE LOADING - Services are loaded on-demand for faster startup
// =============================================================================
const { getService, startIdleCleanup } = require('./services/lazy-loader');

// Core services that need direct require (used at module level)
const { getPowerMode } = require('./services/power-mode');

// =============================================================================
// LAZY SERVICE GETTERS - Only load when first accessed
// =============================================================================

// Hardware & System
const getHardwareDetection = () => getService('hardware-detection');
const getNpuBridge = () => getService('npu-bridge')?.getNpuBridge?.() || null;
const npuSetupService = { 
  get checkDrivers() { return getService('npu-setup')?.checkDrivers; },
  get installDrivers() { return getService('npu-setup')?.installDrivers; },
  get getInstallationProgress() { return getService('npu-setup')?.getInstallationProgress; },
};

// AI Orchestration
const getOrchestrator = () => getService('inference-orchestrator')?.getOrchestrator?.() || null;
const getModelManager = () => getService('model-manager')?.getModelManager?.() || null;
// These are factory functions that need arguments
const getOllamaHelperFactory = () => getService('ollama-helper')?.getOllamaHelper || null;
const getImageBackendHelperFactory = () => getService('image-backend-helper')?.getImageBackendHelper || null;

// Export/Import
const exportService = {
  get exportConversation() { return getService('export-service')?.exportConversation; },
  get getExportFormats() { return getService('export-service')?.getExportFormats; },
};
const backupService = {
  get createBackup() { return getService('backup-service')?.createBackup; },
  get listBackups() { return getService('backup-service')?.listBackups; },
  get restoreBackup() { return getService('backup-service')?.restoreBackup; },
  get deleteBackup() { return getService('backup-service')?.deleteBackup; },
  get exportToZip() { return getService('backup-service')?.exportToZip; },
  get importFromZip() { return getService('backup-service')?.importFromZip; },
};
const modelDownloader = {
  get downloadModel() { return getService('model-downloader')?.downloadModel; },
  get getProgress() { return getService('model-downloader')?.getProgress; },
  get cancelDownload() { return getService('model-downloader')?.cancelDownload; },
};
const createModelConverter = () => getService('model-converter')?.createModelConverter?.() || null;

// AI Services
const whisperService = {
  get transcribe() { return getService('whisper-service')?.transcribe; },
};
const ragService = {
  get ingestDocument() { return getService('rag-service')?.ingestDocument; },
  get searchDocuments() { return getService('rag-service')?.searchDocuments; },
  get deleteDocument() { return getService('rag-service')?.deleteDocument; },
  get listDocuments() { return getService('rag-service')?.listDocuments; },
};

// Image Generation Services
const getImageService = () => getService('image-service')?.getImageService?.() || null;
const getComfyUIManager = () => getService('comfyui-manager')?.getComfyUIManager?.() || null;
const getImageBackendAuto = () => getService('image-backend-auto')?.getImageBackendAuto?.() || null;
const updaterService = {
  get checkForUpdates() { return getService('updater-service')?.checkForUpdates; },
  get downloadUpdate() { return getService('updater-service')?.downloadUpdate; },
  get installUpdate() { return getService('updater-service')?.installUpdate; },
};
const scanProject = (...args) => getService('project-scanner')?.scanProject?.(...args);

// Ledger - expose all methods used by setupLedgerHandlers
const ledgerService = {
  get initLedgerService() { return getService('ledger-service')?.initLedgerService; },
  get getSessionId() { return getService('ledger-service')?.getSessionId; },
  get recordEvent() { return getService('ledger-service')?.recordEvent; },
  get recordMessage() { return getService('ledger-service')?.recordMessage; },
  get recordWorkspaceSwitch() { return getService('ledger-service')?.recordWorkspaceSwitch; },
  get recordModelSwitch() { return getService('ledger-service')?.recordModelSwitch; },
  get recordGenerationStart() { return getService('ledger-service')?.recordGenerationStart; },
  get recordGenerationComplete() { return getService('ledger-service')?.recordGenerationComplete; },
  get recordFileOpen() { return getService('ledger-service')?.recordFileOpen; },
  get recordTypingBurst() { return getService('ledger-service')?.recordTypingBurst; },
  get recordUserAction() { return getService('ledger-service')?.recordUserAction; },
  get addEvidence() { return getService('ledger-service')?.addEvidence; },
  get getEvidence() { return getService('ledger-service')?.getEvidence; },
  get createRun() { return getService('ledger-service')?.createRun; },
  get updateRun() { return getService('ledger-service')?.updateRun; },
  get addRunStep() { return getService('ledger-service')?.addRunStep; },
  get getRunSteps() { return getService('ledger-service')?.getRunSteps; },
  get createDecisionFork() { return getService('ledger-service')?.createDecisionFork; },
  get listEvents() { return getService('ledger-service')?.listEvents; },
  get getSessionEvents() { return getService('ledger-service')?.getSessionEvents; },
  get getFrictionSignals() { return getService('ledger-service')?.getFrictionSignals; },
  get getStats() { return getService('ledger-service')?.getStats; },
  get verifyChain() { return getService('ledger-service')?.verifyChain; },
  get getSessionTimeline() { return getService('ledger-service')?.getSessionTimeline; },
  get clearEvents() { return getService('ledger-service')?.clearEvents; },
  get clearFrictionSignals() { return getService('ledger-service')?.clearFrictionSignals; },
  get clearAll() { return getService('ledger-service')?.clearAll; },
  get save() { return getService('ledger-service')?.save; },
};

// Soul Engine
const stateInference = {
  get inferState() { return getService('state-inference')?.inferState; },
};

// Intent Compiler
const intentSchema = {
  get createPlan() { return getService('intent-schema')?.createPlan; },
  get validatePlan() { return getService('intent-schema')?.validatePlan; },
};
const intentExecutor = {
  get executePlan() { return getService('intent-executor')?.executePlan; },
};

// LMA (Local Model Adaptation)
const llamaBridge = {
  get initialize() { return getService('llama-bridge')?.initialize; },
  get train() { return getService('llama-bridge')?.train; },
  get getTrainingStatus() { return getService('llama-bridge')?.getTrainingStatus; },
};
const datasetBuilder = {
  get buildFromFriction() { return getService('dataset-builder')?.buildFromFriction; },
};
const trainingScheduler = {
  get schedule() { return getService('training-scheduler')?.schedule; },
  get getSchedule() { return getService('training-scheduler')?.getSchedule; },
};
const ollamaAdapters = {
  get applyAdapter() { return getService('ollama-adapters')?.applyAdapter; },
  get listAdapters() { return getService('ollama-adapters')?.listAdapters; },
  get personalizeModel() { return getService('ollama-adapters')?.personalizeModel; },
  get checkPersonalizationStatus() { return getService('ollama-adapters')?.checkPersonalizationStatus; },
};

// Backwards compatibility alias - directly returns the service for method access
function getHardwareDetectionService() {
  return getService('hardware-detection');
}
const hardwareDetection = new Proxy({}, {
  get(_, prop) {
    const service = getHardwareDetectionService();
    return service ? service[prop] : undefined;
  }
});

// Database setup using sql.js (pure JS, no native compilation)
let db = null;
let dbPath = null;
let SQL = null;

async function initDatabase(userDataPath) {
  // Load sql.js
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  
  dbPath = path.join(userDataPath, 'devforge.db');
  
  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('Loaded existing database from', dbPath);
    } else {
      db = new SQL.Database();
      console.log('Created new database');
    }
  } catch (error) {
    console.error('Error loading database, creating new one:', error);
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      title TEXT,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      encrypted INTEGER DEFAULT 0
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens_used INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      settings TEXT,
      file_path TEXT,
      workspace TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT,
      appearance TEXT,
      workspace TEXT DEFAULT 'nsfw',
      avatar_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS nsfw_auth (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      variables TEXT,
      workspace TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS model_presets (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      top_p REAL DEFAULT 0.9,
      top_k INTEGER DEFAULT 40,
      context_length INTEGER,
      system_prompt TEXT,
      workspace TEXT,
      is_default INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_branch_id TEXT,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT,
      content_hash TEXT,
      chunk_count INTEGER,
      workspace TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      chunk_index INTEGER,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  // Backwards‑compatible schema migrations for branch support
  try {
    db.run(`ALTER TABLE messages ADD COLUMN branch_id TEXT`);
  } catch (error) {
    // Ignore if column already exists
  }
  try {
    db.run(`ALTER TABLE messages ADD COLUMN parent_message_id TEXT`);
  } catch (error) {
    // Ignore if column already exists
  }
  
  // Organization system migrations (folders, tags, pinned, starred)
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN starred INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN tags TEXT DEFAULT '[]'`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN folder_id TEXT`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN message_count INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN preview TEXT`);
  } catch (error) {
    // Column already exists
  }
  
  // Folders table for conversation organization (workspace-scoped)
  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'Folder',
      workspace TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_images_workspace ON generated_images(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_folder ON conversations(folder_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_starred ON conversations(starred)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_pinned ON conversations(pinned)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace)`);
  
  // Initialize Memory Engine for long conversation support
  try {
    const { getMemoryEngine } = require('./services/memory-engine');
    const memoryEngine = getMemoryEngine();
    memoryEngine.init(db);
    console.log('Memory Engine initialized');
  } catch (error) {
    console.error('Failed to initialize Memory Engine:', error);
  }
  
  // Initialize Soul Engine for personality persistence
  try {
    const { getSoulEngine } = require('./services/soul-engine');
    const soulEngine = getSoulEngine();
    soulEngine.init(db);
    console.log('Soul Engine awakened');
  } catch (error) {
    console.error('Failed to initialize Soul Engine:', error);
  }
  
  // Save to disk
  saveDatabase();
  
  return db;
}

function saveDatabase() {
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }
}

// Auto-save database periodically
setInterval(saveDatabase, 30000); // Every 30 seconds

// HTTP/HTTPS request helper
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    };
    
    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Track active streaming requests for cancellation
const activeStreams = new Map();

// Streaming request for LLM
function streamRequest(url, body, onChunk, channel) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = protocol.request(reqOptions, (res) => {
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            onChunk(parsed);
          } catch {
            // Ignore parse errors for partial chunks
          }
        }
      });
      res.on('end', () => {
        activeStreams.delete(channel);
        resolve();
      });
    });
    
    req.on('error', (error) => {
      activeStreams.delete(channel);
      reject(error);
    });
    
    // Store request for cancellation
    if (channel) {
      activeStreams.set(channel, req);
    }
    
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Guard against double registration during HMR
let handlersRegistered = false;

async function setupIpcHandlers(ipcMain, mainWindow, store) {
  // Prevent double registration during hot reload
  if (handlersRegistered) {
    console.log('IPC handlers already registered, skipping...');
    return;
  }
  handlersRegistered = true;
  
  const userDataPath = app.getPath('userData');
  const appPath = app.getAppPath();
  
  // Start automatic idle service cleanup (every 5 min, unload after 10 min idle)
  startIdleCleanup(5 * 60 * 1000, 10 * 60 * 1000);
  
  // Initialize database (must complete before services that depend on it)
  try {
    await initDatabase(userDataPath);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
  
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    app.quit();
    return true;
  });
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());
  
  // Settings
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value));
  
  // Batched settings - reduces IPC overhead for multiple settings
  ipcMain.handle('store:getBatch', (_, keys) => {
    if (!Array.isArray(keys)) return {};
    const result = {};
    for (const key of keys) {
      result[key] = store.get(key);
    }
    return result;
  });
  
  ipcMain.handle('store:setBatch', (_, settings) => {
    if (!settings || typeof settings !== 'object') return false;
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value);
    }
    return true;
  });
  
  // Sovereignty Status - reports whether app is running in local-only mode
  ipcMain.handle('sovereignty:getStatus', async () => {
    const settings = store.get('settings') || {};
    const llmEndpoint = store.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const isLocalEndpoint = llmEndpoint.includes('127.0.0.1') || llmEndpoint.includes('localhost');
    
    return {
      localOnly: isLocalEndpoint && settings.localOnly !== false,
      llmEndpoint,
      isLocalEndpoint,
      networkAllowed: settings.allowExternalConnections === true,
      timestamp: Date.now(),
    };
  });
  
  // LLM Communication (Ollama API compatible)
  ipcMain.handle('llm:send', async (_, payload) => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          model: payload.model,
          prompt: payload.prompt,
          system: payload.system,
          stream: false,
          options: payload.options || {}
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`LLM request failed: ${error.message}`);
    }
  });
  
  ipcMain.handle('llm:stream', async (_, payload) => {
    const endpoint = store.get('llmEndpoint');
    const { channel, ...rest } = payload;
    
    try {
      await streamRequest(
        `${endpoint}/api/generate`,
        {
          model: rest.model,
          prompt: rest.prompt,
          system: rest.system,
          stream: true,
          options: rest.options || {}
        },
        (chunk) => {
          mainWindow.webContents.send(channel, chunk);
        },
        channel
      );
      mainWindow.webContents.send(channel, { done: true });
    } catch (error) {
      activeStreams.delete(channel);
      mainWindow.webContents.send(channel, { error: error.message });
    }
  });
  
  ipcMain.handle('llm:cancel', (_, channel) => {
    const req = activeStreams.get(channel);
    if (req) {
      req.destroy();
      activeStreams.delete(channel);
      mainWindow.webContents.send(channel, { cancelled: true });
      return { success: true };
    }
    return { success: false, error: 'Stream not found' };
  });
  
  ipcMain.handle('llm:unload', async () => {
    return { success: true, message: 'Model unload not required (Ollama manages memory automatically)' };
  });
  
  ipcMain.handle('llm:health', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`, { timeout: 5000 });
      return { 
        healthy: true, 
        status: response.status === 200 ? 'online' : 'error',
        models: response.data?.models?.length || 0
      };
    } catch (error) {
      return { 
        healthy: false, 
        status: 'offline',
        error: error.message 
      };
    }
  });
  
  ipcMain.handle('llm:models', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`);
      return response.data.models || [];
    } catch {
      return [];
    }
  });
  
  ipcMain.handle('llm:load', async (_, modelPath) => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/pull`, {
        method: 'POST',
        body: { name: modelPath }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to load model: ${error.message}`);
    }
  });
  
  // Warmup/preload a model onto GPU
  ipcMain.handle('llm:warmup', async (_, modelName) => {
    const endpoint = store.get('llmEndpoint');
    console.log(`[IPC] Warming up model: ${modelName}`);
    try {
      // Send a minimal generation request to force Ollama to load the model into GPU
      const response = await makeRequest(`${endpoint}/api/generate`, {
        method: 'POST',
        body: {
          model: modelName,
          prompt: 'Hi',
          stream: false,
          options: {
            num_gpu: -1, // Full GPU offload
            num_predict: 1, // Only generate 1 token
            num_ctx: 512, // Minimal context
          }
        },
        timeout: 120000 // 2 minutes for initial model load
      });
      console.log(`[IPC] Model ${modelName} warmed up successfully`);
      return { success: true, model: modelName, response: response.data?.response };
    } catch (error) {
      console.error(`[IPC] Warmup failed:`, error.message);
      return { success: false, error: error.message };
    }
  });
  
  // Get currently running/loaded models
  ipcMain.handle('llm:running', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/ps`, { timeout: 5000 });
      return response.data?.models || [];
    } catch {
      return [];
    }
  });
  
  // Image Generation (ComfyUI API compatible)
  ipcMain.handle('image:generate', async (_, payload) => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload.workflow,
        timeout: 300000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Image generation failed: ${error.message}`);
    }
  });
  
  ipcMain.handle('image:models', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/object_info/CheckpointLoaderSimple`);
      return response.data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    } catch {
      return [];
    }
  });
  
  const activeImageJobs = new Map();
  
  ipcMain.handle('image:interrupt', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/interrupt`, {
        method: 'POST',
        timeout: 5000
      });
      activeImageJobs.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('image:health', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/system_stats`, { timeout: 5000 });
      return { 
        healthy: true, 
        status: response.status === 200 ? 'online' : 'error'
      };
    } catch (error) {
      return { 
        healthy: false, 
        status: 'offline',
        error: error.message 
      };
    }
  });

  // ============================================
  // ComfyUI Manager - Local Image Generation
  // Fully offline, unrestricted, NSFW-capable
  // ============================================
  
  ipcMain.handle('comfyui:getStatus', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { installed: false, running: false, error: 'ComfyUI manager not available' };
      }
      return await manager.getStatus();
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:install', async (_, options = {}) => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.install(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:start', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:stop', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:downloadModel', async (_, model) => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.downloadModel(model, (progress) => {
        mainWindow?.webContents?.send('comfyui:downloadProgress', { 
          modelId: model.id || model.name, 
          ...progress 
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:getAvailableModels', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return manager.getAvailableModels();
    } catch (error) {
      return {};
    }
  });

  ipcMain.handle('comfyui:getInstalledModels', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.getInstalledModels();
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('comfyui:getSetupInstructions', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return manager.getSetupInstructions();
    } catch (error) {
      return { error: error.message };
    }
  });

  // Main image generation handler using ImageService
  ipcMain.handle('getImageStatus', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        // Fall back to ComfyUI manager status
        const comfyManager = getComfyUIManager();
        if (comfyManager) {
          const status = await comfyManager.getStatus();
          return {
            running: status.running,
            backend: status.running ? 'comfyui' : null,
            backendName: 'ComfyUI',
            endpoint: `http://localhost:${status.port}`,
            models: status.models || []
          };
        }
        return { running: false, error: 'Image service not available' };
      }
      
      // Initialize if needed
      if (!imageService.isInitialized) {
        await imageService.initialize();
      }
      
      return await imageService.getStatus();
    } catch (error) {
      return { running: false, error: error.message };
    }
  });

  ipcMain.handle('generateImage', async (_, params) => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        throw new Error('Image service not available. Please install ComfyUI first.');
      }
      
      // Initialize if needed
      if (!imageService.isInitialized) {
        await imageService.initialize();
      }
      
      return await imageService.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detectImageBackend', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return { running: false, backend: null };
      }
      return await imageService.detectBackend();
    } catch (error) {
      return { running: false, error: error.message };
    }
  });

  ipcMain.handle('pollImageResult', async (_, promptId) => {
    try {
      const imageService = getImageService();
      if (!imageService) throw new Error('Image service not available');
      return await imageService.pollComfyUIResult(promptId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getImagePresets', async () => {
    try {
      const imageService = getImageService();
      if (imageService) {
        return imageService.getModelPresets();
      }
      // Return default presets
      return {
        sd15: { name: 'SD 1.5', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7 },
        sdxl: { name: 'SDXL', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 25, defaultCfg: 7 },
        flux: { name: 'Flux', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 20, defaultCfg: 1 }
      };
    } catch (error) {
      return {};
    }
  });

  // ============================================
  // Auto Image Backend - Fully Self-Contained
  // One-click setup, no manual configuration
  // ============================================

  ipcMain.handle('imageAuto:getStatus', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) return { installed: false, running: false, error: 'Backend not available' };
      return await backend.getStatus();
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:setup', async (_, options = {}) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      
      // Set up event forwarding
      backend.onEvent((event, data) => {
        mainWindow?.webContents?.send('imageAuto:event', { event, ...data });
      });
      
      return await backend.autoSetup(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:start', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:stop', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:generate', async (_, params) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:downloadModel', async (_, { url, filename }) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.downloadModel(url, filename, (progress) => {
        mainWindow?.webContents?.send('imageAuto:downloadProgress', progress);
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:ensureRunning', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.ensureRunning();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // =============================================================================
  // MEMORY ENGINE - Long conversation memory support
  // =============================================================================
  
  ipcMain.handle('memory:buildContext', async (_, { conversationId, workspace, messages, options }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.buildContext(conversationId, workspace, messages, options);
    } catch (error) {
      console.error('[Memory] buildContext error:', error);
      return { contextText: '', parts: [], totalTokens: 0, messagesIncluded: messages?.length || 0 };
    }
  });

  ipcMain.handle('memory:extractMemories', async (_, { conversationId, messages, workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.extractMemories(conversationId, messages, workspace);
    } catch (error) {
      console.error('[Memory] extractMemories error:', error);
      return [];
    }
  });

  ipcMain.handle('memory:updateSummary', async (_, { conversationId, messages, workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.updateSummary(conversationId, messages, workspace);
    } catch (error) {
      console.error('[Memory] updateSummary error:', error);
      return null;
    }
  });

  ipcMain.handle('memory:pinMessage', async (_, { messageId, conversationId, reason }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.pinMessage(messageId, conversationId, reason);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:unpinMessage', async (_, { messageId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.unpinMessage(messageId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getPinned', async (_, { conversationId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getPinnedMessages(conversationId);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('memory:isMessagePinned', async (_, { messageId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.isMessagePinned(messageId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getMemories', async (_, { workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getWorkspaceMemories(workspace);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('memory:addMemory', async (_, memory) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.addMemory(memory);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('memory:deleteMemory', async (_, { memoryId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.deleteMemory(memoryId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getStats', async (_, { workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getStats(workspace);
    } catch (error) {
      return { memories: 0, summaries: 0, pinned: 0 };
    }
  });

  // =============================================================================
  // SOUL ENGINE - Personality persistence and adaptive behavior
  // =============================================================================
  
  ipcMain.handle('soul:getSoul', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().getSoul();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('soul:getStats', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().getStats();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('soul:recordInteraction', async (_, data) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      await getSoulEngine().recordInteraction(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('soul:recordFeedback', async (_, { signal, messageId, value, context }) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      await getSoulEngine().recordFeedback(signal, messageId, value, context);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('soul:getPersonalizedPrompt', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().generatePersonalizedPrompt();
    } catch (error) {
      return '';
    }
  });

  ipcMain.handle('soul:updateUserInfo', async (_, updates) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      getSoulEngine().updateUserInfo(updates);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });

  ipcMain.handle('soul:reset', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      getSoulEngine().reset();
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });
  
  // File System
  ipcMain.handle('fs:selectFile', async (_, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options.properties || ['openFile'],
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  
  ipcMain.handle('fs:selectFolder', async (_, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      ...options
    });
    return result.canceled ? null : result.filePaths[0];
  });

  /**
   * Agent terminal execution (guarded).
   */
  ipcMain.handle('agent:runCommand', async (_, payload = {}) => {
    const { command, cwd: requestedCwd, timeout = 20000 } = payload;
    if (!command || typeof command !== 'string') {
      return { success: false, error: 'No command provided' };
    }

    const forbidden = ['rm -rf', 'rm -r', 'del /s', 'format', 'shutdown', 'mkfs'];
    if (forbidden.some((token) => command.toLowerCase().includes(token))) {
      return { success: false, error: 'Command blocked by safety guard' };
    }

    const cwd = requestedCwd && typeof requestedCwd === 'string' ? requestedCwd : process.cwd();

    return await new Promise((resolve) => {
      const child = exec(command, { cwd, timeout }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            code: error.code,
            error: error.message,
            stdout,
            stderr,
          });
        } else {
          resolve({
            success: true,
            code: 0,
            stdout,
            stderr,
          });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  });
  
  ipcMain.handle('fs:readFile', async (_, filePath) => {
    return await fsPromises.readFile(filePath, 'utf-8');
  });
  
  ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:createFolder', async (_, folderPath) => {
    await fsPromises.mkdir(folderPath, { recursive: true });
    return true;
  });
  
  ipcMain.handle('fs:listModels', async (_, directory) => {
    try {
      const files = await fsPromises.readdir(directory, { withFileTypes: true });
      return files
        .filter(f => f.isFile() && (f.name.endsWith('.gguf') || f.name.endsWith('.bin')))
        .map(f => ({ name: f.name, path: path.join(directory, f.name) }));
    } catch {
      return [];
    }
  });

  // ============================================
  // Screenshot Capture
  // ============================================
  
  ipcMain.handle('captureScreenshot', async () => {
    try {
      const { captureScreen } = require('./services/screenshot-service');
      const result = await captureScreen();
      
      if (result.success) {
        // Read the file and return as data URL
        const imageBuffer = await fsPromises.readFile(result.filePath);
        const base64 = imageBuffer.toString('base64');
        return `data:image/png;base64,${base64}`;
      } else {
        console.error('Screenshot capture failed:', result.error);
        return null;
      }
    } catch (error) {
      console.error('Screenshot capture error:', error);
      return null;
    }
  });

  // ============================================
  // Project Scanning (Code Workspace)
  // ============================================
  
  ipcMain.handle('project:scan', async (_, rootPath, options = {}) => {
    try {
      return scanProject(rootPath, options);
    } catch (error) {
      console.error('Failed to scan project:', error);
      return { root: '', tree: [] };
    }
  });

  // ============================================
  // Conversation Export
  // ============================================

  ipcMain.handle('export:selectDestination', async (_, options) => {
    const { scope, defaultPath, defaultFileName } = options || {};

    if (scope === 'all') {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select export folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: defaultPath || app.getPath('documents'),
      });
      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true };
      }
      return { canceled: false, directory: result.filePaths[0] };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export conversation',
      defaultPath:
        defaultFileName ||
        path.join(defaultPath || app.getPath('documents'), 'conversation.txt'),
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('export:conversation', async (_, { conversationId, format, targetPath }) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const filePath = await exportService.exportConversation(db, conversationId, format, targetPath);
      return { success: true, filePath };
    } catch (error) {
      console.error('Failed to export conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:allConversations', async (_, { format, directory }) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const results = await exportService.exportAllConversations(db, format, directory);
      return { success: true, results };
    } catch (error) {
      console.error('Failed to export conversations:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Backup & Restore
  // ============================================

  ipcMain.handle('backup:create', async (_, { targetPath }) => {
    try {
      const filePath = await backupService.createBackup({
        dbPath,
        store,
        targetPath,
      });
      return { success: true, filePath };
    } catch (error) {
      console.error('Failed to create backup:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:restore', async (_, { backupPath }) => {
    try {
      const result = await backupService.restoreBackup({
        backupPath,
        dbPath,
        store,
      });
      return { success: true, ...result, requiresRestart: true };
    } catch (error) {
      console.error('Failed to restore backup:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('backup:schedule', (_, schedule) => {
    try {
      store.set('backupSchedule', schedule || null);
      return { success: true };
    } catch (error) {
      console.error('Failed to save backup schedule:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('backup:list', async () => {
    const backups = [];
    const docsDir = app.getPath('documents');
    try {
      const entries = await fsPromises.readdir(docsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          (entry.name.endsWith('.devforge-backup') || entry.name.startsWith('devforge-backup-'))
        ) {
          const fullPath = path.join(docsDir, entry.name);
          const stat = await fsPromises.stat(fullPath);
          backups.push({
            name: entry.name,
            path: fullPath,
            size: stat.size,
            modified: stat.mtime,
          });
        }
      }
    } catch (error) {
      console.error('Failed to list backups:', error);
    }
    return backups;
  });
  
  // Database operations using sql.js
  ipcMain.handle('db:query', (_, sql, params = []) => {
    if (!db) return [];
    try {
    const stmt = db.prepare(sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('DB query error:', error);
      return [];
    }
  });

  // ============================================
  // Voice (Whisper)
  // ============================================

  ipcMain.handle('voice:check', () => {
    try {
      return whisperService.isAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  ipcMain.handle('voice:transcribe', async (_, { audioData }) => {
    try {
      if (!audioData) {
        throw new Error('No audio data provided');
      }
      const buffer = Buffer.from(audioData);
      const result = await whisperService.transcribeBuffer(buffer);
      return { success: true, text: result.text };
    } catch (error) {
      console.error('Voice transcription failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Documents / RAG
  // ============================================

  ipcMain.handle('documents:ingest', async (_, { filePath, workspace }) => {
    try {
      const doc = await ragService.ingestDocument(db, store, filePath, workspace);
      saveDatabase();
      return { success: true, document: doc };
    } catch (error) {
      console.error('Failed to ingest document:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:list', (_, { workspace }) => {
    try {
      return ragService.listDocuments(db, workspace);
    } catch (error) {
      console.error('Failed to list documents:', error);
      return [];
    }
  });

  ipcMain.handle('documents:delete', (_, id) => {
    const res = ragService.deleteDocument(db, id);
    if (res.success) {
      saveDatabase();
    }
    return res;
  });

  ipcMain.handle('documents:search', async (_, { workspace, query, limit }) => {
    try {
      const matches = await ragService.searchDocuments(db, store, workspace, query, limit || 4);
      return matches;
    } catch (error) {
      console.error('Failed to search documents:', error);
      return [];
    }
  });

  ipcMain.handle('rag:exportWorkspace', async (_, { workspace }) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export knowledge pack',
        filters: [{ name: 'DevForge Knowledge Pack', extensions: ['devforge-knowledge'] }],
        defaultPath: path.join(app.getPath('documents'), 'workspace.devforge-knowledge'),
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      const exportResult = await ragService.exportWorkspace(db, workspace, result.filePath);
      saveDatabase();
      return { success: true, filePath: result.filePath, ...exportResult };
    } catch (error) {
      console.error('Failed to export knowledge pack:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:importWorkspace', async (_, { workspace }) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import knowledge pack',
        filters: [{ name: 'DevForge Knowledge Pack', extensions: ['devforge-knowledge', 'json'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true };
      }
      const importResult = await ragService.importWorkspace(db, workspace, result.filePaths[0]);
      saveDatabase();
      return { success: true, ...importResult };
    } catch (error) {
      console.error('Failed to import knowledge pack:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Auto‑update
  // ============================================

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await updaterService.checkForUpdates();
      return result;
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return { supported: updaterService.isSupported(), error: error.message };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      const result = await updaterService.downloadUpdate();
      return result;
    } catch (error) {
      console.error('Failed to download update:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('updater:install', async () => {
    try {
      const result = await updaterService.installUpdate();
      return result;
    } catch (error) {
      console.error('Failed to install update:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('db:run', (_, sql, params = []) => {
    if (!db) return { changes: 0 };
    try {
      db.run(sql, params);
      saveDatabase(); // Save after each write
      return { changes: db.getRowsModified() };
    } catch (error) {
      console.error('DB run error:', error);
      return { changes: 0, error: error.message };
    }
  });
  
  // =============================================================================
  // ORGANIZATION SYSTEM - Folders, Tags, Pin/Star
  // =============================================================================
  
  // Get all folders for a workspace
  ipcMain.handle('folders:list', async (_, workspace) => {
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT * FROM folders WHERE workspace = ? ORDER BY sort_order ASC, name ASC');
      stmt.bind([workspace]);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('Failed to list folders:', error);
      return [];
    }
  });
  
  // Create a new folder
  ipcMain.handle('folders:create', async (_, { id, name, color, icon, workspace, parentId }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Get next sort order
      const countResult = db.exec(`SELECT COUNT(*) as count FROM folders WHERE workspace = ?`, [workspace]);
      const sortOrder = countResult.length > 0 && countResult[0].values.length > 0 
        ? countResult[0].values[0][0] 
        : 0;
      
      db.run(
        `INSERT INTO folders (id, name, color, icon, workspace, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, color || '#6366f1', icon || 'Folder', workspace, parentId || null, sortOrder]
      );
      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to create folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update a folder
  ipcMain.handle('folders:update', async (_, { id, name, color, icon, sortOrder }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const updates = [];
      const params = [];
      
      if (name !== undefined) { updates.push('name = ?'); params.push(name); }
      if (color !== undefined) { updates.push('color = ?'); params.push(color); }
      if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
      if (sortOrder !== undefined) { updates.push('sort_order = ?'); params.push(sortOrder); }
      
      if (updates.length === 0) return { success: true };
      
      params.push(id);
      db.run(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to update folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Delete a folder (moves conversations to unfiled)
  ipcMain.handle('folders:delete', async (_, folderId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Move conversations to unfiled (null folder_id)
      db.run('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?', [folderId]);
      // Delete the folder
      db.run('DELETE FROM folders WHERE id = ?', [folderId]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Move conversation to folder
  ipcMain.handle('conversation:moveToFolder', async (_, { conversationId, folderId }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET folder_id = ? WHERE id = ?', [folderId, conversationId]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to move conversation to folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Toggle conversation starred status
  ipcMain.handle('conversation:toggleStar', async (_, conversationId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = ?', [conversationId]);
      saveDatabase();
      // Return new value
      const result = db.exec('SELECT starred FROM conversations WHERE id = ?', [conversationId]);
      const starred = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
      return { success: true, starred: starred === 1 };
    } catch (error) {
      console.error('Failed to toggle star:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Toggle conversation pinned status
  ipcMain.handle('conversation:togglePin', async (_, conversationId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?', [conversationId]);
      saveDatabase();
      // Return new value
      const result = db.exec('SELECT pinned FROM conversations WHERE id = ?', [conversationId]);
      const pinned = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
      return { success: true, pinned: pinned === 1 };
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update conversation tags (JSON array)
  ipcMain.handle('conversation:setTags', async (_, { conversationId, tags }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const tagsJson = JSON.stringify(tags || []);
      db.run('UPDATE conversations SET tags = ? WHERE id = ?', [tagsJson, conversationId]);
      saveDatabase();
      return { success: true, tags };
    } catch (error) {
      console.error('Failed to set tags:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update conversation preview and message count
  ipcMain.handle('conversation:updateMeta', async (_, { conversationId, preview, messageCount }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const updates = [];
      const params = [];
      
      if (preview !== undefined) { updates.push('preview = ?'); params.push(preview); }
      if (messageCount !== undefined) { updates.push('message_count = ?'); params.push(messageCount); }
      
      if (updates.length === 0) return { success: true };
      
      params.push(conversationId);
      db.run(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to update conversation meta:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get all unique tags for a workspace (for auto-suggest)
  ipcMain.handle('tags:listForWorkspace', async (_, workspace) => {
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT tags FROM conversations WHERE workspace = ? AND tags IS NOT NULL AND tags != "[]"');
      stmt.bind([workspace]);
      const allTags = new Set();
      while (stmt.step()) {
        const row = stmt.getAsObject();
        try {
          const tags = JSON.parse(row.tags || '[]');
          tags.forEach(tag => allTags.add(tag));
        } catch { /* ignore invalid JSON */ }
      }
      stmt.free();
      return Array.from(allTags).sort();
    } catch (error) {
      console.error('Failed to list tags:', error);
      return [];
    }
  });
  
  // NSFW Password Management
  ipcMain.handle('nsfw:setPassword', async (_, password) => {
    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    
    try {
      const existing = db.exec("SELECT * FROM nsfw_auth WHERE id = 'nsfw'");
      
      if (existing.length > 0 && existing[0].values.length > 0) {
        db.run("UPDATE nsfw_auth SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = 'nsfw'", [hash, salt]);
      } else {
        db.run("INSERT INTO nsfw_auth (id, password_hash, salt) VALUES ('nsfw', ?, ?)", [hash, salt]);
      }
      
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to set password:', error);
      throw error;
    }
  });
  
  ipcMain.handle('nsfw:verifyPassword', async (_, password) => {
    try {
      const result = db.exec("SELECT password_hash, salt FROM nsfw_auth WHERE id = 'nsfw'");
      
      if (!result.length || !result[0].values.length) {
        return { verified: false, error: 'No password set' };
      }
      
      const [storedHash, salt] = result[0].values[0];
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      
      const verified = crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(storedHash)
      );
      
      return { verified };
    } catch (error) {
      return { verified: false, error: error.message };
    }
  });
  
  ipcMain.handle('nsfw:hasPassword', async () => {
    try {
      const result = db.exec("SELECT * FROM nsfw_auth WHERE id = 'nsfw'");
      return { hasPassword: result.length > 0 && result[0].values.length > 0 };
    } catch {
      return { hasPassword: false };
    }
  });
  
  // Encryption
  ipcMain.handle('crypto:encrypt', (_, data, password) => {
    if (!password) {
      throw new Error('Password required for encryption');
    }
    
    const algorithm = 'aes-256-gcm';
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      authTag: authTag.toString('hex')
    };
  });
  
  ipcMain.handle('crypto:decrypt', (_, data, password) => {
    if (!password) {
      throw new Error('Password required for decryption');
    }
    
    const algorithm = 'aes-256-gcm';
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.scryptSync(password, salt, 32);
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
    
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  });
  
  // App Info
  ipcMain.handle('app:getPath', () => userDataPath);
  ipcMain.handle('app:getVersion', () => app.getVersion());
  
  // Shell
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('shell:openPath', (_, path) => shell.openPath(path));
  
  // GPU Info (legacy - kept for compatibility)
  ipcMain.handle('system:gpuInfo', async () => {
    try {
      const gpuInfo = await app.getGPUInfo('complete');
      return gpuInfo;
    } catch {
      return null;
    }
  });

  // ============================================
  // Hardware Detection & Monitoring
  // ============================================
  
  // Full hardware detection (GPUs, NPU, CPU, RAM)
  ipcMain.handle('hardware:detect', async () => {
    if (!hardwareDetection) {
      return { error: 'Hardware detection not available - systeminformation package not installed' };
    }
    try {
      return await hardwareDetection.detectHardware();
    } catch (error) {
      console.error('Hardware detection failed:', error);
      return { error: error.message };
    }
  });

  // Real-time hardware statistics
  ipcMain.handle('hardware:getStats', async () => {
    if (!hardwareDetection) {
      return { error: 'Hardware detection not available', cpu: { usage: 0 }, memory: { usagePercent: 0 }, gpus: [] };
    }
    try {
      return await hardwareDetection.getHardwareStats();
    } catch (error) {
      console.error('Failed to get hardware stats:', error);
      return { error: error.message };
    }
  });

  // Detailed GPU information
  ipcMain.handle('hardware:getGpuInfo', async () => {
    if (!hardwareDetection) {
      return [];
    }
    try {
      return await hardwareDetection.getGpuInfo();
    } catch (error) {
      console.error('Failed to get GPU info:', error);
      return { error: error.message };
    }
  });

  // Check CUDA availability
  ipcMain.handle('hardware:checkCuda', async () => {
    if (!hardwareDetection) {
      return { available: false, error: 'Hardware detection not available' };
    }
    try {
      return await hardwareDetection.checkCudaAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  // Check Vulkan availability
  ipcMain.handle('hardware:checkVulkan', async () => {
    if (!hardwareDetection) {
      return { available: false, error: 'Hardware detection not available' };
    }
    try {
      return await hardwareDetection.checkVulkanAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  // Clear hardware cache (useful after driver updates)
  ipcMain.handle('hardware:clearCache', () => {
    if (hardwareDetection) {
      hardwareDetection.clearCache();
    }
    return { success: true };
  });

  ipcMain.handle('ollama:status', async () => {
    try {
      const endpoint = store.get('llmEndpoint') || 'http://localhost:11434';
      return await ollamaHelper.getStatus(endpoint);
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:start', async () => {
    try {
      return await ollamaHelper.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:stop', async () => {
    try {
      return await ollamaHelper.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:install', async () => {
    try {
      return await ollamaHelper.install();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Create Ollama model from local GGUF file
  ipcMain.handle('ollama:createFromFile', async (_, { name, path: modelPath }) => {
    const { spawn } = require('child_process');
    const os = require('os');
    
    try {
      // Create a temporary Modelfile
      const modelfilePath = path.join(os.tmpdir(), `Modelfile-${Date.now()}`);
      const modelfileContent = `FROM "${modelPath.replace(/\\/g, '/')}"`;
      
      await fsPromises.writeFile(modelfilePath, modelfileContent, 'utf-8');
      console.log(`[Ollama] Created Modelfile at ${modelfilePath}`);
      console.log(`[Ollama] Creating model "${name}" from ${modelPath}`);
      
      return new Promise((resolve) => {
        const proc = spawn('ollama', ['create', name, '-f', modelfilePath], {
          shell: true,
          env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[Ollama create]', data.toString().trim());
        });
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[Ollama create stderr]', data.toString().trim());
        });
        
        proc.on('close', async (code) => {
          // Clean up Modelfile
          try {
            await fsPromises.unlink(modelfilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            resolve({ 
              success: true, 
              name,
              message: `Model "${name}" created successfully from ${path.basename(modelPath)}`
            });
          } else {
            resolve({ 
              success: false, 
              error: stderr || `ollama create failed with code ${code}`,
              stdout,
              stderr
            });
          }
        });
        
        proc.on('error', (error) => {
          resolve({ 
            success: false, 
            error: `Failed to run ollama: ${error.message}. Make sure Ollama is installed and in your PATH.`
          });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:status', async () => {
    try {
      const endpoint = store.get('imageGenEndpoint');
      return await imageBackendHelper.getStatus(endpoint);
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:start', async (_, command) => {
    try {
      const cmd = command || store.get('imageBackendStartCommand');
      return await imageBackendHelper.start(cmd);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:stop', async (_, command) => {
    try {
      const cmd = command || store.get('imageBackendStopCommand');
      return await imageBackendHelper.stop(cmd);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:install', async () => {
    try {
      return await imageBackendHelper.openInstallPage();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // NPU / OpenVINO Helper
  // ============================================

  const npuBridge = getNpuBridge();

  ipcMain.handle('npu:getStatus', async () => {
    try {
      return await npuBridge.getStatus();
    } catch (error) {
      console.error('Failed to get NPU status:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('npu:startServer', async () => {
    try {
      const result = await npuBridge.startServer();
      return result;
    } catch (error) {
      console.error('Failed to start NPU server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('npu:stopServer', async () => {
    try {
      const result = await npuBridge.stopServer();
      return result;
    } catch (error) {
      console.error('Failed to stop NPU server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('npu:setup', async () => {
    try {
      const result = await npuSetupService.runOpenVinoSetup(appPath);
      return result;
    } catch (error) {
      console.error('Failed to run OpenVINO setup script:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Power Mode
  // ============================================
  
  const powerMode = getPowerMode();

  ipcMain.handle('powerMode:enable', async () => {
    try {
      return await powerMode.enable();
    } catch (error) {
      console.error('Failed to enable power mode:', error);
      return { enabled: false, error: error.message };
    }
  });

  ipcMain.handle('powerMode:disable', async () => {
    try {
      return await powerMode.disable();
    } catch (error) {
      console.error('Failed to disable power mode:', error);
      return { enabled: true, error: error.message };
    }
  });

  ipcMain.handle('powerMode:getStatus', () => {
    return powerMode.getStatus();
  });

  ipcMain.handle('powerMode:getMemoryInfo', () => {
    return powerMode.getMemoryInfo();
  });

  ipcMain.handle('powerMode:suggestModelSize', () => {
    return powerMode.suggestModelSize();
  });

  // ============================================
  // Backend Management (Orchestrator)
  // ============================================
  
  let orchestrator = null;
  if (getOrchestrator) {
    orchestrator = getOrchestrator(store);
    
    // Initialize orchestrator
    orchestrator.initialize().catch(error => {
      console.error('Failed to initialize orchestrator:', error);
    });
  }

  ipcMain.handle('llm:getBackends', async () => {
    if (!orchestrator) {
      return [{ id: 'ollama-cpu', name: 'Ollama (CPU)', available: true, status: 'default' }];
    }
    try {
      return await orchestrator.getAvailableBackends();
    } catch (error) {
      console.error('Failed to get backends:', error);
      return [];
    }
  });

  ipcMain.handle('llm:setBackend', async (_, backendId) => {
    if (!orchestrator) {
      return { error: 'Orchestrator not available' };
    }
    try {
      return await orchestrator.setPreferredBackend(backendId);
    } catch (error) {
      console.error('Failed to set backend:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('llm:getCurrentBackend', () => {
    if (!orchestrator) {
      return { id: 'ollama-cpu', name: 'Ollama (CPU)' };
    }
    return orchestrator.getCurrentBackend();
  });

  ipcMain.handle('llm:getProfile', () => {
    if (!orchestrator) {
      return 'balanced';
    }
    return orchestrator.getProfile();
  });

  ipcMain.handle('llm:setProfile', (_, profile) => {
    if (!orchestrator) {
      return { success: false, error: 'Orchestrator not available' };
    }
    orchestrator.setProfile(profile);
    return { success: true, profile: orchestrator.getProfile() };
  });

  ipcMain.handle('llm:getRecommendation', (_, modelParams) => {
    if (!orchestrator) {
      return [];
    }
    return orchestrator.getRecommendation(modelParams);
  });

  // ============================================
  // Prompt Templates
  // ============================================

  ipcMain.handle('templates:list', (_, workspace) => {
    if (!db) return [];
    try {
      const where = workspace ? "WHERE workspace = ? OR workspace IS NULL OR workspace = ''" : '';
      const params = workspace ? [workspace] : [];
      const result = db.exec(
        `SELECT id, name, content, variables, workspace, category, created_at FROM templates ${where} ORDER BY created_at DESC`,
        params,
      );
      if (!result.length) return [];
      return result[0].values.map(([id, name, content, variables, ws, category, createdAt]) => ({
        id,
        name,
        content,
        variables,
        workspace: ws,
        category,
        created_at: createdAt,
      }));
    } catch (error) {
      console.error('Failed to list templates:', error);
      return [];
    }
  });

  ipcMain.handle('templates:save', (_, template) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const id =
        template.id ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
      const vars =
        typeof template.variables === 'string'
          ? template.variables
          : JSON.stringify(template.variables || []);

      db.run(
        `
        INSERT INTO templates (id, name, content, variables, workspace, category, created_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          content = excluded.content,
          variables = excluded.variables,
          workspace = excluded.workspace,
          category = excluded.category
      `,
        [id, template.name, template.content, vars, template.workspace || null, template.category || null, template.created_at || null],
      );

      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to save template:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('templates:delete', (_, id) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('DELETE FROM templates WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete template:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Model Presets
  // ============================================

  ipcMain.handle('presets:getForModel', (_, { modelName, workspace }) => {
    if (!db) return [];
    try {
      const result = db.exec(
        `
        SELECT id, model_name, temperature, top_p, top_k, context_length, system_prompt, workspace, is_default
        FROM model_presets
        WHERE model_name = ?
          AND (workspace IS NULL OR workspace = '' OR workspace = ?)
        ORDER BY is_default DESC, created_at DESC
      `,
        [modelName, workspace || null],
      );
      if (!result.length) return [];
      return result[0].values.map(
        ([
          id,
          model_name,
          temperature,
          top_p,
          top_k,
          context_length,
          system_prompt,
          ws,
          is_default,
        ]) => ({
          id,
          model_name,
          temperature,
          top_p,
          top_k,
          context_length,
          system_prompt,
          workspace: ws,
          is_default: !!is_default,
        }),
      );
    } catch (error) {
      console.error('Failed to load model presets:', error);
      return [];
    }
  });

  ipcMain.handle('presets:save', (_, preset) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const id =
        preset.id ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
      const values = [
        id,
        preset.model_name,
        preset.temperature ?? 0.7,
        preset.top_p ?? 0.9,
        preset.top_k ?? 40,
        preset.context_length || null,
        preset.system_prompt || null,
        preset.workspace || null,
        preset.is_default ? 1 : 0,
      ];

      db.run(
        `
        INSERT INTO model_presets (id, model_name, temperature, top_p, top_k, context_length, system_prompt, workspace, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          model_name = excluded.model_name,
          temperature = excluded.temperature,
          top_p = excluded.top_p,
          top_k = excluded.top_k,
          context_length = excluded.context_length,
          system_prompt = excluded.system_prompt,
          workspace = excluded.workspace,
          is_default = excluded.is_default
      `,
        values,
      );

      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to save model preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('presets:delete', (_, id) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('DELETE FROM model_presets WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete model preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('presets:setDefault', (_, { id, modelName, workspace }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Clear previous defaults for this model/workspace
      db.run(
        `
        UPDATE model_presets
        SET is_default = 0
        WHERE model_name = ?
          AND (workspace IS NULL OR workspace = '' OR workspace = ?)
      `,
        [modelName, workspace || null],
      );

      db.run('UPDATE model_presets SET is_default = 1 WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to set default preset:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Model Download Manager
  // ============================================

  ipcMain.handle('models:browse', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`);
      const models = response.data?.models || [];
      return {
        source: 'ollama',
        models,
      };
    } catch (error) {
      console.error('Failed to browse models:', error);
      return { source: 'ollama', models: [], error: error.message };
    }
  });

  ipcMain.handle('models:hfLookup', async (_, { repo, revision }) => {
    try {
      if (!repo || typeof repo !== 'string') {
        throw new Error('Repository name required');
      }
      const data = await modelDownloader.fetchHuggingFaceRepo(
        repo.trim(),
        revision && typeof revision === 'string' && revision.trim() ? revision.trim() : 'main',
      );
      return { success: true, ...data };
    } catch (error) {
      console.error('Failed to fetch HuggingFace metadata:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:download', async (_, payload = {}) => {
    try {
      const targetDir = resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      switch (payload.type) {
        case 'ollama': {
          const endpoint = store.get('llmEndpoint');
          const id = modelDownloader.startOllamaDownload(payload.name, endpoint);
          return { success: true, id };
        }
        case 'huggingface': {
          const id = modelDownloader.startHuggingFaceDownload({
            repo: payload.repo,
            file: payload.file,
            targetDir,
            revision:
              payload.revision && typeof payload.revision === 'string' && payload.revision.trim()
                ? payload.revision.trim()
                : 'main',
          });
          return { success: true, id };
        }
        case 'url': {
          const id = modelDownloader.startCustomDownload({
            url: payload.url,
            fileName: payload.fileName,
            targetDir,
            checksum: payload.checksum,
            checksumAlgorithm: payload.checksumAlgorithm,
          });
          return { success: true, id };
        }
        default:
          return { success: false, error: 'Unsupported download type' };
      }
    } catch (error) {
      console.error('Failed to start model download:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:cancelDownload', async (_, id) => {
    try {
      return modelDownloader.cancelDownload(id);
    } catch (error) {
      console.error('Failed to cancel model download:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:getDownloadProgress', () => {
    try {
      return modelDownloader.getDownloads();
    } catch (error) {
      console.error('Failed to get model download progress:', error);
      return [];
    }
  });

  // ============================================
  // Model Manager
  // ============================================
  
  const modelManager = getModelManager({
    modelsDirectory: store.get('modelsDirectory'),
  });
  const modelConverter = createModelConverter(store, appPath);

  const resolveModelsDirectory = () => {
    let dir = store.get('modelsDirectory');
    if (!dir) {
      dir = path.join(app.getPath('documents'), 'DevForge', 'models');
      store.set('modelsDirectory', dir);
      modelManager.setModelsDirectory(dir);
    }
    return dir;
  };

  const ollamaHelperFactory = getOllamaHelperFactory();
  const ollamaHelper = ollamaHelperFactory ? ollamaHelperFactory({ store, shell, makeRequest }) : null;
  
  const imageBackendHelperFactory = getImageBackendHelperFactory();
  const imageBackendHelper = imageBackendHelperFactory ? imageBackendHelperFactory({ shell, makeRequest, store }) : null;

  ipcMain.handle('models:scan', async (_, directory) => {
    if (directory) {
      modelManager.setModelsDirectory(directory);
    }
    return await modelManager.scanDirectory(directory);
  });

  ipcMain.handle('models:getAll', () => {
    return modelManager.getModels();
  });

  ipcMain.handle('models:getByFormat', (_, format) => {
    return modelManager.getModelsByFormat(format);
  });

  ipcMain.handle('models:getForBackend', (_, backendId) => {
    return modelManager.getModelsForBackend(backendId);
  });

  ipcMain.handle('models:getStats', () => {
    return modelManager.getStatistics();
  });

  ipcMain.handle('models:delete', async (_, modelId) => {
    return await modelManager.deleteModel(modelId);
  });

  ipcMain.handle('models:import', async (_, sourcePath, options) => {
    return await modelManager.importModel(sourcePath, options);
  });

  ipcMain.handle('models:convert', async (_, payload = {}) => {
    try {
      const result = await modelConverter.convert(payload);
      if (result?.outputPath) {
        await modelManager.scanDirectory(path.dirname(result.outputPath));
      }
      return result;
    } catch (error) {
      console.error('Failed to convert model:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:recommend', (_, model, availableBackends) => {
    return modelManager.recommendBackend(model, availableBackends);
  });

  // System-wide model scanning
  ipcMain.handle('models:scanSystem', async (_, options) => {
    return await modelManager.scanSystem(options);
  });

  ipcMain.handle('models:getCommonLocations', () => {
    return modelManager.getCommonLocations();
  });

  ipcMain.handle('models:getReferencedModels', async () => {
    return await modelManager.getReferencedModels();
  });

  ipcMain.handle('models:bulkImport', async (_, modelPaths, options) => {
    return await modelManager.bulkImport(modelPaths, options);
  });

  ipcMain.handle('models:getDiskSpace', async () => {
    return await modelManager.getDiskSpace();
  });

  ipcMain.handle('models:setDirectory', async (_, directory) => {
    modelManager.setModelsDirectory(directory);
    store.set('modelsDirectory', directory);
    return { success: true, directory };
  });

  ipcMain.handle('models:browseForDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Models Directory'
    });
    
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    
    const directory = result.filePaths[0];
    modelManager.setModelsDirectory(directory);
    store.set('modelsDirectory', directory);
    
    return { success: true, directory };
  });

  ipcMain.handle('models:browseForFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Model Files to Import',
      filters: [
        { name: 'AI Models', extensions: ['gguf', 'onnx', 'safetensors', 'pt', 'pth', 'bin'] },
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'ONNX Models', extensions: ['onnx'] },
        { name: 'SafeTensors', extensions: ['safetensors'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }
    
    return { success: true, files: result.filePaths };
  });

  ipcMain.handle('models:openInExplorer', async (_, filePath) => {
    try {
      await shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Scan LM Studio models folder
  ipcMain.handle('models:scanLMStudio', async () => {
    const os = require('os');
    const homeDir = os.homedir();
    const lmStudioPaths = [
      path.join(homeDir, '.lmstudio', 'models'),
      path.join(homeDir, '.cache', 'lm-studio', 'models'),
      // Windows AppData
      path.join(process.env.LOCALAPPDATA || '', 'LM-Studio', 'models'),
    ];

    const models = [];
    const scannedPaths = [];

    for (const basePath of lmStudioPaths) {
      try {
        if (!fs.existsSync(basePath)) continue;
        scannedPaths.push(basePath);
        
        // Recursively find all .gguf files
        const findGgufFiles = (dir, depth = 0) => {
          if (depth > 5) return; // Limit recursion
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findGgufFiles(fullPath, depth + 1);
              } else if (entry.isFile() && entry.name.endsWith('.gguf')) {
                const stats = fs.statSync(fullPath);
                models.push({
                  name: entry.name,
                  path: fullPath,
                  size: stats.size,
                  sizeFormatted: formatFileSize(stats.size),
                  source: 'lm-studio',
                  parentFolder: path.basename(path.dirname(fullPath)),
                });
              }
            }
          } catch (e) {
            // Skip inaccessible directories
          }
        };
        
        findGgufFiles(basePath);
      } catch (error) {
        console.error(`Failed to scan LM Studio path ${basePath}:`, error);
      }
    }

    // Deduplicate by path
    const seen = new Set();
    const uniqueModels = models.filter(m => {
      if (seen.has(m.path)) return false;
      seen.add(m.path);
      return true;
    });

    return { 
      models: uniqueModels, 
      scannedPaths,
      count: uniqueModels.length 
    };
  });

  // ============================================
  // MODEL PROVIDERS - Unified Multi-Provider API
  // ============================================
  
  const { getModelProviders } = require('./services/model-providers');
  const { getHuggingFaceBrowser } = require('./services/huggingface-browser');
  const modelProviders = getModelProviders();
  const hfBrowser = getHuggingFaceBrowser();
  
  // Forward HF download progress events to renderer
  hfBrowser.on('download:progress', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', progress);
  });
  hfBrowser.on('download:completed', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', { ...progress, status: 'completed' });
  });
  hfBrowser.on('download:error', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', { ...progress, status: 'error' });
  });
  
  // --- Provider Search & Browse ---
  
  ipcMain.handle('providers:searchAll', async (_, query, options) => {
    try {
      return await modelProviders.searchAll(query, options);
    } catch (error) {
      console.error('Failed to search providers:', error);
      return { ollama: [], huggingface: [], civitai: [], error: error.message };
    }
  });
  
  ipcMain.handle('providers:getOllamaModels', async (_, category) => {
    try {
      return await modelProviders.getOllamaModels(category);
    } catch (error) {
      console.error('Failed to get Ollama models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getImageModels', async (_, category) => {
    try {
      return await modelProviders.getImageModels(category);
    } catch (error) {
      console.error('Failed to get image models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getVisionModels', async () => {
    try {
      return await modelProviders.getVisionModels();
    } catch (error) {
      console.error('Failed to get vision models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getAudioModels', async () => {
    // Placeholder for future audio model support
    return [];
  });
  
  ipcMain.handle('providers:getVideoModels', async () => {
    // Placeholder for future video model support
    return [];
  });
  
  ipcMain.handle('providers:getEmbeddingModels', async () => {
    // Placeholder for future embedding model support
    return [];
  });
  
  ipcMain.handle('providers:getNSFWModels', async (_, type) => {
    try {
      // This returns NSFW models - only accessible from Private workspace
      const vaultModels = await modelProviders.getPrivateVaultModels();
      if (type && type !== 'all') {
        return vaultModels[type] || [];
      }
      return vaultModels;
    } catch (error) {
      console.error('Failed to get NSFW models:', error);
      return {};
    }
  });
  
  ipcMain.handle('providers:getAllCategories', async () => {
    try {
      return modelProviders.getAllCategories();
    } catch (error) {
      console.error('Failed to get categories:', error);
      return {};
    }
  });
  
  ipcMain.handle('providers:getFeatured', async () => {
    try {
      return await modelProviders.getFeaturedModels();
    } catch (error) {
      console.error('Failed to get featured models:', error);
      return { llm: { ollama: [], huggingface: [] }, vision: [], image: [] };
    }
  });
  
  ipcMain.handle('providers:getRecommendations', async (_, vramGB, ramGB) => {
    try {
      return modelProviders.getHardwareRecommendations(vramGB, ramGB);
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      return { llm: [], vision: [], image: [] };
    }
  });
  
  ipcMain.handle('providers:getPrivateVaultModels', async () => {
    try {
      return await modelProviders.getPrivateVaultModels();
    } catch (error) {
      console.error('Failed to get Private Vault models:', error);
      return { text: [], vision: [], image: [], audio: [], multimodal: [] };
    }
  });
  
  // --- Provider Downloads ---
  
  ipcMain.handle('providers:pullOllamaModel', async (_, modelName) => {
    try {
      const endpoint = store.get('llmEndpoint') || 'http://localhost:11434';
      
      // Generate a V2-compatible job ID
      const jobId = `ollama-${modelName.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      let jobCreated = false;
      
      // Callback for progress updates
      const onProgress = (download) => {
        // Create a V2-compatible job object
        const job = {
          id: jobId,
          name: modelName,
          url: `ollama://pull/${modelName}`,
          destinationDir: 'ollama',
          filename: modelName,
          status: download.status === 'downloading' ? 'downloading' : 
                  download.status === 'completed' ? 'completed' :
                  download.status === 'error' ? 'error' :
                  download.status === 'cancelled' ? 'cancelled' : 'queued',
          priority: 0,
          totalBytes: download.totalBytes || 0,
          downloadedBytes: download.downloadedBytes || 0,
          progress: download.progress || 0,
          speed: download.speed || 0,
          provider: 'ollama',
          modelType: 'llm',
          lastError: download.error || null,
          retryCount: 0,
          createdAt: download.startedAt,
          startedAt: download.startedAt,
          completedAt: download.status === 'completed' ? new Date().toISOString() : null,
          metadata: {
            statusMessage: download.statusMessage,
            digest: download.digest,
          },
        };
        
        // Emit V2-style events for DownloadCenter
        if (!jobCreated) {
          mainWindow.webContents.send('downloads:jobCreated', job);
          mainWindow.webContents.send('downloads:jobStarted', job);
          jobCreated = true;
        }
        
        // Send progress update
        mainWindow.webContents.send('downloads:jobProgress', job);
        mainWindow.webContents.send('providers:pullProgress', download);
        
        // Send completion/error events
        if (download.status === 'completed') {
          mainWindow.webContents.send('downloads:jobCompleted', job);
        } else if (download.status === 'error') {
          mainWindow.webContents.send('downloads:jobError', job);
        } else if (download.status === 'cancelled') {
          mainWindow.webContents.send('downloads:jobCancelled', job);
        }
      };
      
      const downloadId = modelDownloader.startOllamaDownload(modelName, endpoint, onProgress);
      
      return { success: true, downloadId, jobId };
    } catch (error) {
      console.error('Failed to pull Ollama model:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('providers:downloadModel', async (_, modelData) => {
    try {
      const targetDir = resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      let downloadId;
      
      if (modelData.source === 'huggingface' || modelData.downloadUrl?.includes('huggingface.co')) {
        // HuggingFace download
        downloadId = modelDownloader.startHuggingFaceDownload({
          repo: modelData.repo || modelData.modelId,
          file: modelData.file || modelData.filename,
          targetDir,
          revision: modelData.revision || 'main',
        });
      } else if (modelData.source === 'civitai' || modelData.civitaiUrl) {
        // CivitAI download - use custom URL
        downloadId = modelDownloader.startCustomDownload({
          url: modelData.downloadUrl || modelData.civitaiUrl,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      } else {
        // Generic URL download
        downloadId = modelDownloader.startCustomDownload({
          url: modelData.downloadUrl || modelData.url,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      }
      
      // Send progress updates
      const progressInterval = setInterval(() => {
        const downloads = modelDownloader.getDownloads();
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
          mainWindow.webContents.send('providers:downloadProgress', download);
          if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
            clearInterval(progressInterval);
          }
        }
      }, 500);
      
      return { success: true, downloadId };
    } catch (error) {
      console.error('Failed to download model:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('providers:downloadNsfwModel', async (_, modelData) => {
    // Same as downloadModel but for NSFW content - could add additional logging/tracking
    try {
      const targetDir = path.join(resolveModelsDirectory(), 'nsfw');
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      let downloadId;
      
      if (modelData.source === 'huggingface' || modelData.downloadUrl?.includes('huggingface.co')) {
        downloadId = modelDownloader.startHuggingFaceDownload({
          repo: modelData.repo || modelData.modelId,
          file: modelData.file || modelData.filename,
          targetDir,
          revision: modelData.revision || 'main',
        });
      } else {
        downloadId = modelDownloader.startCustomDownload({
          url: modelData.downloadUrl || modelData.civitaiUrl || modelData.url,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      }
      
      // Send progress updates
      const progressInterval = setInterval(() => {
        const downloads = modelDownloader.getDownloads();
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
          mainWindow.webContents.send('providers:downloadProgress', download);
          if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
            clearInterval(progressInterval);
          }
        }
      }, 500);
      
      return { success: true, downloadId };
    } catch (error) {
      console.error('Failed to download NSFW model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // HUGGINGFACE BROWSER - Dedicated HF API
  // ============================================
  
  ipcMain.handle('hf:search', async (_, query, options) => {
    try {
      return await hfBrowser.searchModels(query, options);
    } catch (error) {
      console.error('HF search failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:getModelDetails', async (_, modelId) => {
    try {
      return await hfBrowser.getModelDetails(modelId);
    } catch (error) {
      console.error('HF getModelDetails failed:', error);
      return null;
    }
  });
  
  ipcMain.handle('hf:getModelFiles', async (_, modelId) => {
    try {
      return await hfBrowser.getModelFiles(modelId);
    } catch (error) {
      console.error('HF getModelFiles failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:getCollections', async () => {
    try {
      return hfBrowser.getCollections();
    } catch (error) {
      console.error('HF getCollections failed:', error);
      return {};
    }
  });
  
  ipcMain.handle('hf:getCollectionModels', async (_, collectionId) => {
    try {
      return await hfBrowser.getCollectionModels(collectionId);
    } catch (error) {
      console.error('HF getCollectionModels failed:', error);
      return { models: [] };
    }
  });
  
  ipcMain.handle('hf:getQuantizationGuide', async () => {
    try {
      return hfBrowser.getQuantizationGuide();
    } catch (error) {
      console.error('HF getQuantizationGuide failed:', error);
      return {};
    }
  });
  
  ipcMain.handle('hf:getTrending', async (_, limit) => {
    try {
      return await hfBrowser.getTrendingModels(limit);
    } catch (error) {
      console.error('HF getTrending failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:getRecent', async (_, limit) => {
    try {
      return await hfBrowser.getRecentModels(limit);
    } catch (error) {
      console.error('HF getRecent failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:compareModels', async (_, modelIds) => {
    try {
      return await hfBrowser.compareModels(modelIds);
    } catch (error) {
      console.error('HF compareModels failed:', error);
      return { models: [], comparison: {} };
    }
  });
  
  ipcMain.handle('hf:recommendForHardware', async (_, vramGB, ramGB) => {
    try {
      return await hfBrowser.recommendForHardware(vramGB, ramGB);
    } catch (error) {
      console.error('HF recommendForHardware failed:', error);
      return { models: [] };
    }
  });
  
  ipcMain.handle('hf:downloadModel', async (_, fileInfo, destDir) => {
    try {
      const targetDir = destDir || resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      const download = await hfBrowser.downloadModel(fileInfo, targetDir, (progress) => {
        mainWindow.webContents.send('hf:downloadProgress', progress);
      });
      
      return { success: true, download };
    } catch (error) {
      console.error('HF download failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:cancelDownload', async (_, downloadId) => {
    try {
      const cancelled = hfBrowser.cancelDownload(downloadId);
      return { success: cancelled };
    } catch (error) {
      console.error('HF cancelDownload failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:getDownloads', async () => {
    try {
      return hfBrowser.getDownloads();
    } catch (error) {
      console.error('HF getDownloads failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:clearCache', async () => {
    try {
      hfBrowser.clearCache();
      return { success: true };
    } catch (error) {
      console.error('HF clearCache failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:importToOllama', async (_, filePath, modelName) => {
    try {
      // Use the existing ollama:createFromFile handler logic
      const { spawn } = require('child_process');
      const os = require('os');
      
      const modelfilePath = path.join(os.tmpdir(), `Modelfile-${Date.now()}`);
      const modelfileContent = `FROM "${filePath.replace(/\\/g, '/')}"`;
      
      await fsPromises.writeFile(modelfilePath, modelfileContent, 'utf-8');
      console.log(`[HF Import] Created Modelfile at ${modelfilePath}`);
      console.log(`[HF Import] Creating model "${modelName}" from ${filePath}`);
      
      return new Promise((resolve) => {
        const proc = spawn('ollama', ['create', modelName, '-f', modelfilePath], {
          shell: true,
          env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[HF Import]', data.toString().trim());
        });
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[HF Import stderr]', data.toString().trim());
        });
        
        proc.on('close', async (code) => {
          try {
            await fsPromises.unlink(modelfilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            resolve({ 
              success: true, 
              name: modelName,
              message: `Model "${modelName}" imported successfully from ${path.basename(filePath)}`
            });
          } else {
            resolve({ 
              success: false, 
              error: stderr || `ollama create failed with code ${code}`,
              stdout,
              stderr
            });
          }
        });
        
        proc.on('error', (error) => {
          resolve({ 
            success: false, 
            error: `Failed to run ollama: ${error.message}. Make sure Ollama is installed and in your PATH.`
          });
        });
      });
    } catch (error) {
      console.error('HF importToOllama failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:getDefaultDownloadDir', async () => {
    try {
      return resolveModelsDirectory();
    } catch (error) {
      console.error('HF getDefaultDownloadDir failed:', error);
      return null;
    }
  });
  
  ipcMain.handle('hf:selectDownloadDir', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Download Directory'
      });
      
      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true };
      }
      
      return { success: true, directory: result.filePaths[0] };
    } catch (error) {
      console.error('HF selectDownloadDir failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // DOWNLOADS QUEUE - Unified Download Management
  // ============================================
  
  ipcMain.handle('downloads:getAll', async () => {
    try {
      // Combine downloads from all sources
      const modelDownloads = modelDownloader.getDownloads();
      const hfDownloads = hfBrowser.getDownloads();
      return [...modelDownloads, ...hfDownloads];
    } catch (error) {
      console.error('Failed to get downloads:', error);
      return [];
    }
  });
  
  ipcMain.handle('downloads:cancel', async (_, downloadId) => {
    try {
      // Try both download managers
      let result = modelDownloader.cancelDownload(downloadId);
      if (!result.success) {
        result = { success: hfBrowser.cancelDownload(downloadId) };
      }
      return result;
    } catch (error) {
      console.error('Failed to cancel download:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // DOWNLOAD MANAGER V2 - Persistent + Resumable
  // ============================================
  
  const { getDownloadManagerV2 } = require('./services/download-manager-v2');
  const downloadManagerV2 = getDownloadManagerV2();
  
  // Initialize DownloadManagerV2 after database is ready
  downloadManagerV2.initialize(userDataPath).then(() => {
    console.log('[IPC] DownloadManagerV2 initialized');
    
    // Forward events to renderer
    downloadManagerV2.on('job:created', (job) => {
      mainWindow.webContents.send('downloads:jobCreated', job);
    });
    downloadManagerV2.on('job:started', (job) => {
      mainWindow.webContents.send('downloads:jobStarted', job);
    });
    downloadManagerV2.on('job:progress', (job) => {
      mainWindow.webContents.send('downloads:jobProgress', job);
    });
    downloadManagerV2.on('job:completed', (job) => {
      mainWindow.webContents.send('downloads:jobCompleted', job);
    });
    downloadManagerV2.on('job:error', (job) => {
      mainWindow.webContents.send('downloads:jobError', job);
    });
    downloadManagerV2.on('job:paused', (job) => {
      mainWindow.webContents.send('downloads:jobPaused', job);
    });
    downloadManagerV2.on('job:cancelled', (job) => {
      mainWindow.webContents.send('downloads:jobCancelled', job);
    });
  }).catch((error) => {
    console.error('[IPC] Failed to initialize DownloadManagerV2:', error);
  });
  
  // Create a new download job via V2
  ipcMain.handle('downloads:create', async (_, options) => {
    try {
      const id = await downloadManagerV2.create(options);
      return { success: true, id };
    } catch (error) {
      console.error('Failed to create download:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get all V2 jobs
  ipcMain.handle('downloads:getAllV2', async () => {
    try {
      return downloadManagerV2.getAll();
    } catch (error) {
      console.error('Failed to get V2 downloads:', error);
      return [];
    }
  });
  
  // Get a specific V2 job
  ipcMain.handle('downloads:getV2', async (_, id) => {
    try {
      return downloadManagerV2.get(id);
    } catch (error) {
      console.error('Failed to get V2 download:', error);
      return null;
    }
  });
  
  ipcMain.handle('downloads:pause', async (_, downloadId) => {
    try {
      return downloadManagerV2.pause(downloadId);
    } catch (error) {
      console.error('Failed to pause download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:resume', async (_, downloadId) => {
    try {
      return downloadManagerV2.resume(downloadId);
    } catch (error) {
      console.error('Failed to resume download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:retry', async (_, downloadId) => {
    try {
      return downloadManagerV2.retry(downloadId);
    } catch (error) {
      console.error('Failed to retry download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:setPriority', async (_, downloadId, priority) => {
    try {
      return downloadManagerV2.setPriority(downloadId, priority);
    } catch (error) {
      console.error('Failed to set priority:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:schedule', async (_, downloadId, scheduleTime) => {
    try {
      return downloadManagerV2.schedule(downloadId, scheduleTime);
    } catch (error) {
      console.error('Failed to schedule download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:delete', async (_, downloadId, deleteFiles) => {
    try {
      return await downloadManagerV2.delete(downloadId, deleteFiles);
    } catch (error) {
      console.error('Failed to delete download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:clearCompleted', async () => {
    try {
      return await downloadManagerV2.clearCompleted();
    } catch (error) {
      console.error('Failed to clear completed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // INSTALLER REGISTRY - Model Installation
  // ============================================
  
  const { getInstallerRegistry } = require('./services/installer-registry');
  const installerRegistry = getInstallerRegistry();
  
  // Initialize installer registry
  installerRegistry.initialize({
    ollamaEndpoint: store.get('llmEndpoint') || 'http://localhost:11434',
    comfyuiPath: store.get('comfyuiPath'),
    a1111Path: store.get('a1111Path'),
    llamacppPath: store.get('llamacppPath'),
  }).then(() => {
    console.log('[IPC] InstallerRegistry initialized');
    
    // Forward events to renderer
    installerRegistry.on('install:started', (data) => {
      mainWindow.webContents.send('installer:started', data);
    });
    installerRegistry.on('install:progress', (data) => {
      mainWindow.webContents.send('installer:progress', data);
    });
    installerRegistry.on('install:completed', (data) => {
      mainWindow.webContents.send('installer:completed', data);
    });
    installerRegistry.on('install:dependencies-required', (data) => {
      mainWindow.webContents.send('installer:dependenciesRequired', data);
    });
    installerRegistry.on('uninstall:started', (data) => {
      mainWindow.webContents.send('installer:uninstallStarted', data);
    });
    installerRegistry.on('uninstall:completed', (data) => {
      mainWindow.webContents.send('installer:uninstallCompleted', data);
    });
  }).catch((error) => {
    console.error('[IPC] Failed to initialize InstallerRegistry:', error);
  });
  
  // Get available engines
  ipcMain.handle('installer:getEngines', async () => {
    return installerRegistry.getEnginesInfo();
  });
  
  // Get engines compatible with a model type
  ipcMain.handle('installer:getEnginesForType', async (_, modelType) => {
    return installerRegistry.getEnginesForModelType(modelType);
  });
  
  // Get recommended engine for a model
  ipcMain.handle('installer:getRecommendedEngine', async (_, modelInfo) => {
    return installerRegistry.getRecommendedEngine(modelInfo);
  });
  
  // Install a model
  ipcMain.handle('installer:install', async (_, { filePath, modelInfo, options }) => {
    try {
      const result = await installerRegistry.install(filePath, modelInfo, options);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to install model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Validate an installed model
  ipcMain.handle('installer:validate', async (_, { modelInfo, engineId }) => {
    return installerRegistry.validate(modelInfo, engineId);
  });
  
  // Run readiness check
  ipcMain.handle('installer:readinessCheck', async (_, { modelInfo, engineId }) => {
    return installerRegistry.readinessCheck(modelInfo, engineId);
  });
  
  // Uninstall a model
  ipcMain.handle('installer:uninstall', async (_, { modelInfo, engineId }) => {
    try {
      const result = await installerRegistry.uninstall(modelInfo, engineId);
      return result;
    } catch (error) {
      console.error('Failed to uninstall model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Set engine path
  ipcMain.handle('installer:setEnginePath', async (_, { engineId, path: enginePath }) => {
    store.set(`${engineId}Path`, enginePath);
    // Re-initialize to detect new engine
    await installerRegistry.initialize({
      ollamaEndpoint: store.get('llmEndpoint') || 'http://localhost:11434',
      comfyuiPath: store.get('comfyuiPath'),
      a1111Path: store.get('a1111Path'),
      llamacppPath: store.get('llamacppPath'),
    });
    return { success: true };
  });

  // ============================================
  // LOCAL MODEL SCANNER
  // ============================================
  
  const { getLocalModelScanner } = require('./services/local-model-scanner');
  const localModelScanner = getLocalModelScanner();
  
  // Forward scanner events to renderer
  localModelScanner.on('scan:started', () => {
    mainWindow.webContents.send('scanner:started');
  });
  localModelScanner.on('scan:source', (data) => {
    mainWindow.webContents.send('scanner:source', data);
  });
  localModelScanner.on('scan:completed', (data) => {
    mainWindow.webContents.send('scanner:completed', data);
  });
  localModelScanner.on('model:discovered', (model) => {
    mainWindow.webContents.send('scanner:modelDiscovered', model);
  });
  localModelScanner.on('model:changed', (data) => {
    mainWindow.webContents.send('scanner:modelChanged', data);
  });
  
  // Get all configured sources
  ipcMain.handle('scanner:getSources', async () => {
    return localModelScanner.getSources();
  });
  
  // Scan all sources
  ipcMain.handle('scanner:scanAll', async (_, options) => {
    return localModelScanner.scanAll(options);
  });
  
  // Get all discovered models
  ipcMain.handle('scanner:getAllModels', async () => {
    return localModelScanner.getAllModels();
  });
  
  // Get models by source
  ipcMain.handle('scanner:getBySource', async (_, sourceId) => {
    return localModelScanner.getModelsBySource(sourceId);
  });
  
  // Get models by type
  ipcMain.handle('scanner:getByType', async (_, modelType) => {
    return localModelScanner.getModelsByType(modelType);
  });
  
  // Get specific model
  ipcMain.handle('scanner:getModel', async (_, modelPath) => {
    return localModelScanner.getModel(modelPath);
  });
  
  // Add custom scan path
  ipcMain.handle('scanner:addCustomPath', async (_, { path: scanPath, options }) => {
    localModelScanner.addCustomPath(scanPath, options);
    
    // Save to settings
    const customPaths = store.get('scannerCustomPaths') || [];
    customPaths.push({ path: scanPath, ...options });
    store.set('scannerCustomPaths', customPaths);
    
    return { success: true };
  });
  
  // Remove custom scan path
  ipcMain.handle('scanner:removeCustomPath', async (_, scanPath) => {
    localModelScanner.removeCustomPath(scanPath);
    
    // Remove from settings
    const customPaths = store.get('scannerCustomPaths') || [];
    store.set('scannerCustomPaths', customPaths.filter(p => p.path !== scanPath));
    
    return { success: true };
  });
  
  // Import model (copy)
  ipcMain.handle('scanner:importModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.importModel(modelPath, modelsDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('scanner:importProgress', { modelPath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to import model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Link model (symlink)
  ipcMain.handle('scanner:linkModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.linkModel(modelPath, modelsDir);
      return result;
    } catch (error) {
      console.error('Failed to link model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Move model
  ipcMain.handle('scanner:moveModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.moveModel(modelPath, modelsDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('scanner:moveProgress', { modelPath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to move model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Start watching for changes
  ipcMain.handle('scanner:startWatching', async (_, sourceId) => {
    localModelScanner.startWatching(sourceId);
    return { success: true };
  });
  
  // Stop watching
  ipcMain.handle('scanner:stopWatching', async (_, sourceId) => {
    localModelScanner.stopWatching(sourceId);
    return { success: true };
  });
  
  // Clear discovered models
  ipcMain.handle('scanner:clear', async () => {
    localModelScanner.clear();
    return { success: true };
  });
  
  // Load custom paths from settings on startup
  const savedCustomPaths = store.get('scannerCustomPaths') || [];
  for (const customPath of savedCustomPaths) {
    localModelScanner.addCustomPath(customPath.path, customPath);
  }

  // ============================================
  // STORAGE SERVICE
  // ============================================
  
  const { getStorageService } = require('./services/storage-service');
  const storageService = getStorageService();
  
  // Set model directories
  storageService.setModelDirectories([resolveModelsDirectory()]);
  
  // Forward storage events
  storageService.on('model:moved', (data) => {
    mainWindow.webContents.send('storage:modelMoved', data);
  });
  storageService.on('file:deleted', (data) => {
    mainWindow.webContents.send('storage:fileDeleted', data);
  });
  
  // Get available drives
  ipcMain.handle('storage:getDrives', async () => {
    return storageService.getDrives();
  });
  
  // Get model storage usage
  ipcMain.handle('storage:getUsage', async () => {
    return storageService.getModelStorageUsage();
  });
  
  // Get directory breakdown
  ipcMain.handle('storage:getBreakdown', async (_, dirPath) => {
    return storageService.getDirectoryBreakdown(dirPath);
  });
  
  // Find orphaned files
  ipcMain.handle('storage:findOrphaned', async (_, libraryModels) => {
    return storageService.findOrphanedFiles(libraryModels);
  });
  
  // Find duplicates
  ipcMain.handle('storage:findDuplicates', async () => {
    return storageService.findDuplicates();
  });
  
  // Move model
  ipcMain.handle('storage:moveModel', async (_, { sourcePath, targetDir }) => {
    try {
      const result = await storageService.moveModel(sourcePath, targetDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('storage:moveProgress', { sourcePath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to move model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Delete files
  ipcMain.handle('storage:deleteFiles', async (_, filePaths) => {
    return storageService.deleteFiles(filePaths);
  });
  
  // Get recommendations
  ipcMain.handle('storage:getRecommendations', async () => {
    return storageService.getRecommendations();
  });
  
  // Clear cache
  ipcMain.handle('storage:clearCache', async () => {
    storageService.clearCache();
    return { success: true };
  });

  // ============================================
  // HARDWARE CHECKER
  // ============================================
  
  const { getHardwareChecker } = require('./services/hardware-checker');
  const hardwareChecker = getHardwareChecker();
  
  // Get comprehensive hardware info
  ipcMain.handle('hardwareChecker:getInfo', async (_, forceRefresh) => {
    return hardwareChecker.getHardwareInfo(forceRefresh);
  });
  
  // Check if model can run
  ipcMain.handle('hardwareChecker:canRunModel', async (_, modelInfo) => {
    return hardwareChecker.canRunModel(modelInfo);
  });
  
  // Get model recommendations
  ipcMain.handle('hardwareChecker:getRecommendations', async (_, targetSizeB) => {
    const hw = await hardwareChecker.getHardwareInfo();
    return hardwareChecker.getModelRecommendations(hw, targetSizeB);
  });
  
  // Precheck before download
  ipcMain.handle('hardwareChecker:precheck', async (_, modelInfo) => {
    return hardwareChecker.precheck(modelInfo);
  });
  
  // Estimate VRAM needed
  ipcMain.handle('hardwareChecker:estimateVram', async (_, { sizeB, quant }) => {
    return hardwareChecker.estimateVramNeeded(sizeB, quant);
  });

  // ============================================
  // CATALOG SERVICE
  // ============================================
  
  const { getCatalogService } = require('./services/catalog-service');
  const catalogService = getCatalogService();
  
  // Register providers with catalog service
  try {
    const { getModelProviders } = require('./services/model-providers');
    const providers = getModelProviders();
    
    // Create adapter for Ollama provider
    if (providers.ollama) {
      catalogService.registerProvider('ollama', {
        search: async (query, options) => providers.searchAll?.(query, options)?.ollama || [],
        getTrending: async (limit) => providers.getOllamaModels?.('featured')?.slice(0, limit) || [],
        getRecent: async (limit) => providers.getOllamaModels?.('recent')?.slice(0, limit) || [],
        getModelDetails: async (modelId) => providers.ollama?.getModelDetails?.(modelId),
        getCategories: async () => [
          { id: 'llm', name: 'Language Models' },
          { id: 'vision', name: 'Vision Models' },
          { id: 'embedding', name: 'Embeddings' },
        ],
      });
    }
    
    // Create adapter for HuggingFace provider
    if (providers.huggingface) {
      catalogService.registerProvider('huggingface', {
        search: async (query, options) => providers.huggingface?.search?.(query, options) || [],
        getTrending: async (limit) => providers.huggingface?.getTrending?.(limit) || [],
        getRecent: async (limit) => providers.huggingface?.getRecent?.(limit) || [],
        getModelDetails: async (modelId) => providers.huggingface?.getModelDetails?.(modelId),
        getModelFiles: async (modelId) => providers.huggingface?.getModelFiles?.(modelId),
        getCategories: async () => providers.huggingface?.getCategories?.() || [],
      });
    }
    
    // Create adapter for CivitAI provider
    if (providers.civitai) {
      catalogService.registerProvider('civitai', {
        search: async (query, options) => providers.civitai?.search?.(query, options) || [],
        getTrending: async (limit) => providers.civitai?.getTrending?.(limit) || [],
        getRecent: async (limit) => providers.civitai?.getRecent?.(limit) || [],
        getModelDetails: async (modelId) => providers.civitai?.getModelDetails?.(modelId),
        getCategories: async () => [
          { id: 'checkpoint', name: 'Checkpoints' },
          { id: 'lora', name: 'LoRAs' },
          { id: 'controlnet', name: 'ControlNet' },
        ],
      });
    }
    
    console.log('[IPC] CatalogService providers registered');
  } catch (error) {
    console.warn('[IPC] Could not register catalog providers:', error.message);
  }
  
  // Forward catalog events
  catalogService.on('subscription:added', (sub) => {
    mainWindow.webContents.send('catalog:subscriptionAdded', sub);
  });
  catalogService.on('subscription:removed', (sub) => {
    mainWindow.webContents.send('catalog:subscriptionRemoved', sub);
  });
  catalogService.on('subscription:update-available', (data) => {
    mainWindow.webContents.send('catalog:updateAvailable', data);
  });
  
  // Search models
  ipcMain.handle('catalog:search', async (_, query, options) => {
    return catalogService.search(query, options);
  });
  
  // Get trending
  ipcMain.handle('catalog:getTrending', async (_, options) => {
    return catalogService.getTrending(options);
  });
  
  // Get recent
  ipcMain.handle('catalog:getRecent', async (_, options) => {
    return catalogService.getRecent(options);
  });
  
  // Get model details
  ipcMain.handle('catalog:getModelDetails', async (_, provider, modelId) => {
    return catalogService.getModelDetails(provider, modelId);
  });
  
  // Get model files
  ipcMain.handle('catalog:getModelFiles', async (_, provider, modelId) => {
    return catalogService.getModelFiles(provider, modelId);
  });
  
  // Subscribe to updates
  ipcMain.handle('catalog:subscribe', async (_, modelId, provider, installedVersion, options) => {
    return catalogService.subscribe(modelId, provider, installedVersion, options);
  });
  
  // Unsubscribe
  ipcMain.handle('catalog:unsubscribe', async (_, subscriptionId) => {
    return catalogService.unsubscribe(subscriptionId);
  });
  
  // Get subscriptions
  ipcMain.handle('catalog:getSubscriptions', async () => {
    return catalogService.getSubscriptions();
  });
  
  // Check for updates
  ipcMain.handle('catalog:checkUpdates', async () => {
    return catalogService.checkUpdates();
  });
  
  // Get discovery feed
  ipcMain.handle('catalog:getDiscoveryFeed', async (_, options) => {
    return catalogService.getDiscoveryFeed(options);
  });
  
  // Get categories
  ipcMain.handle('catalog:getCategories', async () => {
    return catalogService.getCategories();
  });
  
  // Clear cache
  ipcMain.handle('catalog:clearCache', async (_, pattern) => {
    catalogService.clearCache(pattern);
    return { success: true };
  });
  
  // Get cache stats
  ipcMain.handle('catalog:getCacheStats', async () => {
    return catalogService.getCacheStats();
  });

  // ============================================
  // LIBRARY SERVICE
  // ============================================
  
  const { getLibraryService } = require('./services/library-service');
  const libraryService = getLibraryService();
  
  // Initialize library
  libraryService.initialize(userDataPath).then(() => {
    console.log('[IPC] LibraryService initialized');
  }).catch(error => {
    console.error('[IPC] Failed to initialize LibraryService:', error);
  });
  
  // Forward library events
  libraryService.on('model:added', (model) => {
    mainWindow.webContents.send('library:modelAdded', model);
  });
  libraryService.on('model:updated', (data) => {
    mainWindow.webContents.send('library:modelUpdated', data);
  });
  libraryService.on('model:deleted', (data) => {
    mainWindow.webContents.send('library:modelDeleted', data);
  });
  libraryService.on('collection:created', (collection) => {
    mainWindow.webContents.send('library:collectionCreated', collection);
  });
  libraryService.on('collection:updated', (data) => {
    mainWindow.webContents.send('library:collectionUpdated', data);
  });
  libraryService.on('collection:deleted', (data) => {
    mainWindow.webContents.send('library:collectionDeleted', data);
  });
  
  // Model operations
  ipcMain.handle('library:addModel', async (_, modelData) => {
    return libraryService.addModel(modelData);
  });
  
  ipcMain.handle('library:updateModel', async (_, id, updates) => {
    return libraryService.updateModel(id, updates);
  });
  
  ipcMain.handle('library:deleteModel', async (_, id) => {
    return libraryService.deleteModel(id);
  });
  
  ipcMain.handle('library:getModel', async (_, id) => {
    return libraryService.getModel(id);
  });
  
  ipcMain.handle('library:getModelByPath', async (_, modelPath) => {
    return libraryService.getModelByPath(modelPath);
  });
  
  ipcMain.handle('library:getAllModels', async (_, options) => {
    return libraryService.getAllModels(options);
  });
  
  ipcMain.handle('library:recordUsage', async (_, id, tokens, responseTime) => {
    return libraryService.recordUsage(id, tokens, responseTime);
  });
  
  // Tag operations
  ipcMain.handle('library:getAllTags', async () => {
    return libraryService.getAllTags();
  });
  
  ipcMain.handle('library:addTagToModel', async (_, modelId, tagName) => {
    return libraryService.addTagToModel(modelId, tagName);
  });
  
  ipcMain.handle('library:removeTagFromModel', async (_, modelId, tagName) => {
    return libraryService.removeTagFromModel(modelId, tagName);
  });
  
  // Collection operations
  ipcMain.handle('library:createCollection', async (_, data) => {
    return libraryService.createCollection(data);
  });
  
  ipcMain.handle('library:updateCollection', async (_, id, updates) => {
    return libraryService.updateCollection(id, updates);
  });
  
  ipcMain.handle('library:deleteCollection', async (_, id) => {
    return libraryService.deleteCollection(id);
  });
  
  ipcMain.handle('library:getCollection', async (_, id) => {
    return libraryService.getCollection(id);
  });
  
  ipcMain.handle('library:getAllCollections', async () => {
    return libraryService.getAllCollections();
  });
  
  ipcMain.handle('library:addToCollection', async (_, collectionId, modelId) => {
    return libraryService.addToCollection(collectionId, modelId);
  });
  
  ipcMain.handle('library:removeFromCollection', async (_, collectionId, modelId) => {
    return libraryService.removeFromCollection(collectionId, modelId);
  });
  
  ipcMain.handle('library:getCollectionModels', async (_, collectionId) => {
    return libraryService.getCollectionModels(collectionId);
  });
  
  // Bulk operations
  ipcMain.handle('library:bulkUpdate', async (_, modelIds, updates) => {
    return libraryService.bulkUpdate(modelIds, updates);
  });
  
  ipcMain.handle('library:bulkDelete', async (_, modelIds) => {
    return libraryService.bulkDelete(modelIds);
  });
  
  ipcMain.handle('library:bulkAddToCollection', async (_, collectionId, modelIds) => {
    return libraryService.bulkAddToCollection(collectionId, modelIds);
  });
  
  // Statistics
  ipcMain.handle('library:getStats', async () => {
    return libraryService.getStats();
  });

  // ===========================
  // FORMAT CONVERTER HANDLERS
  // ===========================
  const { getFormatConverter } = require('./services/format-converter');
  const formatConverter = getFormatConverter();
  
  // Initialize converter
  formatConverter.initialize().catch(err => {
    console.error('[FormatConverter] Initialization error:', err);
  });
  
  // Forward converter events
  formatConverter.on('job:created', (job) => {
    mainWindow.webContents.send('converter:jobCreated', job);
  });
  formatConverter.on('job:started', (job) => {
    mainWindow.webContents.send('converter:jobStarted', job);
  });
  formatConverter.on('job:progress', (job) => {
    mainWindow.webContents.send('converter:jobProgress', job);
  });
  formatConverter.on('job:completed', (job) => {
    mainWindow.webContents.send('converter:jobCompleted', job);
  });
  formatConverter.on('job:error', (job) => {
    mainWindow.webContents.send('converter:jobError', job);
  });
  formatConverter.on('job:cancelled', (job) => {
    mainWindow.webContents.send('converter:jobCancelled', job);
  });
  
  // Get supported conversions for a file
  ipcMain.handle('converter:getSupportedConversions', async (_, filePath) => {
    try {
      return formatConverter.getSupportedConversions(filePath);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create a conversion job
  ipcMain.handle('converter:createJob', async (_, type, sourcePath, options) => {
    try {
      return await formatConverter.createJob(type, sourcePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all jobs
  ipcMain.handle('converter:getAllJobs', async () => {
    try {
      return formatConverter.getAllJobs();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get a specific job
  ipcMain.handle('converter:getJob', async (_, jobId) => {
    try {
      return formatConverter.getJob(jobId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Cancel a job
  ipcMain.handle('converter:cancelJob', async (_, jobId) => {
    try {
      return formatConverter.cancelJob(jobId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Clear completed jobs
  ipcMain.handle('converter:clearCompleted', async () => {
    try {
      return formatConverter.clearCompleted();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get available quantization types
  ipcMain.handle('converter:getQuantTypes', async () => {
    try {
      return formatConverter.getQuantTypes();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Estimate conversion time
  ipcMain.handle('converter:estimateTime', async (_, sourcePath, type, options) => {
    try {
      return formatConverter.estimateConversionTime(sourcePath, type, options);
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // COLLECTIONS SERVICE HANDLERS
  // ===========================
  const { getCollectionsService } = require('./services/collections-service');
  const collectionsService = getCollectionsService();
  
  // Initialize collections service
  collectionsService.initialize(db, userDataPath).catch(err => {
    console.error('[CollectionsService] Initialization error:', err);
  });
  
  // Forward collection events
  collectionsService.on('collection:created', (collection) => {
    mainWindow.webContents.send('collections:created', collection);
  });
  collectionsService.on('collection:updated', (data) => {
    mainWindow.webContents.send('collections:updated', data);
  });
  collectionsService.on('collection:deleted', (data) => {
    mainWindow.webContents.send('collections:deleted', data);
  });
  collectionsService.on('collection:imported', (collection) => {
    mainWindow.webContents.send('collections:imported', collection);
  });
  collectionsService.on('collection:installProgress', (data) => {
    mainWindow.webContents.send('collections:installProgress', data);
  });
  
  // Get all collections
  ipcMain.handle('collections:getAll', async (_, options) => {
    try {
      return collectionsService.getAllCollections(options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get starter packs
  ipcMain.handle('collections:getStarterPacks', async () => {
    try {
      return collectionsService.getStarterPacks();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get user collections
  ipcMain.handle('collections:getUserCollections', async () => {
    try {
      return collectionsService.getUserCollections();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get collection by ID
  ipcMain.handle('collections:getById', async (_, collectionId) => {
    try {
      return collectionsService.getCollection(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create collection
  ipcMain.handle('collections:create', async (_, data) => {
    try {
      return collectionsService.createCollection(data);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Update collection
  ipcMain.handle('collections:update', async (_, collectionId, updates) => {
    try {
      return collectionsService.updateCollection(collectionId, updates);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete collection
  ipcMain.handle('collections:delete', async (_, collectionId) => {
    try {
      return collectionsService.deleteCollection(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Add model to collection
  ipcMain.handle('collections:addModel', async (_, collectionId, modelData) => {
    try {
      return collectionsService.addModelToCollection(collectionId, modelData);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Remove model from collection
  ipcMain.handle('collections:removeModel', async (_, collectionId, provider, modelId) => {
    try {
      return collectionsService.removeModelFromCollection(collectionId, provider, modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Export manifest
  ipcMain.handle('collections:exportManifest', async (_, collectionId) => {
    try {
      return await collectionsService.exportManifest(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import manifest
  ipcMain.handle('collections:importManifest', async (_, manifest) => {
    try {
      return await collectionsService.importManifest(manifest);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Generate share code
  ipcMain.handle('collections:generateShareCode', async (_, collectionId) => {
    try {
      return await collectionsService.generateShareCode(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get collection by share code
  ipcMain.handle('collections:getByShareCode', async (_, shareCode) => {
    try {
      return collectionsService.getCollectionByShareCode(shareCode);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get installation status
  ipcMain.handle('collections:getInstallStatus', async (_, collectionId) => {
    try {
      return collectionsService.getInstallationStatus(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Track installation
  ipcMain.handle('collections:trackInstall', async (_, collectionId, modelsInstalled, modelsTotal) => {
    try {
      collectionsService.trackInstallation(collectionId, modelsInstalled, modelsTotal);
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get categories
  ipcMain.handle('collections:getCategories', async () => {
    try {
      return collectionsService.getCategories();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // MODEL TESTING SERVICE HANDLERS
  // ===========================
  const { getModelTestingService } = require('./services/model-testing-service');
  const modelTestingService = getModelTestingService();
  
  // Initialize testing service
  modelTestingService.initialize(db).catch(err => {
    console.error('[ModelTestingService] Initialization error:', err);
  });
  
  // Forward testing events
  modelTestingService.on('test:started', (data) => {
    mainWindow.webContents.send('testing:started', data);
  });
  modelTestingService.on('test:progress', (data) => {
    mainWindow.webContents.send('testing:progress', data);
  });
  modelTestingService.on('test:completed', (data) => {
    mainWindow.webContents.send('testing:completed', data);
  });
  modelTestingService.on('test:error', (data) => {
    mainWindow.webContents.send('testing:error', data);
  });
  modelTestingService.on('benchmark:started', (data) => {
    mainWindow.webContents.send('testing:benchmarkStarted', data);
  });
  modelTestingService.on('benchmark:progress', (data) => {
    mainWindow.webContents.send('testing:benchmarkProgress', data);
  });
  modelTestingService.on('benchmark:completed', (data) => {
    mainWindow.webContents.send('testing:benchmarkCompleted', data);
  });
  modelTestingService.on('readiness:checked', (data) => {
    mainWindow.webContents.send('testing:readinessChecked', data);
  });
  
  // Get test prompts
  ipcMain.handle('testing:getPrompts', async (_, modelType) => {
    try {
      return modelTestingService.getTestPrompts(modelType);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Run quick test
  ipcMain.handle('testing:runQuickTest', async (_, modelId, provider, prompt, options) => {
    try {
      return await modelTestingService.runQuickTest(modelId, provider, prompt, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Run benchmark
  ipcMain.handle('testing:runBenchmark', async (_, modelId, provider, options) => {
    try {
      return await modelTestingService.runBenchmark(modelId, provider, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check readiness
  ipcMain.handle('testing:checkReadiness', async (_, modelId, provider) => {
    try {
      return await modelTestingService.checkReadiness(modelId, provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get community benchmarks
  ipcMain.handle('testing:getCommunityBenchmarks', async (_, modelId) => {
    try {
      return modelTestingService.getCommunityBenchmarks(modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get local benchmarks
  ipcMain.handle('testing:getLocalBenchmarks', async (_, modelId) => {
    try {
      return modelTestingService.getLocalBenchmarks(modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get test history
  ipcMain.handle('testing:getHistory', async (_, modelId, limit) => {
    try {
      return modelTestingService.getTestHistory(modelId, limit);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Cancel test
  ipcMain.handle('testing:cancelTest', async (_, testId) => {
    try {
      return modelTestingService.cancelTest(testId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get active tests
  ipcMain.handle('testing:getActiveTests', async () => {
    try {
      return modelTestingService.getActiveTests();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // EXPORT/BACKUP SERVICE HANDLERS
  // ===========================
  const { getExportBackupService } = require('./services/export-backup-service');
  const exportBackupService = getExportBackupService();
  
  // Initialize export/backup service
  exportBackupService.initialize(db, store, userDataPath).catch(err => {
    console.error('[ExportBackupService] Initialization error:', err);
  });
  
  // Forward events
  exportBackupService.on('export:completed', (data) => {
    mainWindow.webContents.send('backup:exportCompleted', data);
  });
  exportBackupService.on('import:completed', (data) => {
    mainWindow.webContents.send('backup:importCompleted', data);
  });
  exportBackupService.on('backup:created', (data) => {
    mainWindow.webContents.send('backup:created', data);
  });
  
  // Export manifest
  ipcMain.handle('backup:exportManifest', async (_, options) => {
    try {
      return await exportBackupService.exportManifest(options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Export to file
  ipcMain.handle('backup:exportToFile', async (_, filePath, options) => {
    try {
      return await exportBackupService.exportToFile(filePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import manifest
  ipcMain.handle('backup:importManifest', async (_, manifest, options) => {
    try {
      return await exportBackupService.importManifest(manifest, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import from file
  ipcMain.handle('backup:importFromFile', async (_, filePath, options) => {
    try {
      return await exportBackupService.importFromFile(filePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create backup (using exportBackupService - note: backup:create already registered above)
  // Use a different channel name to avoid conflict
  ipcMain.handle('backup:createV2', async (_, name) => {
    try {
      return await exportBackupService.createBackup(name);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // List backups (V2 - uses exportBackupService, original at line ~953 uses backupService)
  ipcMain.handle('backup:listV2', async () => {
    try {
      return await exportBackupService.listBackups();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Restore from backup (V2 - uses exportBackupService, original at line ~929 uses backupService)
  ipcMain.handle('backup:restoreV2', async (_, backupPath, options) => {
    try {
      return await exportBackupService.restoreFromBackup(backupPath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete backup
  ipcMain.handle('backup:delete', async (_, backupPath) => {
    try {
      return await exportBackupService.deleteBackup(backupPath);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get export preview
  ipcMain.handle('backup:getPreview', async () => {
    try {
      return await exportBackupService.getExportPreview();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // SECRETS STORE HANDLERS
  // ===========================
  const { getSecretsStore } = require('./services/secrets-store');
  const secretsStore = getSecretsStore();
  
  // Initialize secrets store
  secretsStore.initialize(userDataPath).catch(err => {
    console.error('[SecretsStore] Initialization error:', err);
  });
  
  // Forward events
  secretsStore.on('token:set', (data) => {
    mainWindow.webContents.send('secrets:tokenSet', data);
  });
  secretsStore.on('token:deleted', (data) => {
    mainWindow.webContents.send('secrets:tokenDeleted', data);
  });
  secretsStore.on('rateLimit:hit', (data) => {
    mainWindow.webContents.send('secrets:rateLimitHit', data);
  });
  
  // Set token
  ipcMain.handle('secrets:setToken', async (_, provider, token) => {
    try {
      return await secretsStore.setToken(provider, token);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get token (returns redacted)
  ipcMain.handle('secrets:getTokenStatus', async (_, provider) => {
    try {
      return secretsStore.getProviderStatus(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete token
  ipcMain.handle('secrets:deleteToken', async (_, provider) => {
    try {
      return await secretsStore.deleteToken(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Validate token
  ipcMain.handle('secrets:validateToken', async (_, provider, token) => {
    try {
      return await secretsStore.validateToken(provider, token);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all provider statuses
  ipcMain.handle('secrets:getAllStatuses', async () => {
    try {
      return secretsStore.getAllProviderStatuses();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get configured providers
  ipcMain.handle('secrets:getConfiguredProviders', async () => {
    try {
      return secretsStore.getConfiguredProviders();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // LICENSING SERVICE HANDLERS
  // ===========================
  const { getLicensingService } = require('./services/licensing-service');
  const licensingService = getLicensingService();
  
  // Initialize licensing service
  licensingService.initialize(db, store).catch(err => {
    console.error('[LicensingService] Initialization error:', err);
  });
  
  // Forward events
  licensingService.on('license:accepted', (data) => {
    mainWindow.webContents.send('licensing:accepted', data);
  });
  licensingService.on('tos:accepted', (data) => {
    mainWindow.webContents.send('licensing:tosAccepted', data);
  });
  licensingService.on('age:verified', (data) => {
    mainWindow.webContents.send('licensing:ageVerified', data);
  });
  
  // Check if license acceptance is required
  ipcMain.handle('licensing:requiresAcceptance', async (_, modelId, provider, licenseId) => {
    try {
      return await licensingService.requiresAcceptance(modelId, provider, licenseId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Accept license
  ipcMain.handle('licensing:acceptLicense', async (_, modelId, provider, licenseId, licenseName) => {
    try {
      return await licensingService.acceptLicense(modelId, provider, licenseId, licenseName);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get license status
  ipcMain.handle('licensing:getLicenseStatus', async (_, modelId, provider) => {
    try {
      return licensingService.getLicenseStatus(modelId, provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Accept ToS
  ipcMain.handle('licensing:acceptToS', async (_, provider, version) => {
    try {
      return await licensingService.acceptToS(provider, version);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get ToS status
  ipcMain.handle('licensing:getToSStatus', async (_, provider) => {
    try {
      return licensingService.getToSStatus(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verify age
  ipcMain.handle('licensing:verifyAge', async (_, dateOfBirth) => {
    try {
      return await licensingService.verifyAge(dateOfBirth);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check age verification
  ipcMain.handle('licensing:isAgeVerified', async () => {
    try {
      return licensingService.isAgeVerified();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get Private Vault access
  ipcMain.handle('licensing:getVaultAccess', async () => {
    try {
      return licensingService.getPrivateVaultAccess();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Set vault password
  ipcMain.handle('licensing:setVaultPassword', async (_, password) => {
    try {
      return await licensingService.setVaultPassword(password);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verify vault password
  ipcMain.handle('licensing:verifyVaultPassword', async (_, password) => {
    try {
      return licensingService.verifyVaultPassword(password);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check vault password
  ipcMain.handle('licensing:hasVaultPassword', async () => {
    try {
      return licensingService.hasVaultPassword();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Parse license
  ipcMain.handle('licensing:parseLicense', async (_, licenseString) => {
    try {
      return licensingService.parseLicense(licenseString);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get license summary
  ipcMain.handle('licensing:getLicenseSummary', async (_, license) => {
    try {
      return licensingService.getLicenseSummary(license);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all acceptances
  ipcMain.handle('licensing:getAllAcceptances', async () => {
    try {
      return licensingService.getAllAcceptances();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Revoke acceptance
  ipcMain.handle('licensing:revokeAcceptance', async (_, modelId, provider, licenseId) => {
    try {
      return await licensingService.revokeAcceptance(modelId, provider, licenseId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Convert GGUF to OpenVINO format for NPU
  ipcMain.handle('models:convertToNPU', async (_, { inputPath, outputDir, precision = 'fp16' }) => {
    const { spawn } = require('child_process');
    
    // Get Python path from openvino-env
    const projectRoot = path.resolve(__dirname, '..');
    const openvinoEnv = path.join(projectRoot, 'openvino-env');
    const pythonPath = process.platform === 'win32' 
      ? path.join(openvinoEnv, 'Scripts', 'python.exe')
      : path.join(openvinoEnv, 'bin', 'python');
    
    const convertScript = path.join(projectRoot, 'scripts', 'convert-to-openvino.py');
    
    if (!fs.existsSync(pythonPath)) {
      return { 
        success: false, 
        error: 'OpenVINO environment not set up. Run scripts/setup-openvino.ps1 first.',
        needsSetup: true
      };
    }
    
    if (!fs.existsSync(convertScript)) {
      return { 
        success: false, 
        error: 'Conversion script not found.' 
      };
    }

    // Ensure output directory exists
    const outputPath = outputDir || path.join(projectRoot, 'npu-models');
    await fsPromises.mkdir(outputPath, { recursive: true });

    return new Promise((resolve) => {
      const args = [
        convertScript,
        '--input', inputPath,
        '--output-dir', outputPath,
        '--precision', precision
      ];
      
      console.log(`[NPU Convert] Running: ${pythonPath} ${args.join(' ')}`);
      
      const proc = spawn(pythonPath, args, { cwd: projectRoot });
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log('[NPU Convert]', data.toString().trim());
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error('[NPU Convert Error]', data.toString().trim());
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ 
            success: true, 
            outputPath,
            message: 'Model converted successfully for NPU',
            stdout
          });
        } else {
          resolve({ 
            success: false, 
            error: stderr || `Conversion failed with code ${code}`,
            stdout,
            stderr
          });
        }
      });
      
      proc.on('error', (error) => {
        resolve({ 
          success: false, 
          error: error.message 
        });
      });
    });
  });
}

// Helper to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// Unified Ledger IPC Handlers
// ============================================

async function setupLedgerHandlers(ipcMain, userDataPath) {
  if (!ledgerService) {
    console.warn('[Ledger] Service not available, skipping IPC handlers');
    return;
  }

  // Initialize ledger service
  try {
    await ledgerService.initLedgerService(userDataPath);
    console.log('[Ledger] Service initialized');
  } catch (error) {
    console.error('[Ledger] Failed to initialize:', error);
    return;
  }

  // Record events
  ipcMain.handle('ledger:recordEvent', (_, event) => {
    try {
      return ledgerService.recordEvent(event);
    } catch (error) {
      console.error('[Ledger] recordEvent failed:', error);
      return { error: error.message };
    }
  });

  // Record specific event types
  ipcMain.handle('ledger:recordMessage', (_, params) => {
    try {
      return ledgerService.recordMessage(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordWorkspaceSwitch', (_, params) => {
    try {
      return ledgerService.recordWorkspaceSwitch(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordModelSwitch', (_, params) => {
    try {
      return ledgerService.recordModelSwitch(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordGenerationStart', (_, params) => {
    try {
      return ledgerService.recordGenerationStart(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordGenerationComplete', (_, params) => {
    try {
      return ledgerService.recordGenerationComplete(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordFileOpen', (_, params) => {
    try {
      return ledgerService.recordFileOpen(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordTypingBurst', (_, params) => {
    try {
      return ledgerService.recordTypingBurst(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordUserAction', (_, params) => {
    try {
      return ledgerService.recordUserAction(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Evidence
  ipcMain.handle('ledger:addEvidence', (_, params) => {
    try {
      return ledgerService.addEvidence(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getEvidence', (_, eventId) => {
    try {
      return ledgerService.getEvidence(eventId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Action runs
  ipcMain.handle('ledger:createRun', (_, params) => {
    try {
      return ledgerService.createRun(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:updateRun', (_, { runId, updates }) => {
    try {
      return ledgerService.updateRun(runId, updates);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:addRunStep', (_, step) => {
    try {
      return ledgerService.addRunStep(step);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getRunSteps', (_, runId) => {
    try {
      return ledgerService.getRunSteps(runId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Decision forks
  ipcMain.handle('ledger:createDecisionFork', (_, fork) => {
    try {
      return ledgerService.createDecisionFork(fork);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Queries
  ipcMain.handle('ledger:listEvents', (_, filters) => {
    try {
      return ledgerService.listEvents(filters || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionEvents', (_, limit) => {
    try {
      return ledgerService.getSessionEvents(limit);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getFrictionSignals', (_, filters) => {
    try {
      return ledgerService.getFrictionSignals(filters || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getStats', () => {
    try {
      return ledgerService.getStats();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearEvents', () => {
    try {
      ledgerService.clearEvents();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearFrictionSignals', () => {
    try {
      ledgerService.clearFrictionSignals();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearAll', () => {
    try {
      ledgerService.clearAll();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:verifyChain', (_, limit) => {
    try {
      return ledgerService.verifyChain(limit);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionTimeline', (_, { sessionId, options }) => {
    try {
      return ledgerService.getSessionTimeline(sessionId, options || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionId', () => {
    try {
      return ledgerService.getSessionId();
    } catch (error) {
      return { error: error.message };
    }
  });

  // State inference handlers
  if (stateInference) {
    ipcMain.handle('soul:inferState', async () => {
      try {
        return await stateInference.inferState();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('soul:getPromptAdjustments', (_, { state, confidence }) => {
      try {
        return stateInference.getPromptAdjustments(state, confidence);
      } catch (error) {
        return { error: error.message };
      }
    });
  }

  // Intent compiler handlers
  if (intentSchema && intentExecutor) {
    ipcMain.handle('intent:compile', async (_, { intent }) => {
      try {
        // For now, return a mock plan structure
        // In production, this would call the LLM with getCompilerSystemPrompt()
        const mockPlan = {
          id: `plan_${Date.now()}`,
          intent,
          reasoning: 'Analysis based on intent',
          steps: [
            {
              type: 'search_codebase',
              description: 'Find relevant files',
              params: { query: intent.split(' ').slice(0, 3).join(' '), type: 'text' }
            },
            {
              type: 'checkpoint',
              description: 'Create safety checkpoint',
              params: { label: 'pre-changes', autoRollbackOnFailure: true }
            }
          ],
          created: new Date().toISOString(),
        };

        const validation = intentSchema.validatePlan(mockPlan);
        const complexity = intentSchema.estimatePlanComplexity(mockPlan);

        return {
          plan: mockPlan,
          valid: validation.valid,
          errors: validation.errors,
          complexity,
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:execute', async (_, { plan, options }) => {
      try {
        const result = await intentExecutor.executePlan(plan, options || {});
        return result;
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:validate', (_, { plan }) => {
      try {
        const validation = intentSchema.validatePlan(plan);
        const complexity = intentSchema.estimatePlanComplexity(plan);
        return { validation, complexity };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:getSystemPrompt', () => {
      try {
        return intentSchema.getCompilerSystemPrompt();
      } catch (error) {
        return { error: error.message };
      }
    });
  }

  // LMA handlers
  if (llamaBridge && datasetBuilder && trainingScheduler) {
    // Initialize LMA services
    llamaBridge.initialize(userDataPath).catch(console.error);
    trainingScheduler.initialize(userDataPath).catch(console.error);

    ipcMain.handle('lma:getStatus', async () => {
      try {
        // Check both backends
        const ollamaStatus = ollamaAdapters ? await ollamaAdapters.getAdapterStatus() : { available: false };
        
        return {
          llamaAvailable: llamaBridge.isAvailable(),
          ollamaAvailable: ollamaStatus.available,
          scheduler: trainingScheduler.getStatus(),
          loadedAdapters: llamaBridge.getLoadedAdapters(),
          ollamaAdapters: ollamaStatus.models || [],
          backend: ollamaStatus.available ? 'ollama' : (llamaBridge.isAvailable() ? 'llama.cpp' : 'none'),
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:listModels', async () => {
      try {
        return await llamaBridge.listModels();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:listAdapters', async () => {
      try {
        return await llamaBridge.listAdapters();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:loadAdapter', async (_, adapterName) => {
      try {
        return await llamaBridge.loadAdapter(adapterName);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:unloadAdapter', (_, adapterName) => {
      try {
        return llamaBridge.unloadAdapter(adapterName);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:buildDataset', async (_, options) => {
      try {
        return await datasetBuilder.buildDataset(options || {});
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:estimateTraining', (_, { dataset, config }) => {
      try {
        return datasetBuilder.estimateTrainingTime(dataset, config);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:schedulerEnable', () => {
      try {
        return trainingScheduler.enable();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:schedulerDisable', () => {
      try {
        return trainingScheduler.disable();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:triggerTraining', async (_, options) => {
      try {
        return await trainingScheduler.triggerTraining(options || {});
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:cancelTraining', () => {
      try {
        return trainingScheduler.cancelTraining();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:getHistory', () => {
      try {
        return trainingScheduler.getHistory();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:getSystemInfo', async () => {
      try {
        return await llamaBridge.getSystemInfo();
      } catch (error) {
        return { error: error.message };
      }
    });

    // Ollama-based adapter handlers
    if (ollamaAdapters) {
      ipcMain.handle('lma:createOllamaAdapter', async (_, config) => {
        try {
          // Get friction signals to extract insights
          const signals = ledgerService ? ledgerService.getFrictionSignals({ limit: 100 }) : [];
          const insights = ollamaAdapters.extractInsightsFromFriction(signals);
          
          return await ollamaAdapters.createPersonalizedModel({
            ...config,
            frictionInsights: insights,
          });
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:listOllamaAdapters', async () => {
        try {
          return await ollamaAdapters.listPersonalizedModels();
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:deleteOllamaAdapter', async (_, modelName) => {
        try {
          return await ollamaAdapters.deletePersonalizedModel(modelName);
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:getOllamaModels', async () => {
        try {
          return await ollamaAdapters.getOllamaModels();
        } catch (error) {
          return { error: error.message };
        }
      });
    }
  }
}

// Export saveDatabase for cleanup
module.exports = { setupIpcHandlers, saveDatabase, setupLedgerHandlers };
