/**
 * Image Generation IPC Handlers (Modular)
 * 
 * NOTE: These handlers are currently NOT active. The legacy ipc-handlers.js
 * registers all image channels. This file exists for future modularization.
 * 
 * When activated, remove the corresponding handlers from ipc-handlers.js
 * to avoid duplicate registration errors.
 * 
 * Handles:
 * - ComfyUI management (install, start, stop)
 * - Image generation via ImageService
 * - Auto backend detection/setup via ImageBackendAuto
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

  // ─────────────────────────────────────────────────────────────────────────
  // IMAGE GENERATION (via ImageService)
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('generateImage', async (_, params) => {
    try {
      const imageService = getImageService();
      if (!imageService) throw new Error('Image service not available');
      if (!imageService.isInitialized) await imageService.initialize();
      return await imageService.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getImageStatus', async () => {
    try {
      const imageService = getImageService();
      if (imageService) {
        if (!imageService.isInitialized) await imageService.initialize();
        return await imageService.getStatus();
      }
      // Fall back to ComfyUI manager
      const manager = getComfyUIManager();
      if (manager) {
        const status = await manager.getStatus();
        return { running: status.running, backend: status.running ? 'comfyui' : null };
      }
      return { running: false, error: 'No image backend available' };
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
      if (imageService) return imageService.getModelPresets();
      return {
        sd15: { name: 'SD 1.5', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7 },
        sdxl: { name: 'SDXL', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 25, defaultCfg: 7 },
        flux: { name: 'Flux', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 20, defaultCfg: 1 }
      };
    } catch (error) {
      return {};
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AUTO BACKEND (via ImageBackendAuto)
  // ─────────────────────────────────────────────────────────────────────────
  
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

  console.log('[IPC:Image] Handlers registered');
}

module.exports = {
  setupImageHandlers,
};
