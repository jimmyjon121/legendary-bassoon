const http = require('http');
const https = require('https');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

// In-memory download registry (no persistence needed)
const downloads = new Map();
const NON_SERIALIZABLE_DOWNLOAD_KEYS = new Set(['request', 'fileStream', 'socket', 'connection', 'req', 'res']);

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeForIpc(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[Truncated]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForIpc(item, depth + 1, seen))
      .filter((item) => item !== undefined);
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (NON_SERIALIZABLE_DOWNLOAD_KEYS.has(key)) continue;
    const safeValue = sanitizeForIpc(nested, depth + 1, seen);
    if (safeValue !== undefined) {
      output[key] = safeValue;
    }
  }
  return output;
}

function toPublicDownloadRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const safeRecord = sanitizeForIpc(record);
  if (!safeRecord || typeof safeRecord !== 'object') return null;

  return {
    ...safeRecord,
    id: safeRecord.id ? String(safeRecord.id) : '',
    name: safeRecord.name ? String(safeRecord.name) : '',
    source: safeRecord.source ? String(safeRecord.source) : 'ollama',
    type: safeRecord.type ? String(safeRecord.type) : 'ollama',
    status: safeRecord.status ? String(safeRecord.status) : 'queued',
    progress: toFiniteNumber(safeRecord.progress, 0),
    totalBytes: toFiniteNumber(safeRecord.totalBytes, 0),
    downloadedBytes: toFiniteNumber(safeRecord.downloadedBytes, 0),
    speed: toFiniteNumber(safeRecord.speed, 0),
    error: safeRecord.error == null ? null : String(safeRecord.error),
    startedAt: safeRecord.startedAt ? String(safeRecord.startedAt) : null,
    updatedAt: safeRecord.updatedAt ? String(safeRecord.updatedAt) : null,
    statusMessage: safeRecord.statusMessage == null ? null : String(safeRecord.statusMessage),
    digest: safeRecord.digest == null ? null : String(safeRecord.digest),
  };
}

function createRecord(partial) {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    name: partial.name,
    source: partial.source || 'ollama',
    type: partial.type || 'ollama',
    status: partial.status || 'queued', // queued | downloading | completed | error | cancelled
    progress: partial.progress ?? 0,
    error: null,
    startedAt: partial.startedAt || now,
    updatedAt: partial.updatedAt || now,
    metadata: partial.metadata || null,
  };
}

function updateRecord(id, patch) {
  const existing = downloads.get(id);
  if (!existing) return;
  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  downloads.set(id, updated);
}

function startOllamaDownload(modelName, endpoint, onProgress = null) {
  const id = `ollama:${modelName}:${Date.now()}`;
  const record = createRecord({
    id,
    name: modelName,
    source: 'ollama',
    type: 'ollama',
    status: 'queued',
    progress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
  });
  downloads.set(id, record);

  const url = `${endpoint.replace(/\/$/, '')}/api/pull`;
  const urlObj = new URL(url);
  const protocol = urlObj.protocol === 'https:' ? https : http;

  const reqOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const req = protocol.request(reqOptions, (res) => {
    if (res.statusCode !== 200) {
      updateRecord(id, {
        status: 'error',
        error: `HTTP ${res.statusCode}`,
      });
      if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
      return;
    }

    updateRecord(id, { status: 'downloading', progress: 0 });
    if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
    
    let buffer = '';
    let lastSpeedCalc = Date.now();
    let lastBytes = 0;
    
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Ollama streams newline-delimited JSON
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const data = JSON.parse(line);
          const record = downloads.get(id);
          
          // Parse Ollama's progress format
          if (data.status === 'success') {
            updateRecord(id, { 
              status: 'completed', 
              progress: 100,
              statusMessage: 'Download complete'
            });
          } else if (data.status === 'error' || data.error) {
            updateRecord(id, { 
              status: 'error', 
              error: data.error || data.status 
            });
          } else if (data.total && data.completed !== undefined) {
            // Calculate progress percentage
            const progress = Math.round((data.completed / data.total) * 100);
            
            // Calculate speed
            const now = Date.now();
            const timeDiff = (now - lastSpeedCalc) / 1000;
            let speed = record?.speed || 0;
            if (timeDiff >= 1) {
              speed = (data.completed - lastBytes) / timeDiff;
              lastBytes = data.completed;
              lastSpeedCalc = now;
            }
            
            updateRecord(id, { 
              status: 'downloading',
              progress,
              totalBytes: data.total,
              downloadedBytes: data.completed,
              speed,
              statusMessage: data.status || 'Downloading...',
              digest: data.digest
            });
          } else if (data.status) {
            // Status updates like "pulling manifest", "verifying", etc.
            const statusProgress = {
              'pulling manifest': 1,
              'verifying sha256 digest': 95,
              'writing manifest': 97,
              'removing any unused layers': 99,
            };
            const progress = statusProgress[data.status] || record?.progress || 0;
            updateRecord(id, { 
              statusMessage: data.status,
              progress: Math.max(record?.progress || 0, progress)
            });
          }
          
          if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
        } catch (e) {
          // Ignore parse errors for incomplete JSON
        }
      }
    });
    
    res.on('end', () => {
      const record = downloads.get(id);
      // If we didn't get a success status, check if it completed
      if (record && record.status === 'downloading') {
        if (record.progress >= 95) {
          updateRecord(id, { status: 'completed', progress: 100 });
        } else {
          updateRecord(id, { 
            status: 'error', 
            error: 'Download ended unexpectedly' 
          });
        }
        if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
      }
    });
    
    res.on('error', (error) => {
      updateRecord(id, { status: 'error', error: error.message });
      if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
    });
  });

  req.on('error', (error) => {
    updateRecord(id, { status: 'error', error: error.message });
    if (onProgress) onProgress(toPublicDownloadRecord(downloads.get(id)));
  });

  // Store request for cancellation
  updateRecord(id, { request: req, status: 'downloading', progress: 0 });

  req.write(JSON.stringify({ name: modelName }));
  req.end();

  return id;
}

async function ensureDirectory(dirPath) {
  if (!dirPath) {
    throw new Error('No target directory configured for downloads');
  }
  await fsPromises.mkdir(dirPath, { recursive: true });
}

async function verifyChecksum(filePath, expected, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const digest = hash.digest('hex');
      resolve(digest.toLowerCase() === expected.toLowerCase());
    });
    stream.on('error', (error) => reject(error));
  });
}

function startHttpDownload({
  url,
  fileName,
  targetDir,
  source = 'huggingface',
  type = 'huggingface',
  headers = {},
  metadata = {},
  checksum,
  checksumAlgorithm = 'sha256',
}) {
  if (!url) {
    throw new Error('Missing download URL');
  }
  if (!fileName) {
    fileName = path.basename(new URL(url).pathname) || `download-${Date.now()}`;
  }
  const id = `${type}:${fileName}:${Date.now()}`;
  const record = createRecord({
    id,
    name: fileName,
    source,
    type,
    status: 'preparing',
    progress: 0,
    metadata: {
      ...metadata,
      checksum,
      checksumAlgorithm,
    },
  });
  downloads.set(id, record);

  const destPath = path.join(targetDir, fileName);

  const start = async () => {
    await ensureDirectory(targetDir);
    return new Promise((resolve) => {
      const downloadFrom = (currentUrl, depth = 0) => {
        const urlObj = new URL(currentUrl);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'User-Agent': headers['User-Agent'] || 'DevForge/0.1 (Download)',
            ...headers,
          },
        };

        const req = protocol.request(reqOptions, (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            depth < 5
          ) {
            req.destroy();
            const nextUrl = new URL(res.headers.location, currentUrl).toString();
            downloadFrom(nextUrl, depth + 1);
            return;
          }

          if (res.statusCode !== 200) {
            updateRecord(id, {
              status: 'error',
              error: `HTTP ${res.statusCode}`,
            });
            resolve();
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          updateRecord(id, { status: 'downloading', progress: total ? 1 : 0 });

          const fileStream = fs.createWriteStream(destPath);
          updateRecord(id, { filePath: destPath });

          res.on('data', (chunk) => {
            if (fileStream.writable) {
              fileStream.write(chunk);
            }
            received += chunk.length;
            if (total) {
              const pct = Math.min(99, Math.round((received / total) * 100));
              updateRecord(id, { progress: pct });
            }
          });

          res.on('end', () => {
            fileStream.end(async () => {
              if (checksum) {
                try {
                  const match = await verifyChecksum(destPath, checksum, checksumAlgorithm);
                  if (!match) {
                    updateRecord(id, {
                      status: 'error',
                      error: 'Checksum mismatch',
                    });
                    fsPromises.unlink(destPath).catch(() => {});
                    resolve();
                    return;
                  }
                } catch (error) {
                  updateRecord(id, {
                    status: 'error',
                    error: `Checksum verification failed: ${error.message}`,
                  });
                  fsPromises.unlink(destPath).catch(() => {});
                  resolve();
                  return;
                }
              }
              updateRecord(id, { status: 'completed', progress: 100 });
              resolve();
            });
          });

          res.on('error', (error) => {
            fileStream.destroy();
            updateRecord(id, { status: 'error', error: error.message });
            resolve();
          });

          updateRecord(id, { request: req, fileStream });
        });

        req.on('error', (error) => {
          updateRecord(id, { status: 'error', error: error.message });
          resolve();
        });

        req.end();
      };

      downloadFrom(url);
    });
  };

  start().catch((error) => {
    updateRecord(id, { status: 'error', error: error.message });
  });

  return id;
}

function startHuggingFaceDownload({ repo, file, targetDir, revision = 'main' }) {
  if (!repo || !file) throw new Error('Missing HuggingFace repo or file');
  const encodedRepo = encodeURIComponent(repo);
  const safeRevision = revision && revision.trim() ? revision.trim() : 'main';
  const encodedRevision = encodeURIComponent(safeRevision);
  const filePath = file.startsWith('/') ? file.slice(1) : file;
  const url = `https://huggingface.co/${encodedRepo}/resolve/${encodedRevision}/${filePath}?download=1`;
  return startHttpDownload({
    url,
    fileName: path.basename(filePath),
    targetDir,
    source: 'huggingface',
    type: 'huggingface',
    metadata: { repo, file: filePath, revision: safeRevision },
    headers: {
      Accept: '*/*',
    },
  });
}

function startCustomDownload({ url, fileName, targetDir, checksum, checksumAlgorithm }) {
  if (!url) throw new Error('Missing URL');
  return startHttpDownload({
    url,
    fileName,
    targetDir,
    source: 'custom',
    type: 'url',
    metadata: { url },
    checksum,
    checksumAlgorithm,
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const req = protocol.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'DevForge/0.1 (+https://devforge.local)',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchHuggingFaceRepo(repo, revision = 'main') {
  if (!repo) throw new Error('Missing repository name');
  const encodedRepo = encodeURIComponent(repo);
  const params = new URLSearchParams();
  params.append('expand[]', 'files');
  if (revision && revision.trim()) {
    params.append('revision', revision.trim());
  }
  const url = `https://huggingface.co/api/models/${encodedRepo}?${params.toString()}`;
  const data = await fetchJson(url);
  const files = (data.siblings || data.files || []).map((file) => ({
    rfilename: file.rfilename || file.filename || file.path,
    size: file.size ?? file.lfs?.size ?? null,
    sha: file.sha || file.rfilename_sha,
    lfs: file.lfs,
  }));
  return {
    repo: data.modelId || repo,
    revision: revision && revision.trim() ? revision.trim() : 'main',
    tags: data.tags || [],
    pipeline: data.pipeline_tag || null,
    downloads: data.downloads || null,
    likes: data.likes || null,
    files,
  };
}

function cancelDownload(id) {
  const record = downloads.get(id);
  if (!record) {
    return { success: false, error: 'Download not found' };
  }
  if (record.request) {
    try {
      record.request.destroy();
    } catch {
      // ignore
    }
  }
  if (record.fileStream) {
    try {
      record.fileStream.destroy();
    } catch {
      // ignore
    }
  }
  if (record.filePath) {
    fsPromises.unlink(record.filePath).catch(() => {});
  }
  updateRecord(id, { status: 'cancelled' });
  return { success: true };
}

function getDownloads() {
  return Array.from(downloads.values())
    .map((record) => toPublicDownloadRecord(record))
    .filter(Boolean);
}

module.exports = {
  startOllamaDownload,
  startHuggingFaceDownload,
  startCustomDownload,
  fetchHuggingFaceRepo,
  cancelDownload,
  getDownloads,
};

