/**
 * DownloadManagerV2 - Persistent, Resumable, Verified Download Manager
 * 
 * Features:
 * - Persistent job queue (survives app restart)
 * - Resumable downloads with HTTP Range headers
 * - SHA256/MD5 checksum verification
 * - Exponential backoff retry
 * - Priority-based queue
 * - Scheduling (start at specific time)
 * - Bandwidth throttling (future)
 * - Progress events via EventEmitter
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const initSqlJs = require('sql.js');

// Job statuses
const JobStatus = {
  QUEUED: 'queued',
  SCHEDULED: 'scheduled',
  PREFLIGHT: 'preflight',
  DOWNLOADING: 'downloading',
  VERIFYING: 'verifying',
  INSTALLING: 'installing',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

// Retry config
const RETRY_DELAYS = [1000, 5000, 15000, 60000, 300000]; // 1s, 5s, 15s, 1m, 5m
const MAX_RETRIES = 5;
const MAX_CONCURRENT = 3;
const PROGRESS_THROTTLE_MS = 200;

class DownloadManagerV2 extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.dbPath = null;
    this.isInitialized = false;
    this.activeJobs = new Map(); // id -> { request, fileStream, abortController }
    this.queue = []; // In-memory priority queue
    this.processingQueue = false;
  }

  /**
   * Initialize the download manager with persistent storage
   */
  async initialize(userDataPath) {
    if (this.isInitialized) return;
    
    try {
      this.dbPath = path.join(userDataPath, 'downloads-v2.db');
      const dbDir = path.dirname(this.dbPath);
      await fsPromises.mkdir(dbDir, { recursive: true });
      
      // Initialize SQL.js
      const SQL = await initSqlJs();
      
      // Load or create database
      let dbBuffer = null;
      try {
        if (fs.existsSync(this.dbPath)) {
          dbBuffer = await fsPromises.readFile(this.dbPath);
        }
      } catch (err) {
        console.warn('[DownloadManagerV2] Could not load existing DB:', err.message);
      }
      
      this.db = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();
      
      // Create schema
      this.db.run(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          destinationDir TEXT NOT NULL,
          filename TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          priority INTEGER DEFAULT 0,
          scheduledAt TEXT,
          
          -- Progress tracking
          totalBytes INTEGER DEFAULT 0,
          downloadedBytes INTEGER DEFAULT 0,
          progress REAL DEFAULT 0,
          speed REAL DEFAULT 0,
          
          -- Verification
          expectedHash TEXT,
          hashAlgorithm TEXT DEFAULT 'sha256',
          actualHash TEXT,
          
          -- Retry handling
          retryCount INTEGER DEFAULT 0,
          lastError TEXT,
          nextRetryAt TEXT,
          
          -- Metadata
          provider TEXT,
          modelType TEXT,
          metadata TEXT,
          
          -- Timestamps
          createdAt TEXT NOT NULL,
          startedAt TEXT,
          completedAt TEXT,
          updatedAt TEXT NOT NULL
        )
      `);
      
      // Create indexes
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduledAt)`);
      
      await this._saveDb();
      
      // Load pending jobs into memory queue
      await this._loadPendingJobs();
      
      this.isInitialized = true;
      console.log('[DownloadManagerV2] Initialized with', this.queue.length, 'pending jobs');
      
      // Start processing queue
      this._processQueue();
      
    } catch (error) {
      console.error('[DownloadManagerV2] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Save database to disk
   */
  async _saveDb() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fsPromises.writeFile(this.dbPath, buffer);
    } catch (error) {
      console.error('[DownloadManagerV2] Failed to save DB:', error);
    }
  }

  /**
   * Load pending jobs from DB into memory queue
   */
  async _loadPendingJobs() {
    const resumableStatuses = [
      JobStatus.QUEUED,
      JobStatus.SCHEDULED,
      JobStatus.DOWNLOADING,
      JobStatus.ERROR,
    ];
    
    const results = this.db.exec(`
      SELECT * FROM jobs 
      WHERE status IN (${resumableStatuses.map(s => `'${s}'`).join(',')})
      ORDER BY priority DESC, createdAt ASC
    `);
    
    if (results.length > 0) {
      const columns = results[0].columns;
      this.queue = results[0].values.map(row => {
        const job = {};
        columns.forEach((col, i) => job[col] = row[i]);
        job.metadata = job.metadata ? JSON.parse(job.metadata) : {};
        
        // If was downloading, mark as error (unexpected shutdown)
        if (job.status === JobStatus.DOWNLOADING) {
          job.status = JobStatus.ERROR;
          job.lastError = 'Application restarted during download';
          job.retryCount = (job.retryCount || 0);
          this._updateJob(job);
        }
        
        return job;
      });
    }
  }

  /**
   * Create a new download job
   */
  async create(options) {
    const {
      url,
      name,
      destinationDir,
      filename,
      expectedHash,
      hashAlgorithm = 'sha256',
      priority = 0,
      scheduledAt,
      provider,
      modelType,
      metadata = {},
    } = options;
    
    if (!url || !name) {
      throw new Error('URL and name are required');
    }
    
    const now = new Date().toISOString();
    const id = `dl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const destDir = destinationDir || path.join(app.getPath('userData'), 'models');
    const fname = filename || this._extractFilename(url, name);
    
    const job = {
      id,
      name,
      url,
      destinationDir: destDir,
      filename: fname,
      status: scheduledAt ? JobStatus.SCHEDULED : JobStatus.QUEUED,
      priority,
      scheduledAt: scheduledAt || null,
      totalBytes: 0,
      downloadedBytes: 0,
      progress: 0,
      speed: 0,
      expectedHash,
      hashAlgorithm,
      actualHash: null,
      retryCount: 0,
      lastError: null,
      nextRetryAt: null,
      provider: provider || null,
      modelType: modelType || null,
      metadata: JSON.stringify(metadata),
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    };
    
    // Insert into DB
    this.db.run(`
      INSERT INTO jobs (
        id, name, url, destinationDir, filename, status, priority, scheduledAt,
        totalBytes, downloadedBytes, progress, speed,
        expectedHash, hashAlgorithm, actualHash,
        retryCount, lastError, nextRetryAt,
        provider, modelType, metadata,
        createdAt, startedAt, completedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      job.id, job.name, job.url, job.destinationDir, job.filename, job.status, job.priority, job.scheduledAt,
      job.totalBytes, job.downloadedBytes, job.progress, job.speed,
      job.expectedHash, job.hashAlgorithm, job.actualHash,
      job.retryCount, job.lastError, job.nextRetryAt,
      job.provider, job.modelType, job.metadata,
      job.createdAt, job.startedAt, job.completedAt, job.updatedAt,
    ]);
    
    await this._saveDb();
    
    // Add to memory queue
    const jobWithParsedMeta = { ...job, metadata };
    this.queue.push(jobWithParsedMeta);
    this._sortQueue();
    
    this.emit('job:created', this._sanitizeJob(jobWithParsedMeta));
    
    // Start processing
    this._processQueue();
    
    return id;
  }

  /**
   * Update a job in DB
   */
  async _updateJob(job) {
    const now = new Date().toISOString();
    job.updatedAt = now;
    
    const metadataStr = typeof job.metadata === 'string' ? job.metadata : JSON.stringify(job.metadata || {});
    
    this.db.run(`
      UPDATE jobs SET
        status = ?, priority = ?, scheduledAt = ?,
        totalBytes = ?, downloadedBytes = ?, progress = ?, speed = ?,
        expectedHash = ?, hashAlgorithm = ?, actualHash = ?,
        retryCount = ?, lastError = ?, nextRetryAt = ?,
        provider = ?, modelType = ?, metadata = ?,
        startedAt = ?, completedAt = ?, updatedAt = ?
      WHERE id = ?
    `, [
      job.status, job.priority, job.scheduledAt,
      job.totalBytes, job.downloadedBytes, job.progress, job.speed,
      job.expectedHash, job.hashAlgorithm, job.actualHash,
      job.retryCount, job.lastError, job.nextRetryAt,
      job.provider, job.modelType, metadataStr,
      job.startedAt, job.completedAt, job.updatedAt,
      job.id,
    ]);
    
    // Debounce DB saves
    if (!this._saveTimeout) {
      this._saveTimeout = setTimeout(async () => {
        await this._saveDb();
        this._saveTimeout = null;
      }, 500);
    }
  }

  /**
   * Sort queue by priority (descending) then by createdAt (ascending)
   */
  _sortQueue() {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  /**
   * Process the download queue
   */
  async _processQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;
    
    try {
      while (this.activeJobs.size < MAX_CONCURRENT) {
        const now = new Date();
        
        // Find next eligible job
        const jobIndex = this.queue.findIndex(job => {
          // Skip if already active
          if (this.activeJobs.has(job.id)) return false;
          
          // Check status
          if (job.status === JobStatus.PAUSED || job.status === JobStatus.CANCELLED) return false;
          if (job.status === JobStatus.COMPLETED) return false;
          
          // Check scheduled time
          if (job.scheduledAt && new Date(job.scheduledAt) > now) return false;
          
          // Check retry delay
          if (job.nextRetryAt && new Date(job.nextRetryAt) > now) return false;
          
          return true;
        });
        
        if (jobIndex === -1) break;
        
        const job = this.queue[jobIndex];
        await this._startDownload(job);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Start downloading a job
   */
  async _startDownload(job) {
    const abortController = { aborted: false };
    this.activeJobs.set(job.id, { abortController });
    
    try {
      job.status = JobStatus.PREFLIGHT;
      job.startedAt = job.startedAt || new Date().toISOString();
      job.lastError = null;
      await this._updateJob(job);
      this.emit('job:started', this._sanitizeJob(job));
      
      // Ensure destination directory exists
      await fsPromises.mkdir(job.destinationDir, { recursive: true });
      
      const filePath = path.join(job.destinationDir, job.filename);
      const partPath = `${filePath}.part`;
      
      // Check for existing partial download
      let resumeBytes = 0;
      try {
        const stats = await fsPromises.stat(partPath);
        resumeBytes = stats.size;
        job.downloadedBytes = resumeBytes;
      } catch (err) {
        // No partial file
      }
      
      // Perform preflight to get content length
      const preflight = await this._preflight(job.url);
      job.totalBytes = preflight.contentLength;
      
      // Check if resume is valid
      if (resumeBytes > 0 && !preflight.acceptsRanges) {
        // Server doesn't support resume, delete partial
        await fsPromises.unlink(partPath).catch(() => {});
        resumeBytes = 0;
        job.downloadedBytes = 0;
      }
      
      // If already complete (from previous session), verify
      if (resumeBytes > 0 && resumeBytes >= job.totalBytes) {
        job.status = JobStatus.VERIFYING;
        await this._updateJob(job);
        
        const verified = await this._verifyFile(partPath, job.expectedHash, job.hashAlgorithm);
        if (verified) {
          await fsPromises.rename(partPath, filePath);
          job.status = JobStatus.COMPLETED;
          job.progress = 100;
          job.completedAt = new Date().toISOString();
          await this._updateJob(job);
          this.emit('job:completed', this._sanitizeJob(job));
          this.activeJobs.delete(job.id);
          return;
        } else {
          // Delete corrupted file
          await fsPromises.unlink(partPath).catch(() => {});
          resumeBytes = 0;
          job.downloadedBytes = 0;
        }
      }
      
      // Start download
      job.status = JobStatus.DOWNLOADING;
      await this._updateJob(job);
      
      await this._downloadFile(job, partPath, resumeBytes, abortController);
      
      if (abortController.aborted) return;
      
      // Verify
      job.status = JobStatus.VERIFYING;
      this.emit('job:progress', this._sanitizeJob(job));
      
      if (job.expectedHash) {
        const actualHash = await this._computeHash(partPath, job.hashAlgorithm);
        job.actualHash = actualHash;
        
        if (actualHash.toLowerCase() !== job.expectedHash.toLowerCase()) {
          throw new Error(`Hash mismatch: expected ${job.expectedHash}, got ${actualHash}`);
        }
      }
      
      // Move to final location
      await fsPromises.rename(partPath, filePath);
      
      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      await this._updateJob(job);
      this.emit('job:completed', this._sanitizeJob(job));
      
    } catch (error) {
      if (abortController.aborted) return;
      
      console.error(`[DownloadManagerV2] Job ${job.id} failed:`, error.message);
      
      job.lastError = error.message;
      job.retryCount = (job.retryCount || 0) + 1;
      
      if (job.retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[Math.min(job.retryCount - 1, RETRY_DELAYS.length - 1)];
        job.nextRetryAt = new Date(Date.now() + delay).toISOString();
        job.status = JobStatus.ERROR;
        console.log(`[DownloadManagerV2] Will retry job ${job.id} in ${delay / 1000}s`);
        
        // Schedule retry
        setTimeout(() => this._processQueue(), delay);
      } else {
        job.status = JobStatus.ERROR;
        job.nextRetryAt = null;
      }
      
      await this._updateJob(job);
      this.emit('job:error', this._sanitizeJob(job));
      
    } finally {
      this.activeJobs.delete(job.id);
      await this._saveDb();
      this._processQueue();
    }
  }

  /**
   * Preflight request to get content length and check range support
   */
  async _preflight(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = protocol.request(parsedUrl, {
        method: 'HEAD',
        timeout: 30000,
        headers: {
          'User-Agent': 'DevForge/2.0 DownloadManager',
        },
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._preflight(res.headers.location).then(resolve).catch(reject);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`Preflight failed: HTTP ${res.statusCode}`));
          return;
        }
        
        resolve({
          contentLength: parseInt(res.headers['content-length'] || '0', 10),
          acceptsRanges: res.headers['accept-ranges'] === 'bytes',
          contentType: res.headers['content-type'],
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Preflight timeout'));
      });
      req.end();
    });
  }

  /**
   * Download file with resume support
   */
  async _downloadFile(job, partPath, resumeBytes, abortController) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(job.url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const headers = {
        'User-Agent': 'DevForge/2.0 DownloadManager',
      };
      
      if (resumeBytes > 0) {
        headers['Range'] = `bytes=${resumeBytes}-`;
      }
      
      const req = protocol.request(parsedUrl, {
        method: 'GET',
        timeout: 60000,
        headers,
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          job.url = res.headers.location; // Update URL for future retries
          this._downloadFile(job, partPath, resumeBytes, abortController).then(resolve).catch(reject);
          return;
        }
        
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        
        // Server didn't respect Range header
        if (resumeBytes > 0 && res.statusCode === 200) {
          job.downloadedBytes = 0;
          resumeBytes = 0;
        }
        
        const fileStream = fs.createWriteStream(partPath, {
          flags: resumeBytes > 0 && res.statusCode === 206 ? 'a' : 'w',
        });
        
        // Store reference for pause/cancel
        const activeJob = this.activeJobs.get(job.id);
        if (activeJob) {
          activeJob.request = req;
          activeJob.fileStream = fileStream;
        }
        
        let lastProgressTime = 0;
        let lastBytes = job.downloadedBytes;
        let lastSpeedTime = Date.now();
        
        res.on('data', (chunk) => {
          if (abortController.aborted) {
            req.destroy();
            fileStream.destroy();
            return;
          }
          
          fileStream.write(chunk);
          job.downloadedBytes += chunk.length;
          
          if (job.totalBytes > 0) {
            job.progress = Math.round((job.downloadedBytes / job.totalBytes) * 100);
          }
          
          // Calculate speed
          const now = Date.now();
          const timeDiff = (now - lastSpeedTime) / 1000;
          if (timeDiff >= 1) {
            job.speed = (job.downloadedBytes - lastBytes) / timeDiff;
            lastBytes = job.downloadedBytes;
            lastSpeedTime = now;
          }
          
          // Throttle progress events
          if (now - lastProgressTime > PROGRESS_THROTTLE_MS) {
            this.emit('job:progress', this._sanitizeJob(job));
            lastProgressTime = now;
          }
        });
        
        res.on('end', () => {
          fileStream.end(() => {
            if (!abortController.aborted) {
              resolve();
            }
          });
        });
        
        res.on('error', (err) => {
          fileStream.destroy();
          reject(err);
        });
        
        fileStream.on('error', (err) => {
          req.destroy();
          reject(err);
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
      req.end();
    });
  }

  /**
   * Verify file hash
   */
  async _verifyFile(filePath, expectedHash, algorithm = 'sha256') {
    if (!expectedHash) return true;
    
    const actualHash = await this._computeHash(filePath, algorithm);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }

  /**
   * Compute file hash
   */
  async _computeHash(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Extract filename from URL or generate one
   */
  _extractFilename(url, name) {
    try {
      const pathname = new URL(url).pathname;
      const urlFilename = path.basename(pathname);
      if (urlFilename && !urlFilename.includes('?')) {
        return urlFilename;
      }
    } catch (err) {
      // Ignore
    }
    
    // Sanitize name for filename
    return name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.bin';
  }

  /**
   * Sanitize job for external use (hide internal fields)
   */
  _sanitizeJob(job) {
    return {
      id: job.id,
      name: job.name,
      url: job.url,
      destinationDir: job.destinationDir,
      filename: job.filename,
      status: job.status,
      priority: job.priority,
      scheduledAt: job.scheduledAt,
      totalBytes: job.totalBytes,
      downloadedBytes: job.downloadedBytes,
      progress: job.progress,
      speed: job.speed,
      expectedHash: job.expectedHash,
      hashAlgorithm: job.hashAlgorithm,
      actualHash: job.actualHash,
      retryCount: job.retryCount,
      lastError: job.lastError,
      nextRetryAt: job.nextRetryAt,
      provider: job.provider,
      modelType: job.modelType,
      metadata: typeof job.metadata === 'string' ? JSON.parse(job.metadata) : (job.metadata || {}),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Get all jobs
   */
  getAll() {
    const results = this.db.exec(`SELECT * FROM jobs ORDER BY createdAt DESC`);
    if (results.length === 0) return [];
    
    const columns = results[0].columns;
    return results[0].values.map(row => {
      const job = {};
      columns.forEach((col, i) => job[col] = row[i]);
      return this._sanitizeJob(job);
    });
  }

  /**
   * Get a specific job
   */
  get(id) {
    const results = this.db.exec(`SELECT * FROM jobs WHERE id = ?`, [id]);
    if (results.length === 0 || results[0].values.length === 0) return null;
    
    const columns = results[0].columns;
    const job = {};
    columns.forEach((col, i) => job[col] = results[0].values[0][i]);
    return this._sanitizeJob(job);
  }

  /**
   * Pause a download
   */
  async pause(id) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    if (job.status !== JobStatus.DOWNLOADING && job.status !== JobStatus.QUEUED) {
      return { success: false, error: 'Job cannot be paused in current state' };
    }
    
    // Abort active download
    const active = this.activeJobs.get(id);
    if (active) {
      active.abortController.aborted = true;
      if (active.request) active.request.destroy();
      if (active.fileStream) active.fileStream.end();
      this.activeJobs.delete(id);
    }
    
    job.status = JobStatus.PAUSED;
    await this._updateJob(job);
    await this._saveDb();
    
    this.emit('job:paused', this._sanitizeJob(job));
    return { success: true };
  }

  /**
   * Resume a paused download
   */
  async resume(id) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    if (job.status !== JobStatus.PAUSED) {
      return { success: false, error: 'Job is not paused' };
    }
    
    job.status = JobStatus.QUEUED;
    job.lastError = null;
    await this._updateJob(job);
    await this._saveDb();
    
    this._processQueue();
    return { success: true };
  }

  /**
   * Retry a failed download
   */
  async retry(id) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    if (job.status !== JobStatus.ERROR && job.status !== JobStatus.CANCELLED) {
      return { success: false, error: 'Job is not in a retryable state' };
    }
    
    job.status = JobStatus.QUEUED;
    job.retryCount = 0;
    job.lastError = null;
    job.nextRetryAt = null;
    await this._updateJob(job);
    await this._saveDb();
    
    this._processQueue();
    return { success: true };
  }

  /**
   * Cancel a download
   */
  async cancel(id) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    // Abort active download
    const active = this.activeJobs.get(id);
    if (active) {
      active.abortController.aborted = true;
      if (active.request) active.request.destroy();
      if (active.fileStream) active.fileStream.end();
      this.activeJobs.delete(id);
    }
    
    job.status = JobStatus.CANCELLED;
    await this._updateJob(job);
    await this._saveDb();
    
    this.emit('job:cancelled', this._sanitizeJob(job));
    return { success: true };
  }

  /**
   * Set job priority
   */
  async setPriority(id, priority) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    job.priority = priority;
    await this._updateJob(job);
    await this._saveDb();
    this._sortQueue();
    
    return { success: true };
  }

  /**
   * Schedule a download for later
   */
  async schedule(id, scheduledAt) {
    const job = this.queue.find(j => j.id === id);
    if (!job) return { success: false, error: 'Job not found' };
    
    job.scheduledAt = scheduledAt ? new Date(scheduledAt).toISOString() : null;
    job.status = scheduledAt ? JobStatus.SCHEDULED : JobStatus.QUEUED;
    await this._updateJob(job);
    await this._saveDb();
    
    this._processQueue();
    return { success: true };
  }

  /**
   * Delete a job and optionally its files
   */
  async delete(id, deleteFiles = false) {
    const job = this.queue.find(j => j.id === id);
    
    // Cancel if active
    if (job && this.activeJobs.has(id)) {
      await this.cancel(id);
    }
    
    // Remove from queue
    this.queue = this.queue.filter(j => j.id !== id);
    
    // Delete from DB
    this.db.run(`DELETE FROM jobs WHERE id = ?`, [id]);
    await this._saveDb();
    
    // Delete files if requested
    if (deleteFiles && job) {
      const filePath = path.join(job.destinationDir, job.filename);
      const partPath = `${filePath}.part`;
      await fsPromises.unlink(filePath).catch(() => {});
      await fsPromises.unlink(partPath).catch(() => {});
    }
    
    return { success: true };
  }

  /**
   * Clear all completed downloads
   */
  async clearCompleted() {
    this.queue = this.queue.filter(j => j.status !== JobStatus.COMPLETED);
    this.db.run(`DELETE FROM jobs WHERE status = ?`, [JobStatus.COMPLETED]);
    await this._saveDb();
    return { success: true };
  }
}

// Singleton
let instance = null;

function getDownloadManagerV2() {
  if (!instance) {
    instance = new DownloadManagerV2();
  }
  return instance;
}

module.exports = {
  DownloadManagerV2,
  getDownloadManagerV2,
  JobStatus,
};
