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
const { spawn } = require('child_process');

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

const MAX_STORED_CHECKPOINTS = 40;
const CHECKPOINTS = new Map();
let EXECUTION_SEQUENCE = 0;
let CHECKPOINT_SEQUENCE = 0;

function normalizeForCompare(value) {
  const resolved = path.resolve(String(value || ''));
  const normalized = path.normalize(resolved).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSubPath(targetPath, basePath) {
  const target = normalizeForCompare(targetPath);
  const base = normalizeForCompare(basePath);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveWithinProject(projectRoot, relativePath = '') {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot is required');
  }

  const normalizedRootInput = path.resolve(String(projectRoot).trim());
  const projectBase = await fsPromises.realpath(normalizedRootInput).catch(() => normalizedRootInput);
  const targetPath = path.resolve(projectBase, String(relativePath || ''));

  if (!isSubPath(targetPath, projectBase)) {
    throw new Error('Path traversal detected - access denied');
  }

  return {
    projectBase,
    targetPath,
  };
}

function tokenizeCommand(command = '') {
  const tokens = String(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function isCommandAllowed(command) {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Block obvious shell chaining/expansion tokens.
  if (/[;&|`<>]/.test(trimmed) || /\$\(/.test(trimmed) || /[\r\n]/.test(trimmed)) {
    return false;
  }

  return ALLOWED_COMMANDS.some(pattern => pattern.test(trimmed));
}

function nextExecutionId() {
  EXECUTION_SEQUENCE += 1;
  return `exec_${Date.now()}_${EXECUTION_SEQUENCE}`;
}

function nextCheckpointId() {
  CHECKPOINT_SEQUENCE += 1;
  return `chk_${Date.now()}_${CHECKPOINT_SEQUENCE}`;
}

function scoreCommandRisk(command = '') {
  const trimmed = String(command || '').trim().toLowerCase();
  if (!trimmed) {
    return { level: 'high', blocked: true, mutating: false, reason: 'empty_command' };
  }

  if (/(?:^|\s)(del|rm|rmdir|rd)\s/.test(trimmed)) {
    return { level: 'high', blocked: true, mutating: true, reason: 'destructive_delete_command' };
  }

  if (/git\s+(reset|clean|checkout\s+--)/.test(trimmed)) {
    return { level: 'high', blocked: true, mutating: true, reason: 'destructive_git_command' };
  }

  if (/npm\s+install|yarn\s+add|pnpm\s+add|pnpm\s+install/.test(trimmed)) {
    return { level: 'medium', blocked: false, mutating: true, reason: 'dependency_mutation' };
  }

  if (/npm\s+run\s+format|prettier\s+--write|eslint\s+--fix/.test(trimmed)) {
    return { level: 'medium', blocked: false, mutating: true, reason: 'bulk_file_modification' };
  }

  if (/npm\s+run\s+build|npm\s+test|npx\s+tsc|npm\s+run\s+lint/.test(trimmed)) {
    return { level: 'low', blocked: false, mutating: false, reason: 'verification_or_build' };
  }

  return { level: 'low', blocked: false, mutating: false, reason: 'read_or_safe_command' };
}

function buildAuditMetadata({
  tool = 'unknown',
  operation = '',
  projectRoot = '',
  target = '',
  risk = null,
  blocked = false,
}) {
  return {
    tool,
    operation: String(operation || '').trim(),
    projectRoot: String(projectRoot || '').trim(),
    target: String(target || '').trim(),
    riskLevel: risk?.level || 'low',
    riskReason: risk?.reason || '',
    mutating: Boolean(risk?.mutating),
    blocked: Boolean(blocked),
    timestamp: new Date().toISOString(),
  };
}

function trimCheckpointStore() {
  if (CHECKPOINTS.size <= MAX_STORED_CHECKPOINTS) return;
  const entries = Array.from(CHECKPOINTS.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
  const overflow = entries.length - MAX_STORED_CHECKPOINTS;
  for (let i = 0; i < overflow; i += 1) {
    CHECKPOINTS.delete(entries[i].id);
  }
}

async function captureCheckpointForFiles(projectRoot, relativePaths = [], reason = 'mutation') {
  const uniquePaths = Array.from(new Set((Array.isArray(relativePaths) ? relativePaths : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  const files = [];

  for (const relPath of uniquePaths) {
    const { targetPath: fullPath } = await resolveWithinProject(projectRoot, relPath);
    let exists = false;
    let content = '';
    try {
      const stat = await fsPromises.stat(fullPath);
      exists = stat.isFile();
      if (exists) {
        content = await fsPromises.readFile(fullPath, 'utf-8');
      }
    } catch (_error) {
      exists = false;
      content = '';
    }
    files.push({
      path: relPath,
      fullPath,
      exists,
      content,
    });
  }

  const id = nextCheckpointId();
  CHECKPOINTS.set(id, {
    id,
    reason,
    projectRoot,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    files,
  });
  trimCheckpointStore();
  return id;
}

async function captureCheckpointForCommand(projectRoot, command = '') {
  const risk = scoreCommandRisk(command);
  if (!risk.mutating) return null;

  const commandLower = String(command || '').toLowerCase();
  const candidateFiles = ['package.json'];
  if (/npm\s+install|pnpm\s+install|yarn\s+add|pnpm\s+add/.test(commandLower)) {
    candidateFiles.push('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock');
  }

  return captureCheckpointForFiles(projectRoot, candidateFiles, `command:${commandLower.slice(0, 120)}`);
}

async function rollbackCheckpoint(checkpointId) {
  const checkpoint = CHECKPOINTS.get(String(checkpointId || '').trim());
  if (!checkpoint) {
    return { success: false, error: 'Checkpoint not found' };
  }

  for (const file of checkpoint.files || []) {
    if (file.exists) {
      await fsPromises.mkdir(path.dirname(file.fullPath), { recursive: true });
      await fsPromises.writeFile(file.fullPath, file.content, 'utf-8');
    } else {
      await fsPromises.unlink(file.fullPath).catch(() => {});
    }
  }

  return {
    success: true,
    checkpointId: checkpoint.id,
    restoredFiles: (checkpoint.files || []).map((item) => item.path),
  };
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read file contents with optional line range
 */
async function readFileWithRange(projectRoot, filePath, startLine, endLine) {
  const { targetPath: fullPath } = await resolveWithinProject(projectRoot, filePath);
  
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
  const { targetPath: fullPath } = await resolveWithinProject(projectRoot, dirPath);
  
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
  const { projectBase } = await resolveWithinProject(projectRoot, '.');
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
  
  await walkAndSearch(projectBase, '');
  
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
  const rawCommand = String(command || '').trim();

  // Validate command against allowlist
  if (!isCommandAllowed(rawCommand)) {
    return {
      success: false,
      error: `Command not allowed: "${rawCommand}". Only safe commands from the allowlist can be executed.`,
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

  try {
    const targetDir = cwd ? String(cwd) : '.';
    const { targetPath: workingDir } = await resolveWithinProject(projectRoot, targetDir);
    const [binary, ...args] = tokenizeCommand(rawCommand);

    if (!binary) {
      return {
        success: false,
        error: 'No command provided',
      };
    }

    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killedByTimeout = false;
      const maxDuration = Math.min(Math.max(Number(timeout) || 30000, 1000), 120000);

      const child = spawn(binary, args, {
        cwd: workingDir,
        shell: false,
        env: {
          ...process.env,
          CI: 'true',
          FORCE_COLOR: '0',
        },
      });

      const timeoutId = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGTERM');
      }, maxDuration);

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk || '');
        if (stdout.length > 50000) {
          stdout = stdout.slice(-50000);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
        if (stderr.length > 10000) {
          stderr = stderr.slice(-10000);
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          stdout,
          stderr: stderr || error.message,
          exitCode: 1,
          error: error.message,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const exitCode = Number.isInteger(code) ? code : 1;
        if (killedByTimeout) {
          resolve({
            success: false,
            stdout,
            stderr: stderr || `Command timed out after ${maxDuration}ms`,
            exitCode,
            error: 'Command timed out',
          });
          return;
        }

        resolve({
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          ...(exitCode !== 0 ? { error: `Command exited with code ${exitCode}` } : {}),
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: error.message,
      exitCode: 1,
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
  const { targetPath: fullPath, projectBase } = await resolveWithinProject(projectRoot, filePath);
  const normalizedOperation = normalizePatchOperation(operation);
  
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
      
      const { targetPath: newFullPath } = await resolveWithinProject(projectBase, newPath);
      
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

function setupCodeToolsHandlers(ipcMain, _mainWindow, _store) {
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
  ipcMain.handle('tool:runCommand', async (_, { projectRoot, command, cwd, timeout, autoRollbackOnFailure = true } = {}) => {
    const executionId = nextExecutionId();
    const risk = scoreCommandRisk(command);
    const audit = buildAuditMetadata({
      tool: 'run_command',
      operation: 'execute',
      projectRoot,
      target: command,
      risk,
      blocked: risk.blocked,
    });

    if (risk.blocked) {
      console.warn(`[code-tools] Blocked high-risk command (${risk.reason}): ${command}`);
      return errorResult(
        `Command blocked by risk policy (${risk.reason}).`,
        'command_blocked',
        false,
        { executionId, checkpointId: null, audit }
      );
    }

    let checkpointId = null;
    try {
      checkpointId = await captureCheckpointForCommand(projectRoot, command);
      const result = await runCommand(projectRoot, command, cwd, timeout);
      const payload = { ...result, executionId, checkpointId, audit };
      if (result?.success) return okResult(payload);

      let rollback = null;
      if (checkpointId && autoRollbackOnFailure) {
        rollback = await rollbackCheckpoint(checkpointId);
      }
      return errorResult(
        result?.error || result?.stderr || 'Command failed',
        'command_failed',
        false,
        {
          ...payload,
          rollback,
        }
      );
    } catch (error) {
      let rollback = null;
      if (checkpointId && autoRollbackOnFailure) {
        rollback = await rollbackCheckpoint(checkpointId).catch(() => null);
      }
      return errorResult(error, 'command_failed', false, {
        executionId,
        checkpointId,
        audit,
        rollback,
      });
    }
  });
  
  // Apply patch
  ipcMain.handle('tool:applyPatch', async (_, { projectRoot, patch, autoRollbackOnFailure = true } = {}) => {
    const executionId = nextExecutionId();
    const patchPath = String(patch?.path || '').trim();
    const patchOperation = normalizePatchOperation(patch?.operation, Boolean(patch?.newPath));
    const risk = {
      level: patchOperation === 'delete' ? 'medium' : 'low',
      reason: `patch_${patchOperation}`,
      mutating: true,
      blocked: false,
    };
    const audit = buildAuditMetadata({
      tool: 'apply_patch',
      operation: patchOperation,
      projectRoot,
      target: patchPath,
      risk,
      blocked: false,
    });

    let checkpointId = null;
    try {
      const checkpointPaths = [patch?.path];
      if (patch?.newPath) checkpointPaths.push(patch.newPath);
      checkpointId = await captureCheckpointForFiles(projectRoot, checkpointPaths, `patch:${patchOperation}`);
      const patchResult = await applyPatch(projectRoot, patch);
      return okResult({
        ...patchResult,
        executionId,
        checkpointId,
        audit,
      });
    } catch (error) {
      let rollback = null;
      if (checkpointId && autoRollbackOnFailure) {
        rollback = await rollbackCheckpoint(checkpointId).catch(() => null);
      }
      return errorResult(error, 'patch_failed', false, {
        executionId,
        checkpointId,
        audit,
        rollback,
      });
    }
  });

  ipcMain.handle('tool:createCheckpoint', async (_, { projectRoot, files = [], reason = 'manual_checkpoint' } = {}) => {
    try {
      const checkpointId = await captureCheckpointForFiles(projectRoot, files, reason);
      return okResult({
        checkpointId,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      return errorResult(error, 'checkpoint_create_failed');
    }
  });

  ipcMain.handle('tool:rollbackCheckpoint', async (_, { checkpointId } = {}) => {
    try {
      const result = await rollbackCheckpoint(checkpointId);
      if (!result?.success) {
        return errorResult(result?.error || 'Rollback failed', 'checkpoint_rollback_failed');
      }
      return okResult(result);
    } catch (error) {
      return errorResult(error, 'checkpoint_rollback_failed');
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
        'tool:createCheckpoint',
        'tool:rollbackCheckpoint',
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
  scoreCommandRisk,
  rollbackCheckpoint,
};
