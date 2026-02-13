/**
 * Code Tools IPC Handlers
 * 
 * Handles tool execution for AI-powered code assistance:
 * - File reading with line ranges
 * - Code search (grep-like)
 * - Directory listing
 * - Patch application
 * - Command execution (sandboxed)
 */

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================================
// Command Allowlist for Safety
// ============================================================================

const ALLOWED_COMMANDS = [
  // npm/yarn/pnpm commands
  /^npm (test|run (lint|build|typecheck|format|dev|start))(\s|$)/,
  /^npm install(\s|$)/,
  /^yarn (test|lint|build|typecheck|format|dev|start)(\s|$)/,
  /^pnpm (test|lint|build|typecheck|format|dev|start)(\s|$)/,
  
  // npx tools
  /^npx (eslint|prettier|tsc|jest|vitest|playwright)/,
  
  // git read-only commands
  /^git (status|diff|log|branch|show|blame)(\s|$)/,
  
  // file listing (read-only)
  /^ls(\s|$)/,
  /^dir(\s|$)/,
  /^tree(\s|$)/,
  
  // file reading (read-only)
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^type\s/, // Windows equivalent of cat
  
  // Search tools
  /^grep\s/,
  /^rg\s/,  // ripgrep
  /^find\s/,
  /^findstr\s/, // Windows
  
  // Node/Python version checks
  /^node\s+--version$/,
  /^python\s+--version$/,
  /^python3\s+--version$/,
];

function isCommandAllowed(command) {
  const trimmed = command.trim();
  return ALLOWED_COMMANDS.some(pattern => pattern.test(trimmed));
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read file contents with optional line range
 */
async function readFileWithRange(projectRoot, filePath, startLine, endLine) {
  const fullPath = path.join(projectRoot, filePath);
  
  // Validate path is within project
  const normalizedPath = path.normalize(fullPath);
  const normalizedRoot = path.normalize(projectRoot);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error('Path traversal detected - access denied');
  }
  
  const content = await fsPromises.readFile(fullPath, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  
  if (startLine !== undefined && startLine !== null) {
    const start = Math.max(1, startLine) - 1; // Convert to 0-indexed
    const end = endLine !== undefined ? Math.min(endLine, totalLines) : Math.min(start + 100, totalLines);
    
    return {
      path: filePath,
      content: lines.slice(start, end).join('\n'),
      startLine: start + 1,
      endLine: end,
      totalLines,
      truncated: end < totalLines
    };
  }
  
  return {
    path: filePath,
    content,
    totalLines,
    truncated: false
  };
}

/**
 * List directory contents
 */
async function listDirectory(projectRoot, dirPath = '', recursive = false, maxDepth = 3) {
  const fullPath = path.join(projectRoot, dirPath);
  
  // Validate path is within project
  const normalizedPath = path.normalize(fullPath);
  const normalizedRoot = path.normalize(projectRoot);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error('Path traversal detected - access denied');
  }
  
  const results = [];
  
  async function walkDir(currentPath, relPath, depth) {
    if (depth > maxDepth) return;
    
    try {
      const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip node_modules, .git, etc.
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
          continue;
        }
        
        const entryRelPath = relPath ? path.join(relPath, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            path: entryRelPath.replace(/\\/g, '/'),
            type: 'directory'
          });
          
          if (recursive) {
            await walkDir(path.join(currentPath, entry.name), entryRelPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const stats = await fsPromises.stat(path.join(currentPath, entry.name));
          results.push({
            name: entry.name,
            path: entryRelPath.replace(/\\/g, '/'),
            type: 'file',
            size: stats.size,
            extension: path.extname(entry.name).slice(1) || null
          });
        }
      }
    } catch (error) {
      console.error(`[code-tools] Error reading directory ${currentPath}:`, error.message);
    }
  }
  
  await walkDir(fullPath, dirPath, 0);
  
  return {
    path: dirPath || '.',
    entries: results,
    count: results.length
  };
}

// ============================================================================
// Code Search
// ============================================================================

/**
 * Search for patterns in code files (grep-like)
 */
async function searchCode(projectRoot, pattern, fileGlob, maxResults = 20, caseSensitive = false) {
  const results = [];
  const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  
  // File extensions to search
  const searchableExtensions = [
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.json', '.md', '.txt',
    '.css', '.scss', '.less',
    '.html', '.vue', '.svelte',
    '.py', '.rb', '.go', '.rs',
    '.yaml', '.yml', '.toml',
    '.sh', '.bash', '.zsh',
    '.sql', '.graphql'
  ];
  
  // Parse file glob if provided
  let globPattern = null;
  if (fileGlob) {
    // Simple glob support: *.js, **/*.tsx, src/**/*.js
    globPattern = new RegExp(
      fileGlob
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*')
    );
  }
  
  async function searchInFile(filePath, relPath) {
    if (results.length >= maxResults) return;
    
    // Check glob pattern
    if (globPattern && !globPattern.test(relPath)) return;
    
    // Check extension
    const ext = path.extname(filePath).toLowerCase();
    if (!searchableExtensions.includes(ext)) return;
    
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const line = lines[i];
        // Always reset lastIndex before test() to avoid g-flag alternation bug
        regex.lastIndex = 0;
        if (regex.test(line)) {
          // Get context (2 lines before and after)
          const contextStart = Math.max(0, i - 2);
          const contextEnd = Math.min(lines.length, i + 3);
          
          results.push({
            path: relPath.replace(/\\/g, '/'),
            line: i + 1,
            content: line.trim(),
            context: lines.slice(contextStart, contextEnd).map((l, idx) => ({
              line: contextStart + idx + 1,
              content: l,
              isMatch: contextStart + idx === i
            }))
          });
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }
  
  async function walkAndSearch(currentPath, relPath) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        // Skip common non-source directories
        if (entry.name === 'node_modules' || entry.name === '.git' || 
            entry.name === 'dist' || entry.name === 'build' ||
            entry.name === 'coverage' || entry.name === '.next') {
          continue;
        }
        
        const entryPath = path.join(currentPath, entry.name);
        const entryRelPath = relPath ? path.join(relPath, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
          await walkAndSearch(entryPath, entryRelPath);
        } else if (entry.isFile()) {
          await searchInFile(entryPath, entryRelPath);
        }
      }
    } catch (error) {
      console.error(`[code-tools] Error searching directory ${currentPath}:`, error.message);
    }
  }
  
  await walkAndSearch(projectRoot, '');
  
  return {
    pattern,
    results,
    totalMatches: results.length,
    truncated: results.length >= maxResults
  };
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Run a command in a sandboxed environment
 */
async function runCommand(projectRoot, command, cwd, timeout = 30000) {
  // Validate command against allowlist
  if (!isCommandAllowed(command)) {
    return {
      success: false,
      error: `Command not allowed: "${command}". Only safe commands from the allowlist can be executed.`,
      allowedPatterns: [
        'npm test/run/install',
        'yarn/pnpm commands',
        'npx eslint/prettier/tsc/jest',
        'git status/diff/log',
        'ls/dir/tree',
        'cat/head/tail',
        'grep/rg/find'
      ]
    };
  }
  
  const workingDir = cwd ? path.join(projectRoot, cwd) : projectRoot;
  
  // Validate working directory is within project
  const normalizedCwd = path.normalize(workingDir);
  const normalizedRoot = path.normalize(projectRoot);
  if (!normalizedCwd.startsWith(normalizedRoot)) {
    return {
      success: false,
      error: 'Working directory must be within project root'
    };
  }
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB buffer
      env: {
        ...process.env,
        // Disable interactive prompts
        CI: 'true',
        FORCE_COLOR: '0'
      }
    });
    
    return {
      success: true,
      stdout: stdout.slice(0, 50000), // Limit output size
      stderr: stderr.slice(0, 10000),
      exitCode: 0
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout?.slice(0, 50000) || '',
      stderr: error.stderr?.slice(0, 10000) || error.message,
      exitCode: error.code || 1,
      error: error.message
    };
  }
}

// ============================================================================
// Patch Operations
// ============================================================================

function normalizePatchOperation(operation) {
  const value = String(operation || '').trim().toLowerCase();
  if (!value) return 'update';

  if (['create', 'new', 'mk', 'touch', 'create_file'].includes(value)) {
    return 'create';
  }
  if (['update', 'edit', 'modify', 'change', 'replace', 'patch', 'overwrite', 'update_file'].includes(value)) {
    return 'update';
  }
  if (['delete', 'remove', 'rm', 'del', 'delete_file'].includes(value)) {
    return 'delete';
  }
  if (['rename', 'move', 'mv', 'rename_file', 'move_file'].includes(value)) {
    return 'rename';
  }
  // "add" is ambiguous in model outputs; treat as insert/append-or-create.
  if (['add', 'insert', 'append'].includes(value)) {
    return 'add';
  }
  return value;
}

/**
 * Apply a structured patch to a file
 */
async function applyPatch(projectRoot, patch) {
  const { path: filePath, operation, startLine, endLine, oldContent, newContent, newPath } = patch;
  const fullPath = path.join(projectRoot, filePath);
  const normalizedOperation = normalizePatchOperation(operation);
  
  // Validate path is within project
  const normalizedPath = path.normalize(fullPath);
  const normalizedRoot = path.normalize(projectRoot);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error('Path traversal detected - access denied');
  }
  
  switch (normalizedOperation) {
    case 'create': {
      // Ensure directory exists
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Check if file already exists
      if (fs.existsSync(fullPath)) {
        throw new Error(`File already exists: ${filePath}`);
      }
      
      await fsPromises.writeFile(fullPath, newContent, 'utf-8');
      return { success: true, operation: 'created', path: filePath };
    }

    case 'add': {
      // Insert into existing file or create a new one if the target does not exist.
      const exists = fs.existsSync(fullPath);
      if (!exists) {
        await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
        await fsPromises.writeFile(fullPath, newContent || '', 'utf-8');
        return { success: true, operation: 'created', path: filePath };
      }

      const content = await fsPromises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const insertion = String(newContent || '');

      let insertIndex = lines.length;
      if (Number.isInteger(startLine) && startLine > 0) {
        insertIndex = Math.min(startLine - 1, lines.length);
      }

      const insertionLines = insertion.split('\n');
      const resultLines = [
        ...lines.slice(0, insertIndex),
        ...insertionLines,
        ...lines.slice(insertIndex),
      ];

      await fsPromises.writeFile(fullPath, resultLines.join('\n'), 'utf-8');
      return {
        success: true,
        operation: 'updated',
        path: filePath,
        linesChanged: {
          removed: 0,
          added: insertionLines.length
        }
      };
    }
    
    case 'update': {
      const content = await fsPromises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      // Validate line range
      if (startLine < 1 || startLine > lines.length) {
        throw new Error(`Invalid start line: ${startLine}`);
      }
      
      // If oldContent provided, verify it matches
      if (oldContent) {
        const actualOld = lines.slice(startLine - 1, endLine || startLine).join('\n');
        if (actualOld.trim() !== oldContent.trim()) {
          throw new Error('Content mismatch - file may have changed. Please re-read the file.');
        }
      }
      
      // Create backup
      const backupPath = `${fullPath}.bak-${Date.now()}`;
      await fsPromises.copyFile(fullPath, backupPath);
      
      // Apply update
      const newLines = newContent.split('\n');
      const resultLines = [
        ...lines.slice(0, startLine - 1),
        ...newLines,
        ...lines.slice(endLine || startLine)
      ];
      
      await fsPromises.writeFile(fullPath, resultLines.join('\n'), 'utf-8');
      
      return {
        success: true,
        operation: 'updated',
        path: filePath,
        backupPath: path.basename(backupPath),
        linesChanged: {
          removed: (endLine || startLine) - startLine + 1,
          added: newLines.length
        }
      };
    }
    
    case 'delete': {
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }
      
      // Create backup before deleting
      const backupPath = `${fullPath}.deleted-${Date.now()}`;
      await fsPromises.copyFile(fullPath, backupPath);
      await fsPromises.unlink(fullPath);
      
      return {
        success: true,
        operation: 'deleted',
        path: filePath,
        backupPath: path.basename(backupPath)
      };
    }
    
    case 'rename': {
      if (!newPath) {
        throw new Error('newPath is required for rename operation');
      }
      
      const newFullPath = path.join(projectRoot, newPath);
      const normalizedNewPath = path.normalize(newFullPath);
      if (!normalizedNewPath.startsWith(normalizedRoot)) {
        throw new Error('Path traversal detected - access denied');
      }
      
      // Ensure target directory exists
      await fsPromises.mkdir(path.dirname(newFullPath), { recursive: true });
      
      // Rename (move) the file
      await fsPromises.rename(fullPath, newFullPath);
      
      return {
        success: true,
        operation: 'renamed',
        oldPath: filePath,
        newPath: newPath
      };
    }
    
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Generate a unified diff between old and new content
 */
function generateDiff(oldContent, newContent, filePath) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  
  const diff = [];
  let oldIdx = 0;
  let newIdx = 0;
  
  // Simple line-by-line diff (for display purposes)
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];
    
    if (oldLine === newLine) {
      diff.push({ type: 'context', line: oldIdx + 1, content: oldLine });
      oldIdx++;
      newIdx++;
    } else if (oldIdx < oldLines.length && (newIdx >= newLines.length || oldLine !== newLines[newIdx])) {
      diff.push({ type: 'removed', line: oldIdx + 1, content: oldLine });
      oldIdx++;
    } else {
      diff.push({ type: 'added', line: newIdx + 1, content: newLine });
      newIdx++;
    }
  }
  
  return {
    filePath,
    hunks: diff,
    stats: {
      additions: diff.filter(d => d.type === 'added').length,
      deletions: diff.filter(d => d.type === 'removed').length
    }
  };
}

// ============================================================================
// IPC Handler Setup
// ============================================================================

function okResult(payload = {}) {
  return {
    ok: true,
    success: true,
    data: payload,
    ...(payload && typeof payload === 'object' ? payload : { value: payload }),
  };
}

function errorResult(error, code = 'tool_error', retryable = false, details = null) {
  const message = typeof error === 'string' ? error : (error?.message || 'Unknown tool error');
  return {
    ok: false,
    success: false,
    error: message,
    code,
    retryable,
    details,
  };
}

function setupCodeToolsHandlers(ipcMain, mainWindow, store) {
  console.log('[IPC] Setting up code tools handlers...');
  
  // Read file with optional line range
  ipcMain.handle('tool:readFile', async (_, { projectRoot, path: filePath, startLine, endLine }) => {
    try {
      return okResult(await readFileWithRange(projectRoot, filePath, startLine, endLine));
    } catch (error) {
      return errorResult(error, 'read_failed');
    }
  });
  
  // List directory contents
  ipcMain.handle('tool:listDirectory', async (_, { projectRoot, path: dirPath, recursive, maxDepth }) => {
    try {
      return okResult(await listDirectory(projectRoot, dirPath, recursive, maxDepth));
    } catch (error) {
      return errorResult(error, 'list_failed');
    }
  });
  
  // Search code
  ipcMain.handle('tool:searchCode', async (_, { projectRoot, pattern, fileGlob, maxResults, caseSensitive }) => {
    try {
      return okResult(await searchCode(projectRoot, pattern, fileGlob, maxResults, caseSensitive));
    } catch (error) {
      return errorResult(error, 'search_failed');
    }
  });
  
  // Run command (sandboxed)
  ipcMain.handle('tool:runCommand', async (_, { projectRoot, command, cwd, timeout }) => {
    try {
      const result = await runCommand(projectRoot, command, cwd, timeout);
      if (result?.success) return okResult(result);
      return errorResult(result?.error || result?.stderr || 'Command failed', 'command_failed', false, result);
    } catch (error) {
      return errorResult(error, 'command_failed');
    }
  });
  
  // Apply patch
  ipcMain.handle('tool:applyPatch', async (_, { projectRoot, patch }) => {
    try {
      return okResult(await applyPatch(projectRoot, patch));
    } catch (error) {
      return errorResult(error, 'patch_failed');
    }
  });
  
  // Generate diff preview
  ipcMain.handle('tool:generateDiff', async (_, { oldContent, newContent, filePath }) => {
    try {
      return okResult(generateDiff(oldContent, newContent, filePath));
    } catch (error) {
      return errorResult(error, 'diff_failed');
    }
  });
  
  // Check if command is allowed
  ipcMain.handle('tool:isCommandAllowed', async (_, { command }) => {
    const payload = { allowed: isCommandAllowed(command) };
    return okResult(payload);
  });

  // Health/registration check for startup assertions and agent gating
  ipcMain.handle('tool:health', async () => {
    return okResult({
      handlersReady: true,
      channels: [
        'tool:readFile',
        'tool:listDirectory',
        'tool:searchCode',
        'tool:runCommand',
        'tool:applyPatch',
        'tool:generateDiff',
        'tool:isCommandAllowed',
      ],
    });
  });
  
  console.log('[IPC] Code tools handlers setup complete');
  return { success: true };
}

module.exports = {
  setupCodeToolsHandlers,
  // Export functions for direct use if needed
  readFileWithRange,
  listDirectory,
  searchCode,
  runCommand,
  applyPatch,
  generateDiff,
  isCommandAllowed,
};
