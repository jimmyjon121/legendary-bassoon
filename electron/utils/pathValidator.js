/**
 * Path Validator - Security utility for file operations
 * Prevents directory traversal attacks and unauthorized file access
 */

const path = require('path');
const { app } = require('electron');

// Allowed base directories for file operations
const ALLOWED_BASES = [
  // User data directory (app settings, database, etc.)
  () => app.getPath('userData'),
  // User's documents folder
  () => app.getPath('documents'),
  // User's downloads folder
  () => app.getPath('downloads'),
  // User's desktop
  () => app.getPath('desktop'),
  // User's home directory (with restrictions)
  () => app.getPath('home'),
  // Temp directory for temporary files
  () => app.getPath('temp'),
  // App installation directory (read-only)
  () => app.getAppPath(),
];

// Patterns that indicate potential attacks
const DANGEROUS_PATTERNS = [
  /\.\.[\/\\]/, // Directory traversal
  /^[\/\\]/, // Absolute paths starting with / or \
  /^[a-zA-Z]:/, // Windows absolute paths like C:
  /%2e%2e/i, // URL-encoded ..
  /%2f/i, // URL-encoded /
  /%5c/i, // URL-encoded \
  /\0/, // Null bytes
];

// Dangerous file extensions that should be blocked for writes
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr',
  '.pif', '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf',
  '.ps1', '.psm1', '.psd1', // PowerShell
  '.sh', '.bash', // Shell scripts
  '.dll', '.sys', // System files
];

// Sensitive system directories that should never be accessed
const BLOCKED_PATHS = [
  'Windows', 'System32', 'SysWOW64',
  'Program Files', 'Program Files (x86)',
  '.ssh', '.gnupg', '.aws', '.azure',
  'node_modules', // Prevent tampering with dependencies
];

/**
 * Validates if a path is safe for file operations
 * @param {string} requestedPath - The path to validate
 * @param {object} options - Validation options
 * @param {boolean} options.allowAbsolute - Allow absolute paths (default: false)
 * @param {boolean} options.isWrite - Is this a write operation (stricter checks)
 * @param {string[]} options.additionalAllowed - Additional allowed base paths
 * @returns {{ valid: boolean, reason?: string, normalizedPath?: string }}
 */
function validatePath(requestedPath, options = {}) {
  const { 
    allowAbsolute = false, 
    isWrite = false,
    additionalAllowed = []
  } = options;

  // Basic null/undefined check
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { valid: false, reason: 'Invalid path: must be a non-empty string' };
  }

  // Trim and normalize
  let normalizedPath = requestedPath.trim();

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return { 
        valid: false, 
        reason: `Dangerous pattern detected: ${pattern.toString()}` 
      };
    }
  }

  // Check for blocked system paths
  const lowerPath = normalizedPath.toLowerCase();
  for (const blocked of BLOCKED_PATHS) {
    if (lowerPath.includes(blocked.toLowerCase())) {
      return { 
        valid: false, 
        reason: `Access to system path "${blocked}" is not allowed` 
      };
    }
  }

  // Resolve to absolute path
  let resolvedPath;
  try {
    resolvedPath = path.resolve(normalizedPath);
  } catch (e) {
    return { valid: false, reason: `Invalid path format: ${e.message}` };
  }

  // Check if path is within allowed bases
  const allowedPaths = [
    ...ALLOWED_BASES.map(fn => {
      try { return fn(); } catch { return null; }
    }).filter(Boolean),
    ...additionalAllowed
  ];

  const isInAllowedBase = allowedPaths.some(base => {
    const normalizedBase = path.normalize(base);
    return resolvedPath.startsWith(normalizedBase);
  });

  if (!isInAllowedBase && !allowAbsolute) {
    return { 
      valid: false, 
      reason: 'Path is outside allowed directories' 
    };
  }

  // Additional checks for write operations
  if (isWrite) {
    const ext = path.extname(normalizedPath).toLowerCase();
    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      return { 
        valid: false, 
        reason: `Writing files with extension "${ext}" is not allowed` 
      };
    }
  }

  return { 
    valid: true, 
    normalizedPath: resolvedPath 
  };
}

/**
 * Validates a path and throws an error if invalid
 * @param {string} requestedPath - The path to validate
 * @param {object} options - Validation options
 * @throws {Error} If path is invalid
 */
function assertValidPath(requestedPath, options = {}) {
  const result = validatePath(requestedPath, options);
  if (!result.valid) {
    const error = new Error(`Path validation failed: ${result.reason}`);
    error.code = 'PATH_VALIDATION_ERROR';
    error.path = requestedPath;
    throw error;
  }
  return result.normalizedPath;
}

/**
 * Sanitizes a filename by removing dangerous characters
 * @param {string} filename - The filename to sanitize
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed';
  }

  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Remove invalid chars
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .slice(0, 255); // Limit length
}

/**
 * Creates a safe path within a base directory
 * @param {string} baseDir - The base directory
 * @param {string} relativePath - The relative path to append
 * @returns {string} Safe absolute path
 */
function createSafePath(baseDir, relativePath) {
  const sanitized = relativePath
    .split(/[\/\\]/)
    .map(sanitizeFilename)
    .filter(Boolean)
    .join(path.sep);

  const fullPath = path.join(baseDir, sanitized);
  const result = validatePath(fullPath, { allowAbsolute: true });

  if (!result.valid) {
    throw new Error(`Cannot create safe path: ${result.reason}`);
  }

  return result.normalizedPath;
}

/**
 * Checks if a path is within a specific directory
 * @param {string} targetPath - Path to check
 * @param {string} parentDir - Parent directory
 * @returns {boolean}
 */
function isWithinDirectory(targetPath, parentDir) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedParent = path.resolve(parentDir);
  return resolvedTarget.startsWith(resolvedParent + path.sep) || 
         resolvedTarget === resolvedParent;
}

module.exports = {
  validatePath,
  assertValidPath,
  sanitizeFilename,
  createSafePath,
  isWithinDirectory,
  ALLOWED_BASES,
  DANGEROUS_EXTENSIONS,
  BLOCKED_PATHS,
};






