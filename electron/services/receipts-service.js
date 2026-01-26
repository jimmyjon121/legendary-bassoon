/**
 * ReceiptsService - Download provenance and verification
 * 
 * Features:
 * - Capture resolved URLs, redirects, ETags
 * - Store file sizes and checksums
 * - Write to receipts database
 * - Append to unified ledger
 * - Optional signature verification
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

/**
 * ReceiptsService class
 */
class ReceiptsService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize(dbInstance) {
    if (this.isInitialized) return;
    
    this.db = dbInstance;
    await this._ensureTables();
    
    this.isInitialized = true;
    console.log('[ReceiptsService] Initialized');
  }

  /**
   * Ensure database tables exist
   */
  async _ensureTables() {
    if (!this.db) throw new Error('Database not initialized');
    
    // Receipts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS download_receipts (
        id TEXT PRIMARY KEY,
        downloadId TEXT NOT NULL,
        modelId TEXT,
        provider TEXT,
        originalUrl TEXT NOT NULL,
        finalUrl TEXT,
        redirects TEXT,
        responseHeaders TEXT,
        contentLength INTEGER,
        contentType TEXT,
        etag TEXT,
        lastModified TEXT,
        checksumSha256 TEXT,
        checksumMd5 TEXT,
        fileSize INTEGER,
        filePath TEXT,
        startedAt DATETIME,
        completedAt DATETIME,
        durationMs INTEGER,
        verified INTEGER DEFAULT 0,
        verifiedAt DATETIME,
        signature TEXT,
        signatureVerified INTEGER,
        metadata TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_download ON download_receipts(downloadId)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_model ON download_receipts(modelId)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_checksum ON download_receipts(checksumSha256)`);
  }

  /**
   * Create a new receipt for a download
   */
  async createReceipt(downloadId, originalUrl, options = {}) {
    const receiptId = `rcpt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    const receipt = {
      id: receiptId,
      downloadId,
      modelId: options.modelId || null,
      provider: options.provider || null,
      originalUrl,
      finalUrl: null,
      redirects: [],
      responseHeaders: {},
      contentLength: null,
      contentType: null,
      etag: null,
      lastModified: null,
      checksumSha256: null,
      checksumMd5: null,
      fileSize: null,
      filePath: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      verified: false,
      verifiedAt: null,
      signature: null,
      signatureVerified: null,
      metadata: options.metadata || {},
      createdAt: new Date().toISOString(),
    };
    
    // Save initial receipt
    await this._saveReceipt(receipt);
    
    this.emit('receipt:created', { id: receiptId, downloadId });
    
    return receipt;
  }

  /**
   * Update receipt with response info
   */
  async updateWithResponse(receiptId, responseInfo) {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) throw new Error('Receipt not found');
    
    receipt.finalUrl = responseInfo.finalUrl || receipt.originalUrl;
    receipt.redirects = responseInfo.redirects || [];
    receipt.responseHeaders = responseInfo.headers || {};
    receipt.contentLength = responseInfo.contentLength;
    receipt.contentType = responseInfo.contentType;
    receipt.etag = responseInfo.etag;
    receipt.lastModified = responseInfo.lastModified;
    
    await this._saveReceipt(receipt);
    
    this.emit('receipt:updated', { id: receiptId, field: 'response' });
    
    return receipt;
  }

  /**
   * Complete receipt with file info
   */
  async completeReceipt(receiptId, fileInfo) {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) throw new Error('Receipt not found');
    
    receipt.checksumSha256 = fileInfo.checksumSha256;
    receipt.checksumMd5 = fileInfo.checksumMd5;
    receipt.fileSize = fileInfo.fileSize;
    receipt.filePath = fileInfo.filePath;
    receipt.completedAt = new Date().toISOString();
    receipt.durationMs = new Date(receipt.completedAt) - new Date(receipt.startedAt);
    
    // Verify checksum if expected value provided
    if (fileInfo.expectedChecksum && receipt.checksumSha256) {
      receipt.verified = receipt.checksumSha256.toLowerCase() === fileInfo.expectedChecksum.toLowerCase();
      receipt.verifiedAt = new Date().toISOString();
    }
    
    await this._saveReceipt(receipt);
    
    // Append to unified ledger if available
    await this._appendToLedger(receipt);
    
    this.emit('receipt:completed', { id: receiptId, verified: receipt.verified });
    
    return receipt;
  }

  /**
   * Calculate file checksums
   */
  async calculateChecksums(filePath) {
    return new Promise((resolve, reject) => {
      const sha256 = crypto.createHash('sha256');
      const md5 = crypto.createHash('md5');
      
      const stream = fs.createReadStream(filePath);
      let size = 0;
      
      stream.on('data', (chunk) => {
        sha256.update(chunk);
        md5.update(chunk);
        size += chunk.length;
      });
      
      stream.on('end', () => {
        resolve({
          checksumSha256: sha256.digest('hex'),
          checksumMd5: md5.digest('hex'),
          fileSize: size,
        });
      });
      
      stream.on('error', reject);
    });
  }

  /**
   * Verify a downloaded file against its receipt
   */
  async verifyFile(receiptId, filePath = null) {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) throw new Error('Receipt not found');
    
    const checkPath = filePath || receipt.filePath;
    if (!checkPath || !fs.existsSync(checkPath)) {
      return { verified: false, error: 'File not found' };
    }
    
    const checksums = await this.calculateChecksums(checkPath);
    
    const verified = receipt.checksumSha256 
      ? checksums.checksumSha256.toLowerCase() === receipt.checksumSha256.toLowerCase()
      : false;
    
    // Update receipt
    receipt.verified = verified;
    receipt.verifiedAt = new Date().toISOString();
    await this._saveReceipt(receipt);
    
    this.emit('receipt:verified', { id: receiptId, verified });
    
    return {
      verified,
      expected: {
        sha256: receipt.checksumSha256,
        size: receipt.fileSize,
      },
      actual: checksums,
    };
  }

  /**
   * Add signature to receipt
   */
  async addSignature(receiptId, signature, publicKey = null) {
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) throw new Error('Receipt not found');
    
    receipt.signature = signature;
    
    // Verify signature if public key provided
    if (publicKey) {
      try {
        const verify = crypto.createVerify('SHA256');
        verify.update(this._getReceiptSignatureData(receipt));
        receipt.signatureVerified = verify.verify(publicKey, signature, 'base64');
      } catch (e) {
        receipt.signatureVerified = false;
      }
    }
    
    await this._saveReceipt(receipt);
    
    this.emit('receipt:signed', { id: receiptId, verified: receipt.signatureVerified });
    
    return receipt;
  }

  /**
   * Get receipt by ID
   */
  async getReceipt(receiptId) {
    const results = this.db.exec(`SELECT * FROM download_receipts WHERE id = ?`, [receiptId]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return this._rowToReceipt(results[0].values[0], results[0].columns);
  }

  /**
   * Get receipt by download ID
   */
  async getReceiptByDownload(downloadId) {
    const results = this.db.exec(`SELECT * FROM download_receipts WHERE downloadId = ?`, [downloadId]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return this._rowToReceipt(results[0].values[0], results[0].columns);
  }

  /**
   * Get receipts for a model
   */
  async getReceiptsForModel(modelId) {
    const results = this.db.exec(`
      SELECT * FROM download_receipts WHERE modelId = ? ORDER BY createdAt DESC
    `, [modelId]);
    
    if (results.length === 0) return [];
    return results[0].values.map(row => this._rowToReceipt(row, results[0].columns));
  }

  /**
   * Search receipts by checksum
   */
  async findByChecksum(checksum) {
    const results = this.db.exec(`
      SELECT * FROM download_receipts 
      WHERE checksumSha256 = ? OR checksumMd5 = ?
      ORDER BY createdAt DESC
    `, [checksum.toLowerCase(), checksum.toLowerCase()]);
    
    if (results.length === 0) return [];
    return results[0].values.map(row => this._rowToReceipt(row, results[0].columns));
  }

  /**
   * Get all receipts
   */
  async getAllReceipts(options = {}) {
    const { limit = 100, offset = 0, verified } = options;
    
    let query = 'SELECT * FROM download_receipts WHERE 1=1';
    const params = [];
    
    if (verified !== undefined) {
      query += ' AND verified = ?';
      params.push(verified ? 1 : 0);
    }
    
    query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const results = this.db.exec(query, params);
    if (results.length === 0) return [];
    return results[0].values.map(row => this._rowToReceipt(row, results[0].columns));
  }

  /**
   * Get receipt statistics
   */
  async getStats() {
    const totalResult = this.db.exec('SELECT COUNT(*) FROM download_receipts');
    const verifiedResult = this.db.exec('SELECT COUNT(*) FROM download_receipts WHERE verified = 1');
    const signedResult = this.db.exec('SELECT COUNT(*) FROM download_receipts WHERE signature IS NOT NULL');
    
    return {
      total: totalResult[0]?.values[0]?.[0] || 0,
      verified: verifiedResult[0]?.values[0]?.[0] || 0,
      signed: signedResult[0]?.values[0]?.[0] || 0,
    };
  }

  /**
   * Delete old receipts
   */
  async cleanupOldReceipts(daysOld = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    
    this.db.run(`
      DELETE FROM download_receipts WHERE createdAt < ?
    `, [cutoff.toISOString()]);
    
    return { success: true };
  }

  /**
   * Export receipts for audit
   */
  async exportReceipts(options = {}) {
    const receipts = await this.getAllReceipts({ limit: 10000 });
    
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      receipts: receipts.map(r => ({
        ...r,
        // Redact file paths for export
        filePath: r.filePath ? '[REDACTED]' : null,
      })),
    };
  }

  /**
   * Save receipt to database
   */
  async _saveReceipt(receipt) {
    this.db.run(`
      INSERT OR REPLACE INTO download_receipts (
        id, downloadId, modelId, provider, originalUrl, finalUrl, redirects,
        responseHeaders, contentLength, contentType, etag, lastModified,
        checksumSha256, checksumMd5, fileSize, filePath, startedAt, completedAt,
        durationMs, verified, verifiedAt, signature, signatureVerified, metadata, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      receipt.id,
      receipt.downloadId,
      receipt.modelId,
      receipt.provider,
      receipt.originalUrl,
      receipt.finalUrl,
      JSON.stringify(receipt.redirects || []),
      JSON.stringify(receipt.responseHeaders || {}),
      receipt.contentLength,
      receipt.contentType,
      receipt.etag,
      receipt.lastModified,
      receipt.checksumSha256,
      receipt.checksumMd5,
      receipt.fileSize,
      receipt.filePath,
      receipt.startedAt,
      receipt.completedAt,
      receipt.durationMs,
      receipt.verified ? 1 : 0,
      receipt.verifiedAt,
      receipt.signature,
      receipt.signatureVerified === null ? null : (receipt.signatureVerified ? 1 : 0),
      JSON.stringify(receipt.metadata || {}),
      receipt.createdAt,
    ]);
  }

  /**
   * Append to unified ledger
   */
  async _appendToLedger(receipt) {
    try {
      // Try to use ledger service if available
      const ledgerService = require('./ledger-service');
      if (ledgerService && ledgerService.recordEvent) {
        await ledgerService.recordEvent({
          type: 'download_receipt',
          data: {
            receiptId: receipt.id,
            downloadId: receipt.downloadId,
            modelId: receipt.modelId,
            provider: receipt.provider,
            checksumSha256: receipt.checksumSha256,
            verified: receipt.verified,
            fileSize: receipt.fileSize,
          },
        });
      }
    } catch (e) {
      // Ledger service not available, skip
      console.log('[ReceiptsService] Ledger service not available:', e.message);
    }
  }

  /**
   * Get data for signature verification
   */
  _getReceiptSignatureData(receipt) {
    return JSON.stringify({
      id: receipt.id,
      downloadId: receipt.downloadId,
      originalUrl: receipt.originalUrl,
      checksumSha256: receipt.checksumSha256,
      fileSize: receipt.fileSize,
      completedAt: receipt.completedAt,
    });
  }

  /**
   * Convert database row to receipt object
   */
  _rowToReceipt(row, columns) {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    
    return {
      id: obj.id,
      downloadId: obj.downloadId,
      modelId: obj.modelId,
      provider: obj.provider,
      originalUrl: obj.originalUrl,
      finalUrl: obj.finalUrl,
      redirects: JSON.parse(obj.redirects || '[]'),
      responseHeaders: JSON.parse(obj.responseHeaders || '{}'),
      contentLength: obj.contentLength,
      contentType: obj.contentType,
      etag: obj.etag,
      lastModified: obj.lastModified,
      checksumSha256: obj.checksumSha256,
      checksumMd5: obj.checksumMd5,
      fileSize: obj.fileSize,
      filePath: obj.filePath,
      startedAt: obj.startedAt,
      completedAt: obj.completedAt,
      durationMs: obj.durationMs,
      verified: obj.verified === 1,
      verifiedAt: obj.verifiedAt,
      signature: obj.signature,
      signatureVerified: obj.signatureVerified === null ? null : obj.signatureVerified === 1,
      metadata: JSON.parse(obj.metadata || '{}'),
      createdAt: obj.createdAt,
    };
  }
}

// Singleton
let receiptsServiceInstance = null;

function getReceiptsService() {
  if (!receiptsServiceInstance) {
    receiptsServiceInstance = new ReceiptsService();
  }
  return receiptsServiceInstance;
}

module.exports = {
  ReceiptsService,
  getReceiptsService,
};



