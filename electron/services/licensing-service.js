/**
 * LicensingService - License acceptance and age gate management
 * 
 * Features:
 * - HuggingFace gated model flow
 * - ToS acknowledgement tracking
 * - Age gate for Private Vault
 * - License flags and display
 * - Model card license parsing
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

// License types
const LicenseType = {
  OPEN: 'open',
  GATED: 'gated',
  COMMERCIAL: 'commercial',
  RESEARCH_ONLY: 'research-only',
  NSFW: 'nsfw',
  UNKNOWN: 'unknown',
};

// Common licenses
const KNOWN_LICENSES = {
  'mit': { name: 'MIT', type: LicenseType.OPEN, commercial: true },
  'apache-2.0': { name: 'Apache 2.0', type: LicenseType.OPEN, commercial: true },
  'gpl-3.0': { name: 'GPL 3.0', type: LicenseType.OPEN, commercial: true },
  'cc-by-4.0': { name: 'CC BY 4.0', type: LicenseType.OPEN, commercial: true },
  'cc-by-nc-4.0': { name: 'CC BY-NC 4.0', type: LicenseType.OPEN, commercial: false },
  'cc-by-sa-4.0': { name: 'CC BY-SA 4.0', type: LicenseType.OPEN, commercial: true },
  'cc0-1.0': { name: 'CC0 1.0', type: LicenseType.OPEN, commercial: true },
  'openrail': { name: 'OpenRAIL', type: LicenseType.OPEN, commercial: true },
  'openrail++': { name: 'OpenRAIL++', type: LicenseType.OPEN, commercial: true },
  'llama2': { name: 'Llama 2 Community', type: LicenseType.GATED, commercial: true },
  'llama3': { name: 'Llama 3 Community', type: LicenseType.GATED, commercial: true },
  'gemma': { name: 'Gemma Terms', type: LicenseType.GATED, commercial: true },
  'wtfpl': { name: 'WTFPL', type: LicenseType.OPEN, commercial: true },
  'other': { name: 'Other', type: LicenseType.UNKNOWN, commercial: null },
};

/**
 * LicensingService class
 */
class LicensingService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.store = null;
    this.isInitialized = false;
    this.ageVerified = false;
  }

  /**
   * Initialize the service
   */
  async initialize(dbInstance, storeInstance) {
    if (this.isInitialized) return;
    
    this.db = dbInstance;
    this.store = storeInstance;
    
    await this._ensureTables();
    await this._loadAgeVerification();
    
    this.isInitialized = true;
    console.log('[LicensingService] Initialized');
  }

  /**
   * Ensure database tables exist
   */
  async _ensureTables() {
    if (!this.db) throw new Error('Database not initialized');
    
    // License acceptances table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS license_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        modelId TEXT NOT NULL,
        provider TEXT NOT NULL,
        licenseId TEXT NOT NULL,
        licenseName TEXT,
        acceptedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(modelId, provider, licenseId)
      )
    `);
    
    // ToS acceptances table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tos_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        version TEXT NOT NULL,
        acceptedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, version)
      )
    `);
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_license_model ON license_acceptances(modelId)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tos_provider ON tos_acceptances(provider)`);
  }

  /**
   * Load age verification status
   */
  async _loadAgeVerification() {
    if (this.store) {
      const verified = this.store.get('ageVerified');
      const verifiedAt = this.store.get('ageVerifiedAt');
      
      // Require re-verification every 30 days
      if (verified && verifiedAt) {
        const daysSince = (Date.now() - new Date(verifiedAt).getTime()) / (1000 * 60 * 60 * 24);
        this.ageVerified = daysSince < 30;
      }
    }
  }

  /**
   * Parse license from model card
   */
  parseLicense(licenseString) {
    if (!licenseString) return { type: LicenseType.UNKNOWN, name: 'Unknown', commercial: null };
    
    const normalized = licenseString.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const known = KNOWN_LICENSES[normalized];
    
    if (known) return known;
    
    // Try partial matches
    for (const [key, value] of Object.entries(KNOWN_LICENSES)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
    
    // Detect NSFW
    if (normalized.includes('nsfw') || normalized.includes('adult')) {
      return { type: LicenseType.NSFW, name: licenseString, commercial: null };
    }
    
    // Detect research-only
    if (normalized.includes('research') || normalized.includes('non-commercial')) {
      return { type: LicenseType.RESEARCH_ONLY, name: licenseString, commercial: false };
    }
    
    return { type: LicenseType.UNKNOWN, name: licenseString, commercial: null };
  }

  /**
   * Check if license acceptance is required
   */
  async requiresAcceptance(modelId, provider, licenseId) {
    // Check if already accepted
    const results = this.db.exec(`
      SELECT id FROM license_acceptances 
      WHERE modelId = ? AND provider = ? AND licenseId = ?
    `, [modelId, provider, licenseId]);
    
    return results.length === 0 || results[0].values.length === 0;
  }

  /**
   * Accept a license
   */
  async acceptLicense(modelId, provider, licenseId, licenseName = null) {
    this.db.run(`
      INSERT OR REPLACE INTO license_acceptances (modelId, provider, licenseId, licenseName)
      VALUES (?, ?, ?, ?)
    `, [modelId, provider, licenseId, licenseName]);
    
    this.emit('license:accepted', { modelId, provider, licenseId, licenseName });
    
    return { success: true };
  }

  /**
   * Get license acceptance status for a model
   */
  getLicenseStatus(modelId, provider) {
    const results = this.db.exec(`
      SELECT * FROM license_acceptances 
      WHERE modelId = ? AND provider = ?
    `, [modelId, provider]);
    
    if (results.length === 0 || results[0].values.length === 0) {
      return { accepted: false, acceptances: [] };
    }
    
    return {
      accepted: true,
      acceptances: results[0].values.map(row => ({
        licenseId: row[3],
        licenseName: row[4],
        acceptedAt: row[5],
      })),
    };
  }

  /**
   * Check if ToS acceptance is required
   */
  async requiresToSAcceptance(provider, version) {
    const results = this.db.exec(`
      SELECT id FROM tos_acceptances 
      WHERE provider = ? AND version = ?
    `, [provider, version]);
    
    return results.length === 0 || results[0].values.length === 0;
  }

  /**
   * Accept ToS
   */
  async acceptToS(provider, version) {
    this.db.run(`
      INSERT OR REPLACE INTO tos_acceptances (provider, version)
      VALUES (?, ?)
    `, [provider, version]);
    
    this.emit('tos:accepted', { provider, version });
    
    return { success: true };
  }

  /**
   * Get ToS acceptance status
   */
  getToSStatus(provider) {
    const results = this.db.exec(`
      SELECT * FROM tos_acceptances 
      WHERE provider = ?
      ORDER BY acceptedAt DESC
    `, [provider]);
    
    if (results.length === 0 || results[0].values.length === 0) {
      return { accepted: false, versions: [] };
    }
    
    return {
      accepted: true,
      versions: results[0].values.map(row => ({
        version: row[2],
        acceptedAt: row[3],
      })),
    };
  }

  /**
   * Verify age (18+)
   */
  async verifyAge(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    const age = Math.floor((today - dob) / (365.25 * 24 * 60 * 60 * 1000));
    
    if (age >= 18) {
      this.ageVerified = true;
      
      if (this.store) {
        this.store.set('ageVerified', true);
        this.store.set('ageVerifiedAt', new Date().toISOString());
      }
      
      this.emit('age:verified', { verified: true });
      
      return { verified: true, age };
    }
    
    return { verified: false, age };
  }

  /**
   * Check age verification status
   */
  isAgeVerified() {
    return this.ageVerified;
  }

  /**
   * Clear age verification
   */
  clearAgeVerification() {
    this.ageVerified = false;
    
    if (this.store) {
      this.store.delete('ageVerified');
      this.store.delete('ageVerifiedAt');
    }
    
    this.emit('age:cleared');
  }

  /**
   * Get Private Vault access status
   */
  getPrivateVaultAccess() {
    return {
      ageVerified: this.ageVerified,
      requiresVerification: !this.ageVerified,
    };
  }

  /**
   * Set Private Vault password
   */
  async setVaultPassword(password) {
    if (!this.store) return { error: 'Store not initialized' };
    
    // Hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    
    this.store.set('vaultPasswordHash', `${salt}:${hash}`);
    
    this.emit('vault:passwordSet');
    
    return { success: true };
  }

  /**
   * Verify Private Vault password
   */
  verifyVaultPassword(password) {
    if (!this.store) return false;
    
    const stored = this.store.get('vaultPasswordHash');
    if (!stored) return true; // No password set
    
    const [salt, hash] = stored.split(':');
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    
    return hash === testHash;
  }

  /**
   * Check if vault has password
   */
  hasVaultPassword() {
    if (!this.store) return false;
    return !!this.store.get('vaultPasswordHash');
  }

  /**
   * Get license summary for UI display
   */
  getLicenseSummary(license) {
    const parsed = this.parseLicense(license);
    
    return {
      ...parsed,
      badge: this._getLicenseBadge(parsed),
      requiresAcceptance: parsed.type === LicenseType.GATED,
      isNSFW: parsed.type === LicenseType.NSFW,
    };
  }

  /**
   * Get license badge configuration
   */
  _getLicenseBadge(license) {
    switch (license.type) {
      case LicenseType.OPEN:
        return { color: 'emerald', icon: 'unlock', text: 'Open' };
      case LicenseType.GATED:
        return { color: 'amber', icon: 'lock', text: 'Gated' };
      case LicenseType.COMMERCIAL:
        return { color: 'blue', icon: 'briefcase', text: 'Commercial' };
      case LicenseType.RESEARCH_ONLY:
        return { color: 'purple', icon: 'beaker', text: 'Research Only' };
      case LicenseType.NSFW:
        return { color: 'red', icon: 'shield-alert', text: 'Adult Content' };
      default:
        return { color: 'gray', icon: 'help-circle', text: 'Unknown' };
    }
  }

  /**
   * Get all license acceptances
   */
  getAllAcceptances() {
    const results = this.db.exec(`
      SELECT * FROM license_acceptances ORDER BY acceptedAt DESC
    `);
    
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      id: row[0],
      modelId: row[1],
      provider: row[2],
      licenseId: row[3],
      licenseName: row[4],
      acceptedAt: row[5],
    }));
  }

  /**
   * Revoke a license acceptance
   */
  async revokeAcceptance(modelId, provider, licenseId) {
    this.db.run(`
      DELETE FROM license_acceptances 
      WHERE modelId = ? AND provider = ? AND licenseId = ?
    `, [modelId, provider, licenseId]);
    
    this.emit('license:revoked', { modelId, provider, licenseId });
    
    return { success: true };
  }
}

// Singleton
let licensingServiceInstance = null;

function getLicensingService() {
  if (!licensingServiceInstance) {
    licensingServiceInstance = new LicensingService();
  }
  return licensingServiceInstance;
}

module.exports = {
  LicensingService,
  getLicensingService,
  LicenseType,
  KNOWN_LICENSES,
};



