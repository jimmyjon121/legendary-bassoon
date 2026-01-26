const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * Create a backup file containing the SQLite database and electron-store settings.
 * Backup format: JSON with base64-encoded DB contents.
 */
async function createBackup({ dbPath, store, targetPath }) {
  if (!dbPath || !store) {
    throw new Error('Database path or store not available');
  }

  const dbExists = fs.existsSync(dbPath);
  if (!dbExists) {
    throw new Error('Database file not found');
  }

  const dbBuffer = await fsPromises.readFile(dbPath);
  const settings = store.store || {};

  const backup = {
    version: '1',
    createdAt: new Date().toISOString(),
    dbBase64: dbBuffer.toString('base64'),
    settings,
  };

  const defaultName = `devforge-backup-${formatDate(new Date())}.devforge-backup`;
  const finalPath = targetPath && !targetPath.endsWith(path.sep)
    ? targetPath
    : targetPath
    ? path.join(targetPath, defaultName)
    : defaultName;

  await fsPromises.writeFile(finalPath, JSON.stringify(backup, null, 2), 'utf-8');
  return finalPath;
}

/**
 * Restore from a backup file. Caller is responsible for reloading the DB
 * or restarting the app afterwards.
 */
async function restoreBackup({ backupPath, dbPath, store }) {
  const data = await fsPromises.readFile(backupPath, 'utf-8');
  const backup = JSON.parse(data);

  if (!backup.dbBase64) {
    throw new Error('Invalid backup file (missing database payload)');
  }

  const dbBuffer = Buffer.from(backup.dbBase64, 'base64');
  await fsPromises.writeFile(dbPath, dbBuffer);

  if (backup.settings && store) {
    // Best-effort restore of settings
    store.clear();
    for (const [key, value] of Object.entries(backup.settings)) {
      store.set(key, value);
    }
  }

  return { version: backup.version, createdAt: backup.createdAt };
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}`;
}

module.exports = {
  createBackup,
  restoreBackup,
};


