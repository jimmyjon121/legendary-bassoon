/**
 * Storage IPC Handlers
 * 
 * Handles data persistence operations:
 * - Database queries (conversations, messages)
 * - Backup/restore
 * - Export functionality
 * - Encryption for NSFW content
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { getService } = require('../services/lazy-loader');

// Lazy service getters
const getExportService = () => getService('export-service');
const getBackupService = () => getService('backup-service');

/**
 * Setup storage-related IPC handlers
 */
function setupStorageHandlers(ipcMain, db, store) {
  // ─────────────────────────────────────────────────────────────────────────
  // DATABASE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('db-run', async (_, sql, params = []) => {
    if (!db) return { error: 'Database not initialized' };
    try {
      db.run(sql, params);
      return { success: true };
    } catch (error) {
      console.error('DB run error:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('db-get', async (_, sql, params = []) => {
    if (!db) return null;
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    } catch (error) {
      console.error('DB get error:', error);
      return null;
    }
  });

  ipcMain.handle('db-all', async (_, sql, params = []) => {
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
      console.error('DB all error:', error);
      return [];
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ENCRYPTION (for NSFW workspace)
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('encrypt', async (_, text, password) => {
    try {
      const key = crypto.scryptSync(password, 'devforge-salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      
      return {
        iv: iv.toString('hex'),
        encrypted,
        authTag: authTag.toString('hex'),
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  });

  ipcMain.handle('decrypt', async (_, encryptedData, password) => {
    try {
      const key = crypto.scryptSync(password, 'devforge-salt', 32);
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw error;
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BACKUP & RESTORE
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('create-backup', async () => {
    try {
      const backupSvc = getBackupService();
      if (!backupSvc?.createBackup) {
        return { error: 'Backup service not available' };
      }
      return await backupSvc.createBackup();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('list-backups', async () => {
    try {
      const backupSvc = getBackupService();
      if (!backupSvc?.listBackups) {
        return [];
      }
      return await backupSvc.listBackups();
    } catch (error) {
      console.error('List backups error:', error);
      return [];
    }
  });

  ipcMain.handle('restore-backup', async (_, backupPath) => {
    try {
      const backupSvc = getBackupService();
      if (!backupSvc?.restoreBackup) {
        return { error: 'Backup service not available' };
      }
      return await backupSvc.restoreBackup(backupPath);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('delete-backup', async (_, backupPath) => {
    try {
      const backupSvc = getBackupService();
      if (!backupSvc?.deleteBackup) {
        return { error: 'Backup service not available' };
      }
      return await backupSvc.deleteBackup(backupPath);
    } catch (error) {
      return { error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('export-conversation', async (_, conversationId, format, options = {}) => {
    try {
      const exportSvc = getExportService();
      if (!exportSvc?.exportConversation) {
        return { error: 'Export service not available' };
      }
      return await exportSvc.exportConversation(conversationId, format, options);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('get-export-formats', () => {
    try {
      const exportSvc = getExportService();
      if (!exportSvc?.getExportFormats) {
        return ['json', 'markdown', 'txt'];
      }
      return exportSvc.getExportFormats();
    } catch (error) {
      return ['json', 'markdown', 'txt'];
    }
  });

  console.log('[IPC:Storage] Handlers registered');
}

module.exports = {
  setupStorageHandlers,
};
