/**
 * Image Generation IPC Handlers
 * 
 * Handles image generation operations:
 * - ComfyUI management (install, start, stop)
 * - Image generation
 * - Model management for image gen
 */

const { getService } = require('../services/lazy-loader');

// Lazy service getters
const getComfyUIManager = () => getService('comfyui-manager')?.getComfyUIManager?.() || null;
const getImageService = () => getService('image-service')?.getImageService?.() || null;
const getImageBackendAuto = () => getService('image-backend-auto')?.getImageBackendAuto?.() || null;

/**
 * Setup image generation IPC handlers
 */
function setupImageHandlers(ipcMain, mainWindow) {
  // ─────────────────────────────────────────────────────────────────────────
  // COMFYUI MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('comfyui:getStatus', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { installed: false, running: false, error: 'ComfyUI manager not available' };
      }
      return await manager.init();
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:install', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { success: false, error: 'ComfyUI manager not available' };
      }
      
      // Send progress updates to renderer
      const onProgress = (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('comfyui:progress', data);
        }
      };
      
      return await manager.installComfyUI(onProgress);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:start', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { success: false, error: 'ComfyUI manager not available' };
      }
      return await manager.startComfyUI();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:stop', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { success: false, error: 'ComfyUI manager not available' };
      }
      return await manager.stopComfyUI();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:getModels', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return [];
      }
      return await manager.getAvailableModels();
    } catch (error) {
      console.error('Get ComfyUI models error:', error);
      return [];
    }
  });

  ipcMain.handle('comfyui:downloadModel', async (_, modelUrl, modelName) => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { success: false, error: 'ComfyUI manager not available' };
      }
      
      const onProgress = (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('comfyui:modelProgress', { modelName, progress });
        }
      };
      
      return await manager.downloadModel(modelUrl, modelName, onProgress);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMAGE GENERATION
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('image:generate', async (_, params) => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return { success: false, error: 'Image service not available' };
      }
      return await imageService.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:getModels', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return [];
      }
      return await imageService.getModels();
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('image:interrupt', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return { success: false };
      }
      return await imageService.interrupt();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:health', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return { healthy: false, error: 'Image service not available' };
      }
      return await imageService.healthCheck();
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AUTO BACKEND DETECTION
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('image:autoDetect', async () => {
    try {
      const autoBackend = getImageBackendAuto();
      if (!autoBackend) {
        return { detected: false, error: 'Auto detection not available' };
      }
      return await autoBackend.detect();
    } catch (error) {
      return { detected: false, error: error.message };
    }
  });

  ipcMain.handle('image:autoSetup', async () => {
    try {
      const autoBackend = getImageBackendAuto();
      if (!autoBackend) {
        return { success: false, error: 'Auto setup not available' };
      }
      
      const onProgress = (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('image:autoSetupProgress', data);
        }
      };
      
      return await autoBackend.setup(onProgress);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:Image] Handlers registered');
}

module.exports = {
  setupImageHandlers,
};
