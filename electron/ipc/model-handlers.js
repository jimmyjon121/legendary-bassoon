/**
 * Model IPC Handlers
 * 
 * Handles model management operations:
 * - Model downloads
 * - Model conversion (GGUF, etc.)
 * - Model library management
 * - Model presets
 */

const { getService } = require('../services/lazy-loader');

// Lazy service getters
const getModelManager = () => getService('model-manager')?.getModelManager?.() || null;
const getModelDownloader = () => getService('model-downloader');
const getModelConverter = () => getService('model-converter')?.createModelConverter?.() || null;

/**
 * Setup model-related IPC handlers
 */
function setupModelHandlers(ipcMain, mainWindow, store) {
  // ─────────────────────────────────────────────────────────────────────────
  // MODEL LIBRARY
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-local-models', async () => {
    try {
      const manager = getModelManager();
      if (!manager) {
        return [];
      }
      return await manager.getLocalModels();
    } catch (error) {
      console.error('Get local models error:', error);
      return [];
    }
  });

  ipcMain.handle('get-model-info', async (_, modelName) => {
    try {
      const manager = getModelManager();
      if (!manager) {
        return null;
      }
      return await manager.getModelInfo(modelName);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('delete-model', async (_, modelName) => {
    try {
      const manager = getModelManager();
      if (!manager) {
        return { success: false, error: 'Model manager not available' };
      }
      return await manager.deleteModel(modelName);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL DOWNLOADS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('download-model', async (_, modelUrl, options = {}) => {
    try {
      const downloader = getModelDownloader();
      if (!downloader?.downloadModel) {
        return { success: false, error: 'Model downloader not available' };
      }
      return await downloader.downloadModel(modelUrl, options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-download-progress', async (_, downloadId) => {
    try {
      const downloader = getModelDownloader();
      if (!downloader?.getProgress) {
        return null;
      }
      return await downloader.getProgress(downloadId);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('cancel-download', async (_, downloadId) => {
    try {
      const downloader = getModelDownloader();
      if (!downloader?.cancelDownload) {
        return { success: false, error: 'Model downloader not available' };
      }
      return await downloader.cancelDownload(downloadId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL CONVERSION
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('convert-model', async (_, sourcePath, targetFormat, options = {}) => {
    try {
      const converter = getModelConverter();
      if (!converter) {
        return { success: false, error: 'Model converter not available' };
      }
      return await converter.convert(sourcePath, targetFormat, options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-conversion-status', async (_, jobId) => {
    try {
      const converter = getModelConverter();
      if (!converter) {
        return null;
      }
      return await converter.getStatus(jobId);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('get-supported-conversions', async () => {
    try {
      const converter = getModelConverter();
      if (!converter) {
        return [];
      }
      return converter.getSupportedConversions();
    } catch (error) {
      return [];
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL PRESETS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-model-presets', async (_, modelName, workspace) => {
    try {
      // Presets are stored in settings
      const presets = store?.get(`presets.${modelName}.${workspace}`) || [];
      return presets;
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('save-model-preset', async (_, modelName, workspace, preset) => {
    try {
      const key = `presets.${modelName}.${workspace}`;
      const existing = store?.get(key) || [];
      
      // Update or add preset
      const index = existing.findIndex(p => p.id === preset.id);
      if (index >= 0) {
        existing[index] = preset;
      } else {
        existing.push(preset);
      }
      
      store?.set(key, existing);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-model-preset', async (_, modelName, workspace, presetId) => {
    try {
      const key = `presets.${modelName}.${workspace}`;
      const existing = store?.get(key) || [];
      const filtered = existing.filter(p => p.id !== presetId);
      store?.set(key, filtered);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:Model] Handlers registered');
}

module.exports = {
  setupModelHandlers,
};
