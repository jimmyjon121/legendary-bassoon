/**
 * CollectionsService - Curated model collections and starter packs
 * 
 * Features:
 * - Curated official collections (starter packs)
 * - User-created collections with sharing
 * - Collection manifests for export/import
 * - Bulk download/install of collections
 * - Collection versioning and updates
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

// Collection types
const CollectionType = {
  CURATED: 'curated',     // Official starter packs
  USER: 'user',           // User-created collections
  SHARED: 'shared',       // Imported from others
  SYSTEM: 'system',       // System-generated (e.g., recently used)
};

// Collection categories
const CollectionCategory = {
  STARTER_PACK: 'starter-pack',
  TEXT_GENERATION: 'text-generation',
  CODE_ASSISTANT: 'code-assistant',
  IMAGE_GENERATION: 'image-generation',
  AUDIO: 'audio',
  VIDEO: 'video',
  MULTIMODAL: 'multimodal',
  EMBEDDINGS: 'embeddings',
  ROLEPLAY: 'roleplay',
  PRODUCTIVITY: 'productivity',
  CUSTOM: 'custom',
};

// Official starter packs
const STARTER_PACKS = [
  {
    id: 'starter-essentials',
    name: 'Essential Starter Pack',
    description: 'Perfect for beginners - a curated selection of versatile models to get started with AI.',
    category: CollectionCategory.STARTER_PACK,
    type: CollectionType.CURATED,
    icon: '🚀',
    models: [
      { provider: 'ollama', modelId: 'llama3.2:3b', role: 'General chat and assistance' },
      { provider: 'ollama', modelId: 'mistral:7b', role: 'Fast and capable language model' },
      { provider: 'ollama', modelId: 'nomic-embed-text', role: 'Text embeddings for RAG' },
    ],
    estimatedSize: '5GB',
    difficulty: 'beginner',
    tags: ['starter', 'essential', 'beginner-friendly'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
  {
    id: 'code-assistant-pack',
    name: 'Code Assistant Pack',
    description: 'Models optimized for coding, debugging, and software development tasks.',
    category: CollectionCategory.CODE_ASSISTANT,
    type: CollectionType.CURATED,
    icon: '💻',
    models: [
      { provider: 'ollama', modelId: 'codellama:13b', role: 'Code generation and completion' },
      { provider: 'ollama', modelId: 'deepseek-coder:6.7b', role: 'Fast code assistant' },
      { provider: 'ollama', modelId: 'starcoder2:7b', role: 'Multi-language code model' },
    ],
    estimatedSize: '25GB',
    difficulty: 'intermediate',
    tags: ['coding', 'development', 'programming'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
  {
    id: 'creative-writing-pack',
    name: 'Creative Writing Pack',
    description: 'Models tuned for creative writing, storytelling, and content generation.',
    category: CollectionCategory.TEXT_GENERATION,
    type: CollectionType.CURATED,
    icon: '✍️',
    models: [
      { provider: 'ollama', modelId: 'llama3.2:8b', role: 'Creative text generation' },
      { provider: 'ollama', modelId: 'neural-chat:7b', role: 'Conversational writing' },
      { provider: 'ollama', modelId: 'openchat:7b', role: 'General purpose chat' },
    ],
    estimatedSize: '20GB',
    difficulty: 'intermediate',
    tags: ['writing', 'creative', 'storytelling'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
  {
    id: 'image-gen-pack',
    name: 'Image Generation Pack',
    description: 'Essential models for AI image generation with Stable Diffusion.',
    category: CollectionCategory.IMAGE_GENERATION,
    type: CollectionType.CURATED,
    icon: '🎨',
    models: [
      { provider: 'civitai', modelId: 'sd-xl-base', role: 'Base SDXL model' },
      { provider: 'huggingface', modelId: 'stabilityai/stable-diffusion-xl-base-1.0', role: 'Stable Diffusion XL' },
    ],
    estimatedSize: '12GB',
    difficulty: 'intermediate',
    tags: ['image', 'art', 'stable-diffusion'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
  {
    id: 'productivity-pack',
    name: 'Productivity Pack',
    description: 'Lightweight models for quick tasks, summaries, and day-to-day AI assistance.',
    category: CollectionCategory.PRODUCTIVITY,
    type: CollectionType.CURATED,
    icon: '📋',
    models: [
      { provider: 'ollama', modelId: 'phi3:mini', role: 'Fast lightweight assistant' },
      { provider: 'ollama', modelId: 'gemma:2b', role: 'Quick responses' },
      { provider: 'ollama', modelId: 'tinyllama', role: 'Ultra-fast for simple tasks' },
    ],
    estimatedSize: '4GB',
    difficulty: 'beginner',
    tags: ['productivity', 'fast', 'lightweight'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
  {
    id: 'multimodal-pack',
    name: 'Multimodal Pack',
    description: 'Models that can understand both text and images.',
    category: CollectionCategory.MULTIMODAL,
    type: CollectionType.CURATED,
    icon: '👁️',
    models: [
      { provider: 'ollama', modelId: 'llava:13b', role: 'Vision + language understanding' },
      { provider: 'ollama', modelId: 'bakllava', role: 'Advanced vision model' },
    ],
    estimatedSize: '15GB',
    difficulty: 'advanced',
    tags: ['multimodal', 'vision', 'images'],
    version: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-12-01T00:00:00Z',
  },
];

/**
 * CollectionsService class
 */
class CollectionsService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.collectionsDir = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize(dbInstance, userDataPath) {
    if (this.isInitialized) return;
    
    this.db = dbInstance;
    this.collectionsDir = path.join(userDataPath, 'collections');
    
    await this._ensureTables();
    await this._seedStarterPacks();
    
    this.isInitialized = true;
    console.log('[CollectionsService] Initialized');
  }

  /**
   * Ensure database tables exist
   */
  async _ensureTables() {
    if (!this.db) throw new Error('Database not initialized');
    
    // Collections table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        category TEXT,
        icon TEXT,
        estimatedSize TEXT,
        difficulty TEXT,
        version TEXT DEFAULT '1.0.0',
        isPublic INTEGER DEFAULT 0,
        shareCode TEXT UNIQUE,
        author TEXT,
        tags TEXT,
        metadata TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Collection models table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collection_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collectionId TEXT NOT NULL,
        provider TEXT NOT NULL,
        modelId TEXT NOT NULL,
        role TEXT,
        required INTEGER DEFAULT 1,
        orderIndex INTEGER DEFAULT 0,
        FOREIGN KEY (collectionId) REFERENCES model_collections(id) ON DELETE CASCADE,
        UNIQUE(collectionId, provider, modelId)
      )
    `);
    
    // Collection install tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collection_installs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collectionId TEXT NOT NULL,
        installedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'partial',
        modelsInstalled INTEGER DEFAULT 0,
        modelsTotal INTEGER DEFAULT 0,
        FOREIGN KEY (collectionId) REFERENCES model_collections(id) ON DELETE CASCADE
      )
    `);
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_collections_type ON model_collections(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_collections_category ON model_collections(category)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_collection_models_collection ON collection_models(collectionId)`);
  }

  /**
   * Seed starter packs
   */
  async _seedStarterPacks() {
    for (const pack of STARTER_PACKS) {
      // Check if already exists
      const existing = this.db.exec(`SELECT id FROM model_collections WHERE id = ?`, [pack.id]);
      if (existing.length > 0 && existing[0].values.length > 0) continue;
      
      // Insert collection
      this.db.run(`
        INSERT INTO model_collections (id, name, description, type, category, icon, estimatedSize, difficulty, version, tags, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        pack.id,
        pack.name,
        pack.description,
        pack.type,
        pack.category,
        pack.icon,
        pack.estimatedSize,
        pack.difficulty,
        pack.version,
        JSON.stringify(pack.tags),
        pack.createdAt,
        pack.updatedAt,
      ]);
      
      // Insert models
      for (let i = 0; i < pack.models.length; i++) {
        const model = pack.models[i];
        this.db.run(`
          INSERT INTO collection_models (collectionId, provider, modelId, role, orderIndex)
          VALUES (?, ?, ?, ?, ?)
        `, [pack.id, model.provider, model.modelId, model.role, i]);
      }
    }
  }

  /**
   * Get all collections
   */
  getAllCollections(options = {}) {
    const { type, category, includeModels = false } = options;
    
    let query = 'SELECT * FROM model_collections WHERE 1=1';
    const params = [];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY type, name';
    
    const results = this.db.exec(query, params);
    if (results.length === 0) return [];
    
    const collections = results[0].values.map(row => this._rowToCollection(row, results[0].columns));
    
    if (includeModels) {
      for (const collection of collections) {
        collection.models = this.getCollectionModels(collection.id);
      }
    }
    
    return collections;
  }

  /**
   * Get starter packs (curated collections)
   */
  getStarterPacks() {
    return this.getAllCollections({ type: CollectionType.CURATED, includeModels: true });
  }

  /**
   * Get user collections
   */
  getUserCollections() {
    return this.getAllCollections({ type: CollectionType.USER, includeModels: true });
  }

  /**
   * Get collection by ID
   */
  getCollection(collectionId) {
    const results = this.db.exec(`SELECT * FROM model_collections WHERE id = ?`, [collectionId]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    
    const collection = this._rowToCollection(results[0].values[0], results[0].columns);
    collection.models = this.getCollectionModels(collectionId);
    
    return collection;
  }

  /**
   * Get models in a collection
   */
  getCollectionModels(collectionId) {
    const results = this.db.exec(`
      SELECT * FROM collection_models 
      WHERE collectionId = ? 
      ORDER BY orderIndex
    `, [collectionId]);
    
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      provider: row[2],
      modelId: row[3],
      role: row[4],
      required: row[5] === 1,
      orderIndex: row[6],
    }));
  }

  /**
   * Create a new collection
   */
  createCollection(data) {
    const id = `col-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    
    this.db.run(`
      INSERT INTO model_collections (id, name, description, type, category, icon, tags, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      data.name,
      data.description || '',
      data.type || CollectionType.USER,
      data.category || CollectionCategory.CUSTOM,
      data.icon || '📦',
      JSON.stringify(data.tags || []),
      now,
      now,
    ]);
    
    const collection = this.getCollection(id);
    this.emit('collection:created', collection);
    
    return collection;
  }

  /**
   * Update a collection
   */
  updateCollection(collectionId, updates) {
    const collection = this.getCollection(collectionId);
    if (!collection) return null;
    
    // Don't allow modifying curated collections
    if (collection.type === CollectionType.CURATED) {
      throw new Error('Cannot modify curated collections');
    }
    
    const now = new Date().toISOString();
    const allowedFields = ['name', 'description', 'category', 'icon', 'tags', 'isPublic'];
    const setClauses = [];
    const params = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        params.push(field === 'tags' ? JSON.stringify(updates[field]) : updates[field]);
      }
    }
    
    if (setClauses.length === 0) return collection;
    
    setClauses.push('updatedAt = ?');
    params.push(now);
    params.push(collectionId);
    
    this.db.run(`
      UPDATE model_collections SET ${setClauses.join(', ')} WHERE id = ?
    `, params);
    
    const updated = this.getCollection(collectionId);
    this.emit('collection:updated', { id: collectionId, updates: updated });
    
    return updated;
  }

  /**
   * Delete a collection
   */
  deleteCollection(collectionId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return false;
    
    // Don't allow deleting curated collections
    if (collection.type === CollectionType.CURATED) {
      throw new Error('Cannot delete curated collections');
    }
    
    this.db.run(`DELETE FROM collection_models WHERE collectionId = ?`, [collectionId]);
    this.db.run(`DELETE FROM collection_installs WHERE collectionId = ?`, [collectionId]);
    this.db.run(`DELETE FROM model_collections WHERE id = ?`, [collectionId]);
    
    this.emit('collection:deleted', { id: collectionId });
    
    return true;
  }

  /**
   * Add model to collection
   */
  addModelToCollection(collectionId, modelData) {
    const collection = this.getCollection(collectionId);
    if (!collection || collection.type === CollectionType.CURATED) {
      throw new Error('Cannot modify this collection');
    }
    
    // Get max order index
    const maxResult = this.db.exec(`
      SELECT MAX(orderIndex) FROM collection_models WHERE collectionId = ?
    `, [collectionId]);
    const maxOrder = maxResult[0]?.values[0]?.[0] || 0;
    
    this.db.run(`
      INSERT OR REPLACE INTO collection_models (collectionId, provider, modelId, role, required, orderIndex)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      collectionId,
      modelData.provider,
      modelData.modelId,
      modelData.role || '',
      modelData.required !== false ? 1 : 0,
      modelData.orderIndex ?? maxOrder + 1,
    ]);
    
    const models = this.getCollectionModels(collectionId);
    this.emit('collection:modelAdded', { collectionId, model: modelData });
    
    return models;
  }

  /**
   * Remove model from collection
   */
  removeModelFromCollection(collectionId, provider, modelId) {
    const collection = this.getCollection(collectionId);
    if (!collection || collection.type === CollectionType.CURATED) {
      throw new Error('Cannot modify this collection');
    }
    
    this.db.run(`
      DELETE FROM collection_models 
      WHERE collectionId = ? AND provider = ? AND modelId = ?
    `, [collectionId, provider, modelId]);
    
    this.emit('collection:modelRemoved', { collectionId, provider, modelId });
    
    return this.getCollectionModels(collectionId);
  }

  /**
   * Export collection as manifest
   */
  async exportManifest(collectionId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return null;
    
    const manifest = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      collection: {
        name: collection.name,
        description: collection.description,
        category: collection.category,
        icon: collection.icon,
        tags: collection.tags,
        version: collection.version,
      },
      models: collection.models.map(m => ({
        provider: m.provider,
        modelId: m.modelId,
        role: m.role,
        required: m.required,
      })),
    };
    
    // Generate share code
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex')
      .substring(0, 8);
    manifest.shareCode = hash;
    
    return manifest;
  }

  /**
   * Import collection from manifest
   */
  async importManifest(manifest) {
    if (!manifest || !manifest.collection || !manifest.models) {
      throw new Error('Invalid manifest format');
    }
    
    // Create new collection
    const collection = this.createCollection({
      name: `${manifest.collection.name} (Imported)`,
      description: manifest.collection.description,
      type: CollectionType.SHARED,
      category: manifest.collection.category,
      icon: manifest.collection.icon,
      tags: manifest.collection.tags,
    });
    
    // Add models
    for (let i = 0; i < manifest.models.length; i++) {
      const model = manifest.models[i];
      this.addModelToCollection(collection.id, {
        ...model,
        orderIndex: i,
      });
    }
    
    const imported = this.getCollection(collection.id);
    this.emit('collection:imported', imported);
    
    return imported;
  }

  /**
   * Generate shareable link/code for a collection
   */
  async generateShareCode(collectionId) {
    const collection = this.getCollection(collectionId);
    if (!collection) return null;
    
    // Generate unique share code
    const shareCode = crypto.randomBytes(6).toString('base64url');
    
    this.db.run(`
      UPDATE model_collections SET shareCode = ?, isPublic = 1, updatedAt = ? WHERE id = ?
    `, [shareCode, new Date().toISOString(), collectionId]);
    
    return shareCode;
  }

  /**
   * Get collection by share code
   */
  getCollectionByShareCode(shareCode) {
    const results = this.db.exec(`
      SELECT * FROM model_collections WHERE shareCode = ? AND isPublic = 1
    `, [shareCode]);
    
    if (results.length === 0 || results[0].values.length === 0) return null;
    
    const collection = this._rowToCollection(results[0].values[0], results[0].columns);
    collection.models = this.getCollectionModels(collection.id);
    
    return collection;
  }

  /**
   * Track collection installation progress
   */
  trackInstallation(collectionId, modelsInstalled, modelsTotal) {
    const status = modelsInstalled >= modelsTotal ? 'complete' : 'partial';
    
    // Check if tracking exists
    const existing = this.db.exec(`
      SELECT id FROM collection_installs WHERE collectionId = ?
    `, [collectionId]);
    
    if (existing.length > 0 && existing[0].values.length > 0) {
      this.db.run(`
        UPDATE collection_installs 
        SET modelsInstalled = ?, modelsTotal = ?, status = ?, installedAt = ?
        WHERE collectionId = ?
      `, [modelsInstalled, modelsTotal, status, new Date().toISOString(), collectionId]);
    } else {
      this.db.run(`
        INSERT INTO collection_installs (collectionId, modelsInstalled, modelsTotal, status)
        VALUES (?, ?, ?, ?)
      `, [collectionId, modelsInstalled, modelsTotal, status]);
    }
    
    this.emit('collection:installProgress', { collectionId, modelsInstalled, modelsTotal, status });
  }

  /**
   * Get installation status for a collection
   */
  getInstallationStatus(collectionId) {
    const results = this.db.exec(`
      SELECT * FROM collection_installs WHERE collectionId = ?
    `, [collectionId]);
    
    if (results.length === 0 || results[0].values.length === 0) {
      return { status: 'not_installed', modelsInstalled: 0, modelsTotal: 0 };
    }
    
    const row = results[0].values[0];
    return {
      status: row[4],
      modelsInstalled: row[5],
      modelsTotal: row[6],
      installedAt: row[2],
    };
  }

  /**
   * Get categories
   */
  getCategories() {
    return Object.values(CollectionCategory);
  }

  /**
   * Convert database row to collection object
   */
  _rowToCollection(row, columns) {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    
    return {
      id: obj.id,
      name: obj.name,
      description: obj.description,
      type: obj.type,
      category: obj.category,
      icon: obj.icon,
      estimatedSize: obj.estimatedSize,
      difficulty: obj.difficulty,
      version: obj.version,
      isPublic: obj.isPublic === 1,
      shareCode: obj.shareCode,
      author: obj.author,
      tags: JSON.parse(obj.tags || '[]'),
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }
}

// Singleton
let collectionsServiceInstance = null;

function getCollectionsService() {
  if (!collectionsServiceInstance) {
    collectionsServiceInstance = new CollectionsService();
  }
  return collectionsServiceInstance;
}

module.exports = {
  CollectionsService,
  getCollectionsService,
  CollectionType,
  CollectionCategory,
  STARTER_PACKS,
};



