/**
 * System IPC Handlers
 * 
 * Handles system-level operations:
 * - Window controls (minimize, maximize, close)
 * - Hardware detection
 * - Power mode management
 * - Settings management
 * - File dialogs
 */

const { dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getService } = require('../services/lazy-loader');
const { getPowerMode } = require('../services/power-mode');

// Lazy service getters
const getHardwareDetection = () => getService('hardware-detection');

/**
 * Setup system-related IPC handlers
 */
function setupSystemHandlers(ipcMain, mainWindow, store) {
  // ─────────────────────────────────────────────────────────────────────────
  // WINDOW CONTROLS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('close-window', () => {
    mainWindow?.close();
  });

  ipcMain.handle('is-maximized', () => {
    return mainWindow?.isMaximized() || false;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-settings', (_, key) => {
    return store?.get(key);
  });

  ipcMain.handle('set-settings', (_, key, value) => {
    store?.set(key, value);
    return true;
  });

  ipcMain.handle('get-settings-batch', (_, keys) => {
    const result = {};
    for (const key of keys) {
      result[key] = store?.get(key);
    }
    return result;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FILE DIALOGS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('select-file', async (_, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options.properties || ['openFile'],
      filters: options.filters || [],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('save-file-dialog', async (_, options = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options.defaultPath,
      filters: options.filters || [],
    });
    return result.canceled ? null : result.filePath;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // HARDWARE DETECTION
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('detect-hardware', async () => {
    try {
      const hwService = getHardwareDetection();
      if (!hwService) {
        return { error: 'Hardware detection service not available' };
      }
      return await hwService.detectHardware();
    } catch (error) {
      console.error('Hardware detection error:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('get-hardware-stats', async () => {
    try {
      const hwService = getHardwareDetection();
      if (!hwService) {
        return { error: 'Hardware detection service not available' };
      }
      return await hwService.getStats();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POWER MODE
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('enable-power-mode', async () => {
    try {
      const powerMode = getPowerMode();
      return await powerMode.enable();
    } catch (error) {
      console.error('Failed to enable power mode:', error);
      return { enabled: false, error: error.message };
    }
  });

  ipcMain.handle('disable-power-mode', async () => {
    try {
      const powerMode = getPowerMode();
      return await powerMode.disable();
    } catch (error) {
      console.error('Failed to disable power mode:', error);
      return { enabled: true, error: error.message };
    }
  });

  ipcMain.handle('get-power-mode-status', () => {
    try {
      const powerMode = getPowerMode();
      return powerMode.getStatus();
    } catch (error) {
      return { enabled: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SHELL OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('open-external', async (_, url) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('open-path', async (_, filePath) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle('show-item-in-folder', async (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // APP INFO
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('get-sovereignty-status', () => {
    // Check if we're running fully local
    const llmEndpoint = store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const isLocalLLM = llmEndpoint.includes('127.0.0.1') || llmEndpoint.includes('localhost');
    
    return {
      localOnly: isLocalLLM,
      llmEndpoint,
    };
  });

  console.log('[IPC:System] Handlers registered');
}

module.exports = {
  setupSystemHandlers,
};
