/**
 * LibraryService - Personal model library management
 * 
 * Features:
 * - Tags, notes, favorites
 * - Model aliases
 * - Star ratings
 * - Usage statistics
 * - Collections/bundles
 * - Bulk actions
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const initSqlJs = require('sql.js');

/**
 * LibraryModel - A model in the user's library
 */
class LibraryModel {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name;
    this.path = data.path;
    this.filename = data.filename;
    this.size = data.size || 0;
    this.format = data.format;
    this.modelType = data.modelType;
    this.provider = data.provider || 'local';
    this.providerId = data.providerId || null;
    
    // User metadata
    this.alias = data.alias || null;
    this.tags = data.tags || [];
    this.notes = data.notes || '';
    this.favorite = data.favorite || false;
    this.rating = data.rating || 0; // 0-5 stars
    this.color = data.color || null; // Custom color label
    
    // Usage stats
    this.useCount = data.useCount || 0;
    this.lastUsed = data.lastUsed || null;
    this.totalTokens = data.totalTokens || 0;
    this.avgResponseTime = data.avgResponseTime || 0;
    
    // Collections
    this.collections = data.collections || [];
    
    // Timestamps
    this.addedAt = data.addedAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      path: this.path,
      filename: this.filename,
      size: this.size,
      format: this.format,
      modelType: this.modelType,
      provider: this.provider,
      providerId: this.providerId,
      alias: this.alias,
      tags: this.tags,
      notes: this.notes,
      favorite: this.favorite,
      rating: this.rating,
      color: this.color,
      useCount: this.useCount,
      lastUsed: this.lastUsed,
      totalTokens: this.totalTokens,
      avgResponseTime: this.avgResponseTime,
      collections: this.collections,
      addedAt: this.addedAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Collection - A group of models
 */
class Collection {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name;
    this.description = data.description || '';
    this.icon = data.icon || '📁';
    this.color = data.color || '#3b82f6';
    this.modelIds = data.modelIds || [];
    this.isDefault = data.isDefault || false;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      color: this.color,
      modelIds: this.modelIds,
      isDefault: this.isDefault,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * LibraryService class
 */
class LibraryService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.dbPath = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the library database
   */
  async initialize(userDataPath) {
    if (this.isInitialized) return;
    
    try {
      this.dbPath = path.join(userDataPath, 'library.db');
      
      const SQL = await initSqlJs();
      
      // Load or create database
      let dbBuffer = null;
      try {
        if (fs.existsSync(this.dbPath)) {
          dbBuffer = await fsPromises.readFile(this.dbPath);
        }
      } catch (err) {
        console.warn('[LibraryService] Could not load existing DB:', err.message);
      }
      
      this.db = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();
      
      // Create schema
      this._createSchema();
      
      await this._saveDb();
      
      this.isInitialized = true;
      console.log('[LibraryService] Initialized');
      
    } catch (error) {
      console.error('[LibraryService] Initialization failed:', error);
      throw error;
    }
  }

  _createSchema() {
    // Models table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT UNIQUE,
        filename TEXT,
        size INTEGER DEFAULT 0,
        format TEXT,
        modelType TEXT,
        provider TEXT,
        providerId TEXT,
        alias TEXT,
        tags TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        favorite INTEGER DEFAULT 0,
        rating INTEGER DEFAULT 0,
        color TEXT,
        useCount INTEGER DEFAULT 0,
        lastUsed TEXT,
        totalTokens INTEGER DEFAULT 0,
        avgResponseTime REAL DEFAULT 0,
        collections TEXT DEFAULT '[]',
        addedAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    
    // Collections table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT '📁',
        color TEXT DEFAULT '#3b82f6',
        modelIds TEXT DEFAULT '[]',
        isDefault INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    
    // Tags table (for quick lookup)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT,
        count INTEGER DEFAULT 0
      )
    `);
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_models_name ON models(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_models_type ON models(modelType)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_models_favorite ON models(favorite)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_models_rating ON models(rating)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_models_lastUsed ON models(lastUsed)`);
    
    // Create default collections
    this._createDefaultCollections();
  }

  _createDefaultCollections() {
    const defaults = [
      { id: 'favorites', name: 'Favorites', icon: '⭐', isDefault: true },
      { id: 'recently-used', name: 'Recently Used', icon: '🕐', isDefault: true },
      { id: 'high-rated', name: 'Top Rated', icon: '🏆', isDefault: true },
    ];
    
    for (const def of defaults) {
      const existing = this.db.exec(`SELECT id FROM collections WHERE id = ?`, [def.id]);
      if (existing.length === 0 || existing[0].values.length === 0) {
        this.db.run(
          `INSERT OR IGNORE INTO collections (id, name, icon, isDefault, createdAt, updatedAt)
           VALUES (?, ?, ?, 1, ?, ?)`,
          [def.id, def.name, def.icon, new Date().toISOString(), new Date().toISOString()]
        );
      }
    }
  }

  async _saveDb() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fsPromises.writeFile(this.dbPath, buffer);
    } catch (error) {
      console.error('[LibraryService] Failed to save DB:', error);
    }
  }

  // ============================================
  // MODEL OPERATIONS
  // ============================================

  /**
   * Add a model to the library
   */
  async addModel(modelData) {
    const model = new LibraryModel(modelData);
    
    this.db.run(`
      INSERT OR REPLACE INTO models (
        id, name, path, filename, size, format, modelType, provider, providerId,
        alias, tags, notes, favorite, rating, color,
        useCount, lastUsed, totalTokens, avgResponseTime, collections,
        addedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      model.id, model.name, model.path, model.filename, model.size, model.format,
      model.modelType, model.provider, model.providerId,
      model.alias, JSON.stringify(model.tags), model.notes, model.favorite ? 1 : 0,
      model.rating, model.color,
      model.useCount, model.lastUsed, model.totalTokens, model.avgResponseTime,
      JSON.stringify(model.collections),
      model.addedAt, model.updatedAt,
    ]);
    
    await this._saveDb();
    this.emit('model:added', model.toJSON());
    
    return model.id;
  }

  /**
   * Update a model
   */
  async updateModel(id, updates) {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'addedAt') continue; // Don't allow updating these
      
      let dbValue = value;
      if (key === 'tags' || key === 'collections') {
        dbValue = JSON.stringify(value);
      } else if (key === 'favorite') {
        dbValue = value ? 1 : 0;
      }
      
      fields.push(`${key} = ?`);
      values.push(dbValue);
    }
    
    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);
    
    this.db.run(`UPDATE models SET ${fields.join(', ')} WHERE id = ?`, values);
    
    await this._saveDb();
    this.emit('model:updated', { id, updates });
    
    return true;
  }

  /**
   * Delete a model from library
   */
  async deleteModel(id) {
    this.db.run(`DELETE FROM models WHERE id = ?`, [id]);
    await this._saveDb();
    this.emit('model:deleted', { id });
    return true;
  }

  /**
   * Get a model by ID
   */
  getModel(id) {
    const results = this.db.exec(`SELECT * FROM models WHERE id = ?`, [id]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return this._rowToModel(results[0].columns, results[0].values[0]);
  }

  /**
   * Get a model by path
   */
  getModelByPath(modelPath) {
    const results = this.db.exec(`SELECT * FROM models WHERE path = ?`, [modelPath]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return this._rowToModel(results[0].columns, results[0].values[0]);
  }

  /**
   * Get all models
   */
  getAllModels(options = {}) {
    let query = 'SELECT * FROM models';
    const conditions = [];
    const params = [];
    
    if (options.modelType) {
      conditions.push('modelType = ?');
      params.push(options.modelType);
    }
    
    if (options.favorite) {
      conditions.push('favorite = 1');
    }
    
    if (options.minRating) {
      conditions.push('rating >= ?');
      params.push(options.minRating);
    }
    
    if (options.tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${options.tag}"%`);
    }
    
    if (options.collection) {
      conditions.push('collections LIKE ?');
      params.push(`%"${options.collection}"%`);
    }
    
    if (options.search) {
      conditions.push('(name LIKE ? OR alias LIKE ? OR notes LIKE ?)');
      const searchTerm = `%${options.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Sorting
    const sortField = options.sortBy || 'addedAt';
    const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortField} ${sortDir}`;
    
    // Pagination
    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
      if (options.offset) {
        query += ` OFFSET ${options.offset}`;
      }
    }
    
    const results = this.db.exec(query, params);
    if (results.length === 0) return [];
    
    return results[0].values.map(row => this._rowToModel(results[0].columns, row));
  }

  /**
   * Record model usage
   */
  async recordUsage(id, tokens = 0, responseTime = 0) {
    const model = this.getModel(id);
    if (!model) return false;
    
    const newUseCount = model.useCount + 1;
    const newTotalTokens = model.totalTokens + tokens;
    const newAvgResponseTime = model.useCount > 0
      ? ((model.avgResponseTime * model.useCount) + responseTime) / newUseCount
      : responseTime;
    
    await this.updateModel(id, {
      useCount: newUseCount,
      totalTokens: newTotalTokens,
      avgResponseTime: newAvgResponseTime,
      lastUsed: new Date().toISOString(),
    });
    
    return true;
  }

  _rowToModel(columns, row) {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    
    // Parse JSON fields
    if (obj.tags) obj.tags = JSON.parse(obj.tags);
    if (obj.collections) obj.collections = JSON.parse(obj.collections);
    obj.favorite = obj.favorite === 1;
    
    return obj;
  }

  // ============================================
  // TAGS OPERATIONS
  // ============================================

  /**
   * Get all tags
   */
  getAllTags() {
    const results = this.db.exec(`SELECT * FROM tags ORDER BY count DESC`);
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      id: row[0],
      name: row[1],
      color: row[2],
      count: row[3],
    }));
  }

  /**
   * Add tag to model
   */
  async addTagToModel(modelId, tagName) {
    const model = this.getModel(modelId);
    if (!model) return false;
    
    if (!model.tags.includes(tagName)) {
      model.tags.push(tagName);
      await this.updateModel(modelId, { tags: model.tags });
      
      // Update tag count
      this.db.run(`
        INSERT INTO tags (name, count) VALUES (?, 1)
        ON CONFLICT(name) DO UPDATE SET count = count + 1
      `, [tagName]);
      await this._saveDb();
    }
    
    return true;
  }

  /**
   * Remove tag from model
   */
  async removeTagFromModel(modelId, tagName) {
    const model = this.getModel(modelId);
    if (!model) return false;
    
    const index = model.tags.indexOf(tagName);
    if (index > -1) {
      model.tags.splice(index, 1);
      await this.updateModel(modelId, { tags: model.tags });
      
      // Update tag count
      this.db.run(`UPDATE tags SET count = MAX(0, count - 1) WHERE name = ?`, [tagName]);
      await this._saveDb();
    }
    
    return true;
  }

  // ============================================
  // COLLECTIONS OPERATIONS
  // ============================================

  /**
   * Create a collection
   */
  async createCollection(data) {
    const collection = new Collection(data);
    
    this.db.run(`
      INSERT INTO collections (id, name, description, icon, color, modelIds, isDefault, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      collection.id, collection.name, collection.description, collection.icon,
      collection.color, JSON.stringify(collection.modelIds), collection.isDefault ? 1 : 0,
      collection.createdAt, collection.updatedAt,
    ]);
    
    await this._saveDb();
    this.emit('collection:created', collection.toJSON());
    
    return collection.id;
  }

  /**
   * Update a collection
   */
  async updateCollection(id, updates) {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'createdAt' || key === 'isDefault') continue;
      
      let dbValue = value;
      if (key === 'modelIds') {
        dbValue = JSON.stringify(value);
      }
      
      fields.push(`${key} = ?`);
      values.push(dbValue);
    }
    
    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);
    
    this.db.run(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`, values);
    
    await this._saveDb();
    this.emit('collection:updated', { id, updates });
    
    return true;
  }

  /**
   * Delete a collection
   */
  async deleteCollection(id) {
    // Don't allow deleting default collections
    const collection = this.getCollection(id);
    if (collection?.isDefault) {
      throw new Error('Cannot delete default collections');
    }
    
    this.db.run(`DELETE FROM collections WHERE id = ?`, [id]);
    await this._saveDb();
    this.emit('collection:deleted', { id });
    
    return true;
  }

  /**
   * Get a collection
   */
  getCollection(id) {
    const results = this.db.exec(`SELECT * FROM collections WHERE id = ?`, [id]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return this._rowToCollection(results[0].columns, results[0].values[0]);
  }

  /**
   * Get all collections
   */
  getAllCollections() {
    const results = this.db.exec(`SELECT * FROM collections ORDER BY isDefault DESC, name ASC`);
    if (results.length === 0) return [];
    
    return results[0].values.map(row => this._rowToCollection(results[0].columns, row));
  }

  /**
   * Add model to collection
   */
  async addToCollection(collectionId, modelId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return false;
    
    if (!collection.modelIds.includes(modelId)) {
      collection.modelIds.push(modelId);
      await this.updateCollection(collectionId, { modelIds: collection.modelIds });
      
      // Also update model's collections
      const model = this.getModel(modelId);
      if (model && !model.collections.includes(collectionId)) {
        model.collections.push(collectionId);
        await this.updateModel(modelId, { collections: model.collections });
      }
    }
    
    return true;
  }

  /**
   * Remove model from collection
   */
  async removeFromCollection(collectionId, modelId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return false;
    
    const index = collection.modelIds.indexOf(modelId);
    if (index > -1) {
      collection.modelIds.splice(index, 1);
      await this.updateCollection(collectionId, { modelIds: collection.modelIds });
      
      // Also update model's collections
      const model = this.getModel(modelId);
      if (model) {
        const modelIndex = model.collections.indexOf(collectionId);
        if (modelIndex > -1) {
          model.collections.splice(modelIndex, 1);
          await this.updateModel(modelId, { collections: model.collections });
        }
      }
    }
    
    return true;
  }

  /**
   * Get models in collection
   */
  getCollectionModels(collectionId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return [];
    
    return collection.modelIds
      .map(id => this.getModel(id))
      .filter(m => m !== null);
  }

  _rowToCollection(columns, row) {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    
    if (obj.modelIds) obj.modelIds = JSON.parse(obj.modelIds);
    obj.isDefault = obj.isDefault === 1;
    
    return obj;
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  /**
   * Bulk update models
   */
  async bulkUpdate(modelIds, updates) {
    for (const id of modelIds) {
      await this.updateModel(id, updates);
    }
    return true;
  }

  /**
   * Bulk delete models
   */
  async bulkDelete(modelIds) {
    for (const id of modelIds) {
      await this.deleteModel(id);
    }
    return true;
  }

  /**
   * Bulk add to collection
   */
  async bulkAddToCollection(collectionId, modelIds) {
    for (const id of modelIds) {
      await this.addToCollection(collectionId, id);
    }
    return true;
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get library statistics
   */
  getStats() {
    const totalModels = this.db.exec(`SELECT COUNT(*) FROM models`)[0]?.values[0][0] || 0;
    const totalSize = this.db.exec(`SELECT SUM(size) FROM models`)[0]?.values[0][0] || 0;
    const favoriteCount = this.db.exec(`SELECT COUNT(*) FROM models WHERE favorite = 1`)[0]?.values[0][0] || 0;
    const avgRating = this.db.exec(`SELECT AVG(rating) FROM models WHERE rating > 0`)[0]?.values[0][0] || 0;
    
    const byType = {};
    const typeResults = this.db.exec(`SELECT modelType, COUNT(*) FROM models GROUP BY modelType`);
    if (typeResults.length > 0) {
      for (const row of typeResults[0].values) {
        byType[row[0] || 'unknown'] = row[1];
      }
    }
    
    const mostUsed = this.db.exec(`SELECT name, useCount FROM models ORDER BY useCount DESC LIMIT 5`);
    const topModels = mostUsed.length > 0 
      ? mostUsed[0].values.map(row => ({ name: row[0], useCount: row[1] }))
      : [];
    
    return {
      totalModels,
      totalSize,
      favoriteCount,
      avgRating: Math.round(avgRating * 10) / 10,
      byType,
      topModels,
      collectionCount: this.getAllCollections().length,
      tagCount: this.getAllTags().length,
    };
  }
}

// Singleton
let libraryInstance = null;

function getLibraryService() {
  if (!libraryInstance) {
    libraryInstance = new LibraryService();
  }
  return libraryInstance;
}

module.exports = {
  LibraryService,
  getLibraryService,
  LibraryModel,
  Collection,
};



