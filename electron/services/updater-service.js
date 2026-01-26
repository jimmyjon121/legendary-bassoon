let autoUpdater = null;

try {
  // Lazy require so the app still runs if electron-updater isn't installed
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  autoUpdater = null;
}

function isSupported() {
  return !!autoUpdater;
}

function configure() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;
}

async function checkForUpdates() {
  if (!autoUpdater) {
    return { supported: false, updateAvailable: false };
  }

  configure();

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return { supported: true, updateAvailable: false };
    }

    const info = result.updateInfo;
    return {
      supported: true,
      updateAvailable: true,
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    };
  } catch (error) {
    return {
      supported: true,
      updateAvailable: false,
      error: error.message,
    };
  }
}

async function downloadUpdate() {
  if (!autoUpdater) {
    throw new Error('Auto updater not available');
  }

  configure();
  await autoUpdater.downloadUpdate();
  return { success: true };
}

async function installUpdate() {
  if (!autoUpdater) {
    throw new Error('Auto updater not available');
  }

  autoUpdater.quitAndInstall();
  return { success: true };
}

module.exports = {
  isSupported,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
};


