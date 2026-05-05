/**
 * IPC Handlers - Modular Architecture
 * 
 * This file orchestrates all IPC handlers by delegating to domain-specific modules.
 * Each domain module handles a specific area of functionality:
 * 
 * - system-handlers.js: Window controls, hardware, power, settings
 * - storage-handlers.js: Database, backup, export
 * - ai-handlers.js: LLM streaming, RAG, whisper
 * - model-handlers.js: Model management, downloads, conversion
 * - image-handlers.js: Image generation (ComfyUI, etc.)
 * 
 * The main ipc-handlers.js file is preserved for backwards compatibility
 * but new handlers should be added to the appropriate domain module.
 */

const { setupSystemHandlers } = require('./system-handlers');
const { setupStorageHandlers } = require('./storage-handlers');
const { setupAIHandlers } = require('./ai-handlers');
const { setupModelHandlers } = require('./model-handlers');
const { setupImageHandlers } = require('./image-handlers');
const { setupCodeToolsHandlers } = require('./code-tools-handlers');
const { setupWebSearchHandlers } = require('./web-search-handlers');
const { setupSparkModelHubHandlers } = require('./spark-model-hub-handlers');
const { setupAgentHarnessHandlers } = require('./agent-harness-handlers');

/**
 * Setup all modular IPC handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main
 * @param {Electron.BrowserWindow} mainWindow - Main browser window
 * @param {Object} store - Electron store instance
 * @param {Object} db - Database instance
 */
function setupModularHandlers(ipcMain, mainWindow, store, db) {
  console.log('[IPC] Setting up modular handlers...');
  
  // System handlers (window, hardware, power, settings)
  setupSystemHandlers(ipcMain, mainWindow, store);
  
  // Storage handlers (database, backup, export)
  setupStorageHandlers(ipcMain, db, store);
  
  // AI handlers (LLM, RAG, whisper)
  setupAIHandlers(ipcMain, mainWindow, store, db);
  
  // Model handlers (downloads, conversion, library)
  setupModelHandlers(ipcMain, mainWindow, store);
  
  // Image handlers (ComfyUI, image generation)
  setupImageHandlers(ipcMain, mainWindow);
  
  // Code tools handlers (AI coding assistance)
  setupCodeToolsHandlers(ipcMain, mainWindow, store);
  
  // Web search handlers (DuckDuckGo search for AI)
  setupWebSearchHandlers(ipcMain);

  // Spark Model Hub handlers (local AI runtime command center)
  setupSparkModelHubHandlers(ipcMain, mainWindow, store);

  // Agent harness handlers (model profile persistence)
  setupAgentHarnessHandlers(ipcMain, mainWindow, store, db);

  console.log('[IPC] Modular handlers setup complete');
}

module.exports = {
  setupModularHandlers,
};
