/**
 * DevForge Spark Model Hub IPC Handlers
 *
 * The renderer gets fixed, narrow actions only. All Ollama, Docker, nvidia-smi,
 * file-system, and Continue config operations stay in the Electron main process.
 */

const { SparkModelHubService } = require('../services/spark-model-hub-service');

let hub = null;

function getHub(mainWindow, store) {
  if (!hub) {
    hub = new SparkModelHubService({ store });
    hub.on('job', (job) => {
      try {
        mainWindow?.webContents?.send?.('sparkModelHub:job', job);
      } catch {
        // Window may be closing; job state remains available via jobs().
      }
    });
  }
  return hub;
}

function setupSparkModelHubHandlers(ipcMain, mainWindow, store) {
  const service = getHub(mainWindow, store);

  ipcMain.handle('sparkModelHub:dashboard', async () => service.getDashboard());
  ipcMain.handle('sparkModelHub:status', async () => service.getSystemStatus());
  ipcMain.handle('sparkModelHub:ollamaHealth', async () => service.ollamaHealth());
  ipcMain.handle('sparkModelHub:ollamaModels', async () => service.getOllamaModels());
  ipcMain.handle('sparkModelHub:loadedModels', async () => service.getLoadedModels());
  ipcMain.handle('sparkModelHub:scanLmStudio', async () => service.scanLmStudio());
  ipcMain.handle('sparkModelHub:recommendations', async () => service.getRecommendations());
  ipcMain.handle('sparkModelHub:jobs', async () => ({ success: true, jobs: service.getJobs() }));
  ipcMain.handle('sparkModelHub:openWebUiStatus', async () => service.openWebUiStatus());

  ipcMain.handle('sparkModelHub:pullModel', async (_, modelName) => service.pullModel(modelName));
  ipcMain.handle('sparkModelHub:runModel', async (_, modelName) => service.runModel(modelName));
  ipcMain.handle('sparkModelHub:stopModel', async (_, modelName) => service.stopModel(modelName));
  ipcMain.handle('sparkModelHub:deleteModel', async (_, modelName) => service.deleteModel(modelName));
  ipcMain.handle('sparkModelHub:restartOllama', async () => service.restartOllama());

  ipcMain.handle('sparkModelHub:importGgufToOllama', async (_, payload = {}) => service.importGgufToOllama(payload));
  ipcMain.handle('sparkModelHub:registerLocalGguf', async (_, payload = {}) => service.registerLocalGguf(payload));
  ipcMain.handle('sparkModelHub:setContinueModel', async (_, payload = {}) => service.setContinueModel(payload));
  ipcMain.handle('sparkModelHub:getContinueConfigStatus', async () => service.getContinueConfigStatus());

  console.log('[IPC:SparkModelHub] Handlers registered');
}

module.exports = {
  setupSparkModelHubHandlers,
};
