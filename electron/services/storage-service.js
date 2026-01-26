/**
 * StorageService - Manages model storage, disk usage, and cleanup
 * 
 * Features:
 * - Disk usage tracking per drive/directory
 * - Cleanup orphaned/unused files
 * - Move models between drives
 * - Multi-drive support
 * - Low disk space warnings
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');

// Size thresholds
const LOW_DISK_WARNING_GB = 10;
const CRITICAL_DISK_WARNING_GB = 5;

/**
 * Get drive info (cross-platform)
 */
async function getDriveInfo() {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Windows: use PowerShell Get-CimInstance (wmic is deprecated)
      const psCommand = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,FreeSpace,Size | ConvertTo-Csv -NoTypeInformation"`;
      exec(psCommand, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        const drives = [];
        const lines = stdout.trim().split('\n').slice(1); // Skip header
        
        for (const line of lines) {
          // PowerShell CSV format: "DeviceID","FreeSpace","Size"
          const parts = line.replace(/"/g, '').trim().split(',');
          if (parts.length >= 3) {
            const letter = parts[0];
            const freeSpace = parseInt(parts[1], 10) || 0;
            const totalSize = parseInt(parts[2], 10) || 0;
            
            if (letter && totalSize > 0) {
              drives.push({
                mount: letter,
                path: `${letter}\\`,
                total: totalSize,
                free: freeSpace,
                used: totalSize - freeSpace,
                usedPercent: Math.round(((totalSize - freeSpace) / totalSize) * 100),
              });
            }
          }
        }
        
        resolve(drives);
      });
    } else {
      // Unix: use df
      exec('df -P -B1', (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        const drives = [];
        const lines = stdout.trim().split('\n').slice(1); // Skip header
        
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 6) {
            const mount = parts[5];
            const total = parseInt(parts[1], 10) || 0;
            const used = parseInt(parts[2], 10) || 0;
            const free = parseInt(parts[3], 10) || 0;
            
            // Skip system/special mounts
            if (mount.startsWith('/dev') || mount.startsWith('/sys') || 
                mount.startsWith('/proc') || mount.startsWith('/run')) {
              continue;
            }
            
            if (total > 0) {
              drives.push({
                mount,
                path: mount,
                total,
                free,
                used,
                usedPercent: Math.round((used / total) * 100),
              });
            }
          }
        }
        
        resolve(drives);
      });
    }
  });
}

/**
 * Get directory size recursively
 */
async function getDirectorySize(dirPath) {
  let totalSize = 0;
  let fileCount = 0;
  
  async function walkDir(dir) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fsPromises.stat(fullPath);
            totalSize += stats.size;
            fileCount++;
          } catch (err) {
            // Skip inaccessible files
          }
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }
  
  await walkDir(dirPath);
  return { size: totalSize, fileCount };
}

/**
 * StorageService class
 */
class StorageService extends EventEmitter {
  constructor() {
    super();
    this.modelDirectories = [];
    this.usageCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Set the model directories to track
   */
  setModelDirectories(directories) {
    this.modelDirectories = directories;
  }

  /**
   * Add a model directory
   */
  addModelDirectory(directory) {
    if (!this.modelDirectories.includes(directory)) {
      this.modelDirectories.push(directory);
    }
  }

  /**
   * Get all available drives
   */
  async getDrives() {
    try {
      const drives = await getDriveInfo();
      
      // Add warning flags
      return drives.map(drive => ({
        ...drive,
        lowSpace: drive.free < LOW_DISK_WARNING_GB * 1024 * 1024 * 1024,
        criticalSpace: drive.free < CRITICAL_DISK_WARNING_GB * 1024 * 1024 * 1024,
      }));
    } catch (error) {
      console.error('[StorageService] Failed to get drives:', error);
      return [];
    }
  }

  /**
   * Get disk usage for model directories
   */
  async getModelStorageUsage() {
    const usage = {
      directories: [],
      totalSize: 0,
      totalFiles: 0,
      byType: {},
    };
    
    for (const dir of this.modelDirectories) {
      if (!fs.existsSync(dir)) continue;
      
      // Check cache
      const cacheKey = `dir:${dir}`;
      const cached = this.usageCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        usage.directories.push(cached.data);
        usage.totalSize += cached.data.size;
        usage.totalFiles += cached.data.fileCount;
        continue;
      }
      
      // Calculate fresh
      const { size, fileCount } = await getDirectorySize(dir);
      
      // Get drive info for this directory
      const drives = await this.getDrives();
      const dirDrive = drives.find(d => 
        dir.toLowerCase().startsWith(d.path.toLowerCase()) ||
        dir.toLowerCase().startsWith(d.mount.toLowerCase())
      );
      
      const dirUsage = {
        path: dir,
        name: path.basename(dir),
        size,
        fileCount,
        drive: dirDrive?.mount || 'unknown',
        driveTotal: dirDrive?.total || 0,
        driveFree: dirDrive?.free || 0,
      };
      
      // Cache the result
      this.usageCache.set(cacheKey, {
        timestamp: Date.now(),
        data: dirUsage,
      });
      
      usage.directories.push(dirUsage);
      usage.totalSize += size;
      usage.totalFiles += fileCount;
    }
    
    return usage;
  }

  /**
   * Get detailed breakdown of a directory
   */
  async getDirectoryBreakdown(dirPath) {
    const breakdown = {
      path: dirPath,
      subdirectories: [],
      files: [],
      totalSize: 0,
    };
    
    if (!fs.existsSync(dirPath)) {
      return breakdown;
    }
    
    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          const { size, fileCount } = await getDirectorySize(fullPath);
          breakdown.subdirectories.push({
            name: entry.name,
            path: fullPath,
            size,
            fileCount,
          });
          breakdown.totalSize += size;
        } else if (entry.isFile()) {
          try {
            const stats = await fsPromises.stat(fullPath);
            breakdown.files.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              modified: stats.mtime.toISOString(),
            });
            breakdown.totalSize += stats.size;
          } catch (err) {
            // Skip
          }
        }
      }
      
      // Sort by size descending
      breakdown.subdirectories.sort((a, b) => b.size - a.size);
      breakdown.files.sort((a, b) => b.size - a.size);
      
    } catch (error) {
      console.error('[StorageService] Failed to get breakdown:', error);
    }
    
    return breakdown;
  }

  /**
   * Find orphaned files (not in any engine's library)
   */
  async findOrphanedFiles(libraryModels = []) {
    const orphaned = [];
    const libraryPaths = new Set(libraryModels.map(m => m.path?.toLowerCase()));
    
    for (const dir of this.modelDirectories) {
      if (!fs.existsSync(dir)) continue;
      
      await this._scanForOrphans(dir, libraryPaths, orphaned);
    }
    
    return orphaned;
  }

  async _scanForOrphans(dir, libraryPaths, orphaned) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this._scanForOrphans(fullPath, libraryPaths, orphaned);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const isModelFile = ['.gguf', '.safetensors', '.ckpt', '.bin', '.pt', '.pth'].includes(ext);
          
          if (isModelFile && !libraryPaths.has(fullPath.toLowerCase())) {
            try {
              const stats = await fsPromises.stat(fullPath);
              orphaned.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                modified: stats.mtime.toISOString(),
              });
            } catch (err) {
              // Skip
            }
          }
        }
      }
    } catch (error) {
      // Skip inaccessible directories
    }
  }

  /**
   * Find duplicate files (by size + partial hash)
   */
  async findDuplicates() {
    const filesBySize = new Map();
    const duplicates = [];
    
    // First pass: group by size
    for (const dir of this.modelDirectories) {
      if (!fs.existsSync(dir)) continue;
      
      await this._groupBySize(dir, filesBySize);
    }
    
    // Second pass: check potential duplicates
    for (const [size, files] of filesBySize) {
      if (files.length < 2) continue;
      if (size < 1024 * 1024 * 100) continue; // Only check files > 100MB
      
      // Group by partial hash
      const byHash = new Map();
      for (const file of files) {
        const hash = await this._getPartialHash(file.path);
        if (!hash) continue;
        
        const existing = byHash.get(hash);
        if (existing) {
          existing.push(file);
        } else {
          byHash.set(hash, [file]);
        }
      }
      
      // Add groups with duplicates
      for (const [hash, group] of byHash) {
        if (group.length > 1) {
          duplicates.push({
            hash,
            size,
            files: group,
          });
        }
      }
    }
    
    return duplicates;
  }

  async _groupBySize(dir, filesBySize) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this._groupBySize(fullPath, filesBySize);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const isModelFile = ['.gguf', '.safetensors', '.ckpt', '.bin', '.pt', '.pth'].includes(ext);
          
          if (isModelFile) {
            try {
              const stats = await fsPromises.stat(fullPath);
              const existing = filesBySize.get(stats.size);
              const fileInfo = { path: fullPath, name: entry.name, modified: stats.mtime };
              
              if (existing) {
                existing.push(fileInfo);
              } else {
                filesBySize.set(stats.size, [fileInfo]);
              }
            } catch (err) {
              // Skip
            }
          }
        }
      }
    } catch (error) {
      // Skip
    }
  }

  async _getPartialHash(filePath) {
    const crypto = require('crypto');
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    
    return new Promise((resolve) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath, { start: 0, end: CHUNK_SIZE - 1 });
      
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    });
  }

  /**
   * Move a model to a different directory/drive
   */
  async moveModel(sourcePath, targetDir, options = {}) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Source file not found');
    }
    
    const filename = path.basename(sourcePath);
    const targetPath = path.join(targetDir, filename);
    
    // Ensure target directory exists
    await fsPromises.mkdir(targetDir, { recursive: true });
    
    // Check if target already exists
    if (fs.existsSync(targetPath) && !options.overwrite) {
      throw new Error('Target file already exists');
    }
    
    const stats = await fsPromises.stat(sourcePath);
    
    // Check target drive space
    const drives = await this.getDrives();
    const targetDrive = drives.find(d => 
      targetDir.toLowerCase().startsWith(d.path.toLowerCase()) ||
      targetDir.toLowerCase().startsWith(d.mount.toLowerCase())
    );
    
    if (targetDrive && targetDrive.free < stats.size) {
      throw new Error('Insufficient space on target drive');
    }
    
    // Try rename first (fastest if same filesystem)
    try {
      await fsPromises.rename(sourcePath, targetPath);
      this.emit('model:moved', { source: sourcePath, target: targetPath });
      return { success: true, path: targetPath, method: 'rename' };
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
    }
    
    // Cross-filesystem: copy then delete
    let copied = 0;
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourcePath);
      const writeStream = fs.createWriteStream(targetPath);
      
      readStream.on('data', (chunk) => {
        copied += chunk.length;
        if (options.onProgress) {
          options.onProgress({
            copied,
            total: stats.size,
            progress: Math.round((copied / stats.size) * 100),
          });
        }
      });
      
      readStream.on('error', reject);
      writeStream.on('error', reject);
      
      writeStream.on('finish', async () => {
        try {
          // Verify copy
          const targetStats = await fsPromises.stat(targetPath);
          if (targetStats.size !== stats.size) {
            await fsPromises.unlink(targetPath);
            reject(new Error('Copy verification failed'));
            return;
          }
          
          // Delete source
          await fsPromises.unlink(sourcePath);
          this.emit('model:moved', { source: sourcePath, target: targetPath });
          resolve({ success: true, path: targetPath, method: 'copy' });
        } catch (err) {
          reject(err);
        }
      });
      
      readStream.pipe(writeStream);
    });
  }

  /**
   * Delete files
   */
  async deleteFiles(filePaths) {
    const results = [];
    
    for (const filePath of filePaths) {
      try {
        await fsPromises.unlink(filePath);
        results.push({ path: filePath, success: true });
        this.emit('file:deleted', { path: filePath });
      } catch (error) {
        results.push({ path: filePath, success: false, error: error.message });
      }
    }
    
    // Clear cache
    this.clearCache();
    
    return results;
  }

  /**
   * Clear the usage cache
   */
  clearCache() {
    this.usageCache.clear();
  }

  /**
   * Get storage recommendations
   */
  async getRecommendations() {
    const recommendations = [];
    
    // Check drive space
    const drives = await this.getDrives();
    for (const drive of drives) {
      if (drive.criticalSpace) {
        recommendations.push({
          type: 'critical',
          message: `Critical: ${drive.mount} has only ${Math.round(drive.free / (1024 * 1024 * 1024))} GB free`,
          drive: drive.mount,
        });
      } else if (drive.lowSpace) {
        recommendations.push({
          type: 'warning',
          message: `Warning: ${drive.mount} is running low on space`,
          drive: drive.mount,
        });
      }
    }
    
    // Check for duplicates
    const duplicates = await this.findDuplicates();
    if (duplicates.length > 0) {
      const totalWasted = duplicates.reduce((sum, d) => sum + (d.size * (d.files.length - 1)), 0);
      recommendations.push({
        type: 'cleanup',
        message: `${duplicates.length} potential duplicate models found (${Math.round(totalWasted / (1024 * 1024 * 1024))} GB recoverable)`,
        duplicates,
      });
    }
    
    return recommendations;
  }
}

// Singleton
let storageInstance = null;

function getStorageService() {
  if (!storageInstance) {
    storageInstance = new StorageService();
  }
  return storageInstance;
}

module.exports = {
  StorageService,
  getStorageService,
  getDriveInfo,
  getDirectorySize,
};



