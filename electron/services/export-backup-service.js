/**
 * ExportBackupService - Library and settings export/import
 * 
 * Features:
 * - Export library manifest (models, collections, settings)
 * - Import manifest on new machine
 * - Selective export (models only, collections only, etc.)
 * - Rehydrate downloads from manifest
 * - Backup scheduling
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const { app } = require('electron');

// Export format version
const MANIFEST_VERSION = '1.0.0';

/**
 * ExportBackupService class
 */
class ExportBackupService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.store = null;
    this.backupsDir = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize(dbInstance, storeInstance, userDataPath) {
    if (this.isInitialized) return;
    
    this.db = dbInstance;
    this.store = storeInstance;
    this.backupsDir = path.join(userDataPath, 'backups');
    
    await fsPromises.mkdir(this.backupsDir, { recursive: true });
    
    this.isInitialized = true;
    console.log('[ExportBackupService] Initialized');
  }

  /**
   * Export full library manifest
   */
  async exportManifest(options = {}) {
    const {
      includeModels = true,
      includeCollections = true,
      includeSettings = true,
      includeTags = true,
      includeDownloadHistory = false,
    } = options;
    
    const manifest = {
      version: MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      exportedFrom: {
        appVersion: app.getVersion(),
        platform: process.platform,
        hostname: require('os').hostname(),
      },
      models: [],
      collections: [],
      settings: {},
      tags: [],
      downloads: [],
    };
    
    try {
      // Export models
      if (includeModels && this.db) {
        const modelsResult = this.db.exec(`
          SELECT * FROM library_models ORDER BY name
        `);
        
        if (modelsResult.length > 0) {
          manifest.models = modelsResult[0].values.map(row => this._rowToObject(row, modelsResult[0].columns));
        }
      }
      
      // Export collections
      if (includeCollections && this.db) {
        const collectionsResult = this.db.exec(`
          SELECT * FROM model_collections WHERE type != 'curated' ORDER BY name
        `);
        
        if (collectionsResult.length > 0) {
          manifest.collections = collectionsResult[0].values.map(row => {
            const collection = this._rowToObject(row, collectionsResult[0].columns);
            
            // Get collection models
            const modelsResult = this.db.exec(`
              SELECT * FROM collection_models WHERE collectionId = ?
            `, [collection.id]);
            
            if (modelsResult.length > 0) {
              collection.models = modelsResult[0].values.map(r => ({
                provider: r[2],
                modelId: r[3],
                role: r[4],
                required: r[5] === 1,
              }));
            } else {
              collection.models = [];
            }
            
            return collection;
          });
        }
      }
      
      // Export settings
      if (includeSettings && this.store) {
        manifest.settings = {
          theme: this.store.get('theme'),
          defaultModel: this.store.get('currentModel'),
          defaultWorkspace: this.store.get('lastWorkspace'),
          ragInfluence: this.store.get('ragInfluence'),
          modelPaths: this.store.get('modelPaths'),
          customEngines: this.store.get('customEngines'),
          downloadSettings: this.store.get('downloadSettings'),
        };
      }
      
      // Export tags
      if (includeTags && this.db) {
        const tagsResult = this.db.exec(`
          SELECT DISTINCT name, color FROM model_tags ORDER BY name
        `);
        
        if (tagsResult.length > 0) {
          manifest.tags = tagsResult[0].values.map(row => ({
            name: row[0],
            color: row[1],
          }));
        }
      }
      
      // Export download history
      if (includeDownloadHistory && this.db) {
        const downloadsResult = this.db.exec(`
          SELECT * FROM downloads WHERE status = 'completed' ORDER BY completedAt DESC LIMIT 100
        `);
        
        if (downloadsResult.length > 0) {
          manifest.downloads = downloadsResult[0].values.map(row => 
            this._rowToObject(row, downloadsResult[0].columns)
          );
        }
      }
      
      // Generate checksum
      manifest.checksum = this._generateChecksum(manifest);
      
      this.emit('export:completed', { success: true, manifest });
      
      return manifest;
    } catch (error) {
      this.emit('export:error', { error: error.message });
      throw error;
    }
  }

  /**
   * Export manifest to file
   */
  async exportToFile(filePath, options = {}) {
    const manifest = await this.exportManifest(options);
    await fsPromises.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
    return { success: true, path: filePath, manifest };
  }

  /**
   * Import manifest
   */
  async importManifest(manifest, options = {}) {
    const {
      importModels = true,
      importCollections = true,
      importSettings = true,
      importTags = true,
      overwriteExisting = false,
      rehydrateDownloads = false,
    } = options;
    
    // Verify manifest version
    if (!manifest.version || !this._isCompatibleVersion(manifest.version)) {
      throw new Error(`Incompatible manifest version: ${manifest.version}`);
    }
    
    // Verify checksum
    const expectedChecksum = manifest.checksum;
    delete manifest.checksum;
    const actualChecksum = this._generateChecksum(manifest);
    manifest.checksum = expectedChecksum;
    
    if (expectedChecksum && actualChecksum !== expectedChecksum) {
      throw new Error('Manifest checksum mismatch - file may be corrupted');
    }
    
    const results = {
      models: { imported: 0, skipped: 0, errors: [] },
      collections: { imported: 0, skipped: 0, errors: [] },
      settings: { imported: false },
      tags: { imported: 0 },
      downloads: { queued: 0 },
    };
    
    try {
      // Import tags first
      if (importTags && manifest.tags && this.db) {
        for (const tag of manifest.tags) {
          try {
            this.db.run(`
              INSERT OR IGNORE INTO model_tags (name, color) VALUES (?, ?)
            `, [tag.name, tag.color]);
            results.tags.imported++;
          } catch (e) {
            // Ignore tag errors
          }
        }
      }
      
      // Import models
      if (importModels && manifest.models && this.db) {
        for (const model of manifest.models) {
          try {
            // Check if exists
            const existing = this.db.exec(`
              SELECT id FROM library_models WHERE id = ? OR (provider = ? AND modelId = ?)
            `, [model.id, model.provider, model.modelId]);
            
            if (existing.length > 0 && existing[0].values.length > 0 && !overwriteExisting) {
              results.models.skipped++;
              continue;
            }
            
            // Insert or update
            this.db.run(`
              INSERT OR REPLACE INTO library_models 
              (id, name, provider, modelId, type, format, size, path, favorite, rating, notes, alias, usageCount, lastUsed, tags, metadata, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              model.id,
              model.name,
              model.provider,
              model.modelId,
              model.type,
              model.format,
              model.size,
              model.path,
              model.favorite ? 1 : 0,
              model.rating,
              model.notes,
              model.alias,
              model.usageCount || 0,
              model.lastUsed,
              JSON.stringify(model.tags || []),
              JSON.stringify(model.metadata || {}),
              model.createdAt || new Date().toISOString(),
              new Date().toISOString(),
            ]);
            
            results.models.imported++;
          } catch (e) {
            results.models.errors.push({ model: model.name, error: e.message });
          }
        }
      }
      
      // Import collections
      if (importCollections && manifest.collections && this.db) {
        for (const collection of manifest.collections) {
          try {
            // Check if exists
            const existing = this.db.exec(`
              SELECT id FROM model_collections WHERE id = ?
            `, [collection.id]);
            
            if (existing.length > 0 && existing[0].values.length > 0 && !overwriteExisting) {
              results.collections.skipped++;
              continue;
            }
            
            // Insert collection
            this.db.run(`
              INSERT OR REPLACE INTO model_collections 
              (id, name, description, type, category, icon, estimatedSize, difficulty, version, isPublic, tags, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              collection.id,
              collection.name,
              collection.description,
              'shared', // Mark as shared (imported)
              collection.category,
              collection.icon,
              collection.estimatedSize,
              collection.difficulty,
              collection.version,
              0,
              JSON.stringify(collection.tags || []),
              collection.createdAt || new Date().toISOString(),
              new Date().toISOString(),
            ]);
            
            // Insert collection models
            if (collection.models) {
              for (let i = 0; i < collection.models.length; i++) {
                const model = collection.models[i];
                this.db.run(`
                  INSERT OR REPLACE INTO collection_models 
                  (collectionId, provider, modelId, role, required, orderIndex)
                  VALUES (?, ?, ?, ?, ?, ?)
                `, [collection.id, model.provider, model.modelId, model.role, model.required ? 1 : 0, i]);
              }
            }
            
            results.collections.imported++;
          } catch (e) {
            results.collections.errors.push({ collection: collection.name, error: e.message });
          }
        }
      }
      
      // Import settings
      if (importSettings && manifest.settings && this.store) {
        try {
          if (manifest.settings.theme) this.store.set('theme', manifest.settings.theme);
          if (manifest.settings.defaultModel) this.store.set('currentModel', manifest.settings.defaultModel);
          if (manifest.settings.ragInfluence) this.store.set('ragInfluence', manifest.settings.ragInfluence);
          if (manifest.settings.modelPaths) this.store.set('modelPaths', manifest.settings.modelPaths);
          if (manifest.settings.customEngines) this.store.set('customEngines', manifest.settings.customEngines);
          if (manifest.settings.downloadSettings) this.store.set('downloadSettings', manifest.settings.downloadSettings);
          results.settings.imported = true;
        } catch (e) {
          results.settings.error = e.message;
        }
      }
      
      // Queue downloads for rehydration
      if (rehydrateDownloads && manifest.downloads) {
        // This would integrate with DownloadManagerV2
        results.downloads.queued = manifest.downloads.length;
        this.emit('import:rehydrateDownloads', manifest.downloads);
      }
      
      this.emit('import:completed', { success: true, results });
      
      return results;
    } catch (error) {
      this.emit('import:error', { error: error.message });
      throw error;
    }
  }

  /**
   * Import from file
   */
  async importFromFile(filePath, options = {}) {
    const content = await fsPromises.readFile(filePath, 'utf8');
    const manifest = JSON.parse(content);
    return this.importManifest(manifest, options);
  }

  /**
   * Create automated backup
   */
  async createBackup(name = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = name || `backup-${timestamp}`;
    const backupPath = path.join(this.backupsDir, `${backupName}.json`);
    
    const result = await this.exportToFile(backupPath, {
      includeModels: true,
      includeCollections: true,
      includeSettings: true,
      includeTags: true,
      includeDownloadHistory: true,
    });
    
    // Cleanup old backups (keep last 10)
    await this._cleanupOldBackups(10);
    
    this.emit('backup:created', { path: backupPath, name: backupName });
    
    return { success: true, path: backupPath, name: backupName };
  }

  /**
   * List available backups
   */
  async listBackups() {
    const files = await fsPromises.readdir(this.backupsDir);
    const backups = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(this.backupsDir, file);
      const stats = await fsPromises.stat(filePath);
      
      try {
        const content = await fsPromises.readFile(filePath, 'utf8');
        const manifest = JSON.parse(content);
        
        backups.push({
          name: file.replace('.json', ''),
          path: filePath,
          size: stats.size,
          createdAt: manifest.exportedAt,
          modelsCount: manifest.models?.length || 0,
          collectionsCount: manifest.collections?.length || 0,
        });
      } catch (e) {
        // Skip invalid backups
      }
    }
    
    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupPath, options = {}) {
    return this.importFromFile(backupPath, {
      importModels: true,
      importCollections: true,
      importSettings: true,
      importTags: true,
      overwriteExisting: true,
      ...options,
    });
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupPath) {
    await fsPromises.unlink(backupPath);
    this.emit('backup:deleted', { path: backupPath });
    return { success: true };
  }

  /**
   * Get export preview (summary of what will be exported)
   */
  async getExportPreview() {
    const preview = {
      models: 0,
      collections: 0,
      tags: 0,
      settings: [],
      estimatedSize: 0,
    };
    
    if (this.db) {
      const modelsCount = this.db.exec('SELECT COUNT(*) FROM library_models');
      preview.models = modelsCount[0]?.values[0]?.[0] || 0;
      
      const collectionsCount = this.db.exec("SELECT COUNT(*) FROM model_collections WHERE type != 'curated'");
      preview.collections = collectionsCount[0]?.values[0]?.[0] || 0;
      
      const tagsCount = this.db.exec('SELECT COUNT(DISTINCT name) FROM model_tags');
      preview.tags = tagsCount[0]?.values[0]?.[0] || 0;
    }
    
    if (this.store) {
      if (this.store.get('theme')) preview.settings.push('Theme');
      if (this.store.get('currentModel')) preview.settings.push('Default Model');
      if (this.store.get('modelPaths')) preview.settings.push('Model Paths');
      if (this.store.get('customEngines')) preview.settings.push('Custom Engines');
    }
    
    // Estimate size (rough calculation)
    preview.estimatedSize = (preview.models * 500) + (preview.collections * 1000) + (preview.tags * 50) + 2000;
    
    return preview;
  }

  /**
   * Cleanup old backups
   */
  async _cleanupOldBackups(keepCount) {
    const backups = await this.listBackups();
    
    if (backups.length <= keepCount) return;
    
    const toDelete = backups.slice(keepCount);
    for (const backup of toDelete) {
      await fsPromises.unlink(backup.path).catch(() => {});
    }
  }

  /**
   * Generate checksum for manifest
   */
  _generateChecksum(manifest) {
    const content = JSON.stringify({
      models: manifest.models,
      collections: manifest.collections,
      settings: manifest.settings,
      tags: manifest.tags,
    });
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Check version compatibility
   */
  _isCompatibleVersion(version) {
    const [major] = version.split('.');
    const [currentMajor] = MANIFEST_VERSION.split('.');
    return major === currentMajor;
  }

  /**
   * Convert database row to object
   */
  _rowToObject(row, columns) {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  }
}

// Singleton
let exportBackupServiceInstance = null;

function getExportBackupService() {
  if (!exportBackupServiceInstance) {
    exportBackupServiceInstance = new ExportBackupService();
  }
  return exportBackupServiceInstance;
}

module.exports = {
  ExportBackupService,
  getExportBackupService,
  MANIFEST_VERSION,
};



