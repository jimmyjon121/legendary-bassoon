/**
 * IPC Handlers - Main Entry Point
 * 
 * NOTE: This file is being refactored into modular domain handlers.
 * New handlers should be added to the appropriate file in electron/ipc/:
 * 
 * - system-handlers.js: Window, hardware, power, settings
 * - storage-handlers.js: Database, backup, export
 * - ai-handlers.js: LLM, RAG, whisper
 * - model-handlers.js: Downloads, conversion, library
 * - image-handlers.js: ComfyUI, image generation
 * 
 * This file is preserved for backwards compatibility and will be
 * gradually migrated to the modular architecture.
 */

const { dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const { setupWebSearchHandlers } = require('./ipc/web-search-handlers');
const { setupCodeToolsHandlers } = require('./ipc/code-tools-handlers');
const { setupResearchHandlers } = require('./ipc/research-handlers');
const { validatePath } = require('./utils/pathValidator');

// =============================================================================
// LAZY SERVICE LOADING - Services are loaded on-demand for faster startup
// =============================================================================
const { getService, startIdleCleanup } = require('./services/lazy-loader');

// Core services that need direct require (used at module level)
const { getPowerMode } = require('./services/power-mode');

// Optional model-inspection / model-experience services (graceful fallback)
let inspectModelFn = null;
let autoTuneModelFn = null;
let getModelExperienceManagerFn = null;

try {
  inspectModelFn = require('./services/model-inspector').inspectModel;
} catch (error) {
  console.warn('[IPC] Model inspector unavailable:', error.message);
}

try {
  autoTuneModelFn = require('./services/auto-tuner').autoTuneModel;
} catch (error) {
  console.warn('[IPC] Auto-tuner unavailable:', error.message);
}

try {
  getModelExperienceManagerFn =
    require('./services/model-experience-manager').getModelExperienceManager;
} catch (error) {
  console.warn('[IPC] Model Experience Manager unavailable:', error.message);
}

// =============================================================================
// LAZY SERVICE GETTERS - Only load when first accessed
// =============================================================================

// Hardware & System
const _getHardwareDetection = () => getService('hardware-detection');
const getNpuBridge = () => getService('npu-bridge')?.getNpuBridge?.() || null;
const npuSetupService = { 
  get runOpenVinoSetup() { return getService('npu-setup')?.runOpenVinoSetup; },
  get checkDrivers() { return getService('npu-setup')?.checkDrivers; },
  get installDrivers() { return getService('npu-setup')?.installDrivers; },
  get getInstallationProgress() { return getService('npu-setup')?.getInstallationProgress; },
};

// AI Orchestration
const getOrchestrator = () => getService('inference-orchestrator')?.getOrchestrator?.() || null;
const getModelManager = () => getService('model-manager')?.getModelManager?.() || null;
// These are factory functions that need arguments
const getOllamaHelperFactory = () => getService('ollama-helper')?.getOllamaHelper || null;
const getImageBackendHelperFactory = () => getService('image-backend-helper')?.getImageBackendHelper || null;

// Export/Import
const exportService = {
  get exportConversation() { return getService('export-service')?.exportConversation; },
  get getExportFormats() { return getService('export-service')?.getExportFormats; },
};
const backupService = {
  get createBackup() { return getService('backup-service')?.createBackup; },
  get listBackups() { return getService('backup-service')?.listBackups; },
  get restoreBackup() { return getService('backup-service')?.restoreBackup; },
  get deleteBackup() { return getService('backup-service')?.deleteBackup; },
  get exportToZip() { return getService('backup-service')?.exportToZip; },
  get importFromZip() { return getService('backup-service')?.importFromZip; },
};
const modelDownloader = {
  // New downloader API (used throughout this file)
  get startOllamaDownload() { return getService('model-downloader')?.startOllamaDownload; },
  get startHuggingFaceDownload() { return getService('model-downloader')?.startHuggingFaceDownload; },
  get startCustomDownload() { return getService('model-downloader')?.startCustomDownload; },
  get fetchHuggingFaceRepo() { return getService('model-downloader')?.fetchHuggingFaceRepo; },
  get cancelDownload() { return getService('model-downloader')?.cancelDownload; },
  get getDownloads() { return getService('model-downloader')?.getDownloads; },

  // Legacy aliases (kept for compatibility with older callers)
  get downloadModel() { return getService('model-downloader')?.downloadModel; },
  get getProgress() { return getService('model-downloader')?.getProgress; },
};
const createModelConverter = () => getService('model-converter')?.createModelConverter?.() || null;

// AI Services
const whisperService = {
  get transcribe() { return getService('whisper-service')?.transcribe; },
};
const ragService = {
  get ingestDocument() { return getService('rag-service')?.ingestDocument; },
  get searchDocuments() { return getService('rag-service')?.searchDocuments; },
  get deleteDocument() { return getService('rag-service')?.deleteDocument; },
  get listDocuments() { return getService('rag-service')?.listDocuments; },
};

// Image Generation Services
const getImageService = () => getService('image-service')?.getImageService?.() || null;
const getComfyUIManager = () => getService('comfyui-manager')?.getComfyUIManager?.() || null;
const getImageBackendAuto = () => getService('image-backend-auto')?.getImageBackendAuto?.() || null;
const updaterService = {
  get checkForUpdates() { return getService('updater-service')?.checkForUpdates; },
  get downloadUpdate() { return getService('updater-service')?.downloadUpdate; },
  get installUpdate() { return getService('updater-service')?.installUpdate; },
};
const scanProject = (...args) => getService('project-scanner')?.scanProject?.(...args);

// Ledger - expose all methods used by setupLedgerHandlers
const ledgerService = {
  get initLedgerService() { return getService('ledger-service')?.initLedgerService; },
  get getSessionId() { return getService('ledger-service')?.getSessionId; },
  get recordEvent() { return getService('ledger-service')?.recordEvent; },
  get recordMessage() { return getService('ledger-service')?.recordMessage; },
  get recordWorkspaceSwitch() { return getService('ledger-service')?.recordWorkspaceSwitch; },
  get recordModelSwitch() { return getService('ledger-service')?.recordModelSwitch; },
  get recordGenerationStart() { return getService('ledger-service')?.recordGenerationStart; },
  get recordGenerationComplete() { return getService('ledger-service')?.recordGenerationComplete; },
  get recordFileOpen() { return getService('ledger-service')?.recordFileOpen; },
  get recordTypingBurst() { return getService('ledger-service')?.recordTypingBurst; },
  get recordUserAction() { return getService('ledger-service')?.recordUserAction; },
  get addEvidence() { return getService('ledger-service')?.addEvidence; },
  get getEvidence() { return getService('ledger-service')?.getEvidence; },
  get createRun() { return getService('ledger-service')?.createRun; },
  get updateRun() { return getService('ledger-service')?.updateRun; },
  get addRunStep() { return getService('ledger-service')?.addRunStep; },
  get getRunSteps() { return getService('ledger-service')?.getRunSteps; },
  get createDecisionFork() { return getService('ledger-service')?.createDecisionFork; },
  get listEvents() { return getService('ledger-service')?.listEvents; },
  get getSessionEvents() { return getService('ledger-service')?.getSessionEvents; },
  get getFrictionSignals() { return getService('ledger-service')?.getFrictionSignals; },
  get getStats() { return getService('ledger-service')?.getStats; },
  get verifyChain() { return getService('ledger-service')?.verifyChain; },
  get getSessionTimeline() { return getService('ledger-service')?.getSessionTimeline; },
  get clearEvents() { return getService('ledger-service')?.clearEvents; },
  get clearFrictionSignals() { return getService('ledger-service')?.clearFrictionSignals; },
  get clearAll() { return getService('ledger-service')?.clearAll; },
  get save() { return getService('ledger-service')?.save; },
};

// Soul Engine
const stateInference = {
  get inferState() { return getService('state-inference')?.inferState; },
};

// Intent Compiler
const intentSchema = {
  get createPlan() { return getService('intent-schema')?.createPlan; },
  get validatePlan() { return getService('intent-schema')?.validatePlan; },
};
const intentExecutor = {
  get executePlan() { return getService('intent-executor')?.executePlan; },
};

// LMA (Local Model Adaptation)
const llamaBridge = {
  get initialize() { return getService('llama-bridge')?.initialize; },
  get isAvailable() { return getService('llama-bridge')?.isAvailable; },
  get listModels() { return getService('llama-bridge')?.listModels; },
  get listAdapters() { return getService('llama-bridge')?.listAdapters; },
  get loadAdapter() { return getService('llama-bridge')?.loadAdapter; },
  get unloadAdapter() { return getService('llama-bridge')?.unloadAdapter; },
  get getLoadedAdapters() { return getService('llama-bridge')?.getLoadedAdapters; },
  get trainAdapter() { return getService('llama-bridge')?.trainAdapter; },
  get getSystemInfo() { return getService('llama-bridge')?.getSystemInfo; },
};
const datasetBuilder = {
  get buildDataset() { return getService('dataset-builder')?.buildDataset; },
  get buildWorkspaceDatasets() { return getService('dataset-builder')?.buildWorkspaceDatasets; },
  get estimateTrainingTime() { return getService('dataset-builder')?.estimateTrainingTime; },
  get buildFromFriction() { return getService('dataset-builder')?.buildFromFriction; },
};
const trainingScheduler = {
  get initialize() { return getService('training-scheduler')?.initialize; },
  get enable() { return getService('training-scheduler')?.enable; },
  get disable() { return getService('training-scheduler')?.disable; },
  get triggerTraining() { return getService('training-scheduler')?.triggerTraining; },
  get cancelTraining() { return getService('training-scheduler')?.cancelTraining; },
  get getStatus() { return getService('training-scheduler')?.getStatus; },
  get getHistory() { return getService('training-scheduler')?.getHistory; },
};
const ollamaAdapters = {
  get getOllamaModels() { return getService('ollama-adapters')?.getOllamaModels; },
  get createPersonalizedModel() { return getService('ollama-adapters')?.createPersonalizedModel; },
  get extractInsightsFromFriction() { return getService('ollama-adapters')?.extractInsightsFromFriction; },
  get deletePersonalizedModel() { return getService('ollama-adapters')?.deletePersonalizedModel; },
  get listPersonalizedModels() { return getService('ollama-adapters')?.listPersonalizedModels; },
  get getAdapterStatus() { return getService('ollama-adapters')?.getAdapterStatus; },
};

// Backwards compatibility alias - directly returns the service for method access
function getHardwareDetectionService() {
  return getService('hardware-detection');
}
const hardwareDetection = new Proxy({}, {
  get(_, prop) {
    const service = getHardwareDetectionService();
    return service ? service[prop] : undefined;
  }
});

// Database setup using sql.js (pure JS, no native compilation)
let db = null;
let dbPath = null;
let SQL = null;
const agentRunProgressState = {
  snapshot: null,
  updatedAt: 0,
};

const TERMINAL_ALLOWED_COMMANDS = [
  /^npm (test|run (lint|build|typecheck|format|dev|start)|install)(\s|$)/i,
  /^yarn (test|lint|build|typecheck|format|dev|start|install)(\s|$)/i,
  /^pnpm (test|lint|build|typecheck|format|dev|start|install)(\s|$)/i,
  /^npx (eslint|prettier|tsc|jest|vitest|playwright)(\s|$)/i,
  /^git (status|diff|log|branch|show|blame|add|commit)(\s|$)/i,
  /^node(\s|$)/i,
  /^python(\s|$)/i,
  /^python3(\s|$)/i,
  /^powershell\s+-ExecutionPolicy\s+Bypass\s+-File\s+scripts[\\/]+setup-openvino\.ps1$/i,
];

function tokenizeCommand(command = '') {
  const tokens = String(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function isTerminalCommandAllowed(command = '') {
  const trimmed = String(command || '').trim();
  if (!trimmed) return false;
  if (/[;&|`<>]/.test(trimmed) || /\$\(/.test(trimmed) || /[\r\n]/.test(trimmed)) {
    return false;
  }
  return TERMINAL_ALLOWED_COMMANDS.some((pattern) => pattern.test(trimmed));
}

function resolveTerminalCwd(requestedCwd) {
  if (!requestedCwd || typeof requestedCwd !== 'string') {
    return process.cwd();
  }

  const validation = validatePath(requestedCwd, { allowAbsolute: true });
  if (!validation.valid) {
    throw new Error(`Invalid working directory: ${validation.reason}`);
  }

  const resolved = path.resolve(validation.normalizedPath || requestedCwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Working directory does not exist');
  }
  return resolved;
}

function executeTerminalCommand(payload = {}) {
  const normalizedPayload = typeof payload === 'string'
    ? { command: payload }
    : (payload && typeof payload === 'object' ? payload : {});

  const command = String(normalizedPayload.command || '').trim();
  const timeoutMs = Math.min(Math.max(Number(normalizedPayload.timeout) || 20000, 1000), 120000);

  if (!command) {
    return Promise.resolve({ success: false, code: 1, stdout: '', stderr: 'No command provided' });
  }

  if (!isTerminalCommandAllowed(command)) {
    return Promise.resolve({
      success: false,
      code: 1,
      stdout: '',
      stderr: 'Command blocked by safety policy',
    });
  }

  let cwd;
  try {
    cwd = resolveTerminalCwd(normalizedPayload.cwd);
  } catch (error) {
    return Promise.resolve({ success: false, code: 1, stdout: '', stderr: error.message });
  }

  const [binary, ...args] = tokenizeCommand(command);
  if (!binary) {
    return Promise.resolve({ success: false, code: 1, stdout: '', stderr: 'No executable provided' });
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(binary, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        CI: 'true',
        FORCE_COLOR: '0',
      },
      windowsHide: true,
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (stdout.length > 50000) stdout = stdout.slice(-50000);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        code: 1,
        stdout,
        stderr: stderr || error.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (timedOut) {
        resolve({
          success: false,
          code: typeof code === 'number' ? code : 1,
          stdout,
          stderr: stderr || `Command timed out after ${timeoutMs}ms`,
        });
        return;
      }

      resolve({
        success: code === 0,
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function resolveProjectRoot(rootPath) {
  if (!rootPath || typeof rootPath !== 'string') {
    throw new Error('Root path is required');
  }
  const resolved = path.resolve(String(rootPath).trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Project root not found');
  }
  return resolved;
}

function parseGitStatusOutput(stdout = '') {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const status = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: [],
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3).trim();
      const branchMatch = head.match(/^([^.\s]+)(?:\.\.\.[^\s]+)?/);
      if (branchMatch?.[1]) {
        status.branch = branchMatch[1];
      }
      const aheadMatch = head.match(/ahead (\d+)/);
      const behindMatch = head.match(/behind (\d+)/);
      status.ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
      status.behind = behindMatch ? Number(behindMatch[1]) : 0;
      continue;
    }

    const code = line.slice(0, 2).trim() || '?';
    const relPath = line.slice(3).trim();
    if (!relPath) continue;
    status.files.push({
      status: code,
      path: relPath,
    });
  }

  return status;
}

async function initDatabase(userDataPath) {
  // Load sql.js
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  
  dbPath = path.join(userDataPath, 'devforge.db');
  
  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('Loaded existing database from', dbPath);
    } else {
      db = new SQL.Database();
      console.log('Created new database');
    }
  } catch (error) {
    console.error('Error loading database, creating new one:', error);
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      title TEXT,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      encrypted INTEGER DEFAULT 0
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens_used INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      settings TEXT,
      file_path TEXT,
      workspace TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT,
      appearance TEXT,
      workspace TEXT DEFAULT 'nsfw',
      avatar_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
    
  db.run(`
    CREATE TABLE IF NOT EXISTS nsfw_auth (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      variables TEXT,
      workspace TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS model_presets (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      top_p REAL DEFAULT 0.9,
      top_k INTEGER DEFAULT 40,
      context_length INTEGER,
      system_prompt TEXT,
      workspace TEXT,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add created_at to model_presets if it was created without it.
  // Some SQLite builds reject ADD COLUMN with non-constant defaults, so keep this resilient.
  try {
    const presetInfo = db.exec('PRAGMA table_info(model_presets)');
    const hasCreatedAt = Array.isArray(presetInfo?.[0]?.values)
      ? presetInfo[0].values.some((row) => row?.[1] === 'created_at')
      : false;

    if (!hasCreatedAt) {
      try {
        db.run(`ALTER TABLE model_presets ADD COLUMN created_at DATETIME`);
      } catch (migrationErr) {
        console.warn('[DB] model_presets.created_at migration skipped:', migrationErr.message);
      }
    }
  } catch (migrationErr) {
    console.warn('[DB] Failed to inspect model_presets schema:', migrationErr.message);
  }

  try {
    db.run(`UPDATE model_presets SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);
  } catch (_backfillErr) {
    // Column may still not exist - handled by query fallback in presets:getForModel
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_branch_id TEXT,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT,
      content_hash TEXT,
      chunk_count INTEGER,
      workspace TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      chunk_index INTEGER,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  // Research system tables (project-based multi-agent research)
  db.run(`
    CREATE TABLE IF NOT EXISTS research_projects (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      permanent_instructions TEXT,
      schema_json TEXT NOT NULL DEFAULT '[]',
      source_policy_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_project_conversations (
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, conversation_id),
      FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_project_documents (
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, document_id),
      FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      objective TEXT NOT NULL,
      run_instructions TEXT,
      worker_count INTEGER DEFAULT 4,
      stats_json TEXT NOT NULL DEFAULT '{}',
      convergence_count INTEGER DEFAULT 0,
      prompt_snapshot_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE
    )
  `);

  try {
    db.run(`ALTER TABLE research_runs ADD COLUMN prompt_snapshot_json TEXT`);
  } catch (_error) {
    // Column already exists.
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS research_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      worker_id TEXT,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at DATETIME,
      ended_at DATETIME,
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      record_json TEXT NOT NULL,
      verified_official_url TEXT,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_evidence (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_domain TEXT,
      source_title TEXT,
      excerpt_text TEXT,
      is_official INTEGER NOT NULL DEFAULT 0,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES research_records(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      queue_json TEXT NOT NULL DEFAULT '{}',
      state_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
    )
  `);

  // Backwards‑compatible schema migrations for branch support
  try {
    db.run(`ALTER TABLE messages ADD COLUMN branch_id TEXT`);
  } catch (error) {
    // Ignore if column already exists
  }
  try {
    db.run(`ALTER TABLE messages ADD COLUMN parent_message_id TEXT`);
  } catch (error) {
    // Ignore if column already exists
  }
  
  // Organization system migrations (folders, tags, pinned, starred)
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN starred INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN tags TEXT DEFAULT '[]'`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN folder_id TEXT`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN message_count INTEGER DEFAULT 0`);
  } catch (error) {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE conversations ADD COLUMN preview TEXT`);
  } catch (error) {
    // Column already exists
  }
  
  // Folders table for conversation organization (workspace-scoped)
  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'Folder',
      workspace TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_images_workspace ON generated_images(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_folder ON conversations(folder_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_starred ON conversations(starred)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_pinned ON conversations(pinned)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_research_record_project_key ON research_records(project_id, canonical_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_runs_project ON research_runs(project_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_tasks_run ON research_tasks(run_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_evidence_record ON research_evidence(record_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_project_conv_project ON research_project_conversations(project_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_project_doc_project ON research_project_documents(project_id)`);
  
  // Initialize Memory Engine for long conversation support
  try {
    const { getMemoryEngine } = require('./services/memory-engine');
    const memoryEngine = getMemoryEngine();
    memoryEngine.init(db);
    console.log('Memory Engine initialized');
  } catch (error) {
    console.error('Failed to initialize Memory Engine:', error);
  }
  
  // Initialize Soul Engine for personality persistence
  try {
    const { getSoulEngine } = require('./services/soul-engine');
    const soulEngine = getSoulEngine();
    soulEngine.init(db);
    console.log('Soul Engine awakened');
  } catch (error) {
    console.error('Failed to initialize Soul Engine:', error);
  }
  
  // Save to disk
  saveDatabase();
  
  return db;
}

function saveDatabase() {
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }
}

// Auto-save database periodically
setInterval(saveDatabase, 30000); // Every 30 seconds

// HTTP/HTTPS request helper
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    };
    
    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Track active streaming requests for cancellation
const activeStreams = new Map();

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  retryableErrors: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'socket hang up',
  ],
};

/**
 * Check if an error is retryable (network/connection errors only)
 */
function isRetryableError(error) {
  const errorMsg = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || '';
  
  // Check error codes
  if (RETRY_CONFIG.retryableErrors.includes(errorCode)) {
    return true;
  }
  
  // Check error messages
  for (const retryable of RETRY_CONFIG.retryableErrors) {
    if (errorMsg.includes(retryable.toLowerCase())) {
      return true;
    }
  }
  
  // Also retry on generic connection errors
  if (errorMsg.includes('connect') || errorMsg.includes('network') || errorMsg.includes('timeout')) {
    return true;
  }
  
  return false;
}

/**
 * Execute a function with exponential backoff retry
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {Function} onRetry - Callback when retrying (for UI updates)
 */
async function withRetry(fn, options = {}, onRetry = null) {
  const { maxRetries = RETRY_CONFIG.maxRetries, baseDelay = RETRY_CONFIG.baseDelay } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const shouldRetry = !isLastAttempt && isRetryableError(error);
      
      if (!shouldRetry) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s
      console.log(`[LLM] Retry ${attempt + 1}/${maxRetries} after error: ${error.message}. Waiting ${delay}ms...`);
      
      // Notify UI about retry
      if (onRetry) {
        onRetry({ retrying: true, attempt: attempt + 1, maxRetries, delay, error: error.message });
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Streaming request for LLM
function streamRequest(url, body, onChunk, channel) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(body);
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    };
    
    // Buffer to handle partial JSON chunks split across TCP packets
    let buffer = '';
    
    const req = protocol.request(reqOptions, (res) => {
      // Validate HTTP status code
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', (chunk) => { errorBody += chunk.toString(); });
        res.on('end', () => {
          activeStreams.delete(channel);
          reject(new Error(`Ollama returned HTTP ${res.statusCode}: ${errorBody.substring(0, 200)}`));
        });
        return;
      }

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Split on newlines and process complete lines
        const lines = buffer.split('\n');
        // Keep the last element (may be incomplete)
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            onChunk(parsed);
          } catch {
            // Ignore parse errors for genuinely malformed chunks
          }
        }
      });

      // Handle response-level errors (e.g. connection reset mid-stream)
      res.on('error', (error) => {
        activeStreams.delete(channel);
        reject(error);
      });

      res.on('end', () => {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            onChunk(parsed);
          } catch {
            // Ignore
          }
        }
        activeStreams.delete(channel);
        resolve();
      });
    });
    
    req.on('error', (error) => {
      activeStreams.delete(channel);
      reject(error);
    });

    // Add timeout (5 minutes for long generations)
    req.setTimeout(300000, () => {
      req.destroy();
      activeStreams.delete(channel);
      reject(new Error('Request timeout (5 minutes)'));
    });
    
    // Store request for cancellation
    if (channel) {
      activeStreams.set(channel, req);
    }
    
    req.write(bodyStr);
    req.end();
  });
}

// Cache model template metadata for compatibility routing.
const MODEL_TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const modelTemplateCache = new Map();

function isRawPromptTemplate(template) {
  if (!template || typeof template !== 'string') return false;
  const normalized = template.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return (
    normalized === '{{ .Prompt }}' ||
    normalized === '{{.Prompt}}' ||
    (normalized.includes('{{ .Prompt') && !normalized.includes('.Messages'))
  );
}

function isLikelyGptOssModel(modelName, family = '') {
  const modelLower = String(modelName || '').toLowerCase();
  const familyLower = String(family || '').toLowerCase();
  return (
    modelLower.includes('gpt-oss') ||
    modelLower.includes('gpt_oss') ||
    familyLower === 'gpt-oss'
  );
}

function normalizeChatMessages(messages = []) {
  const normalized = [];
  for (const msg of messages) {
    const role = msg?.role === 'assistant' ? 'assistant' : (msg?.role === 'user' ? 'user' : null);
    const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
    if (!role || !content) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      normalized.push({ role, content });
    }
  }

  while (normalized.length > 0 && normalized[0].role === 'assistant') {
    normalized.shift();
  }

  return normalized;
}

function buildRawModelHistory(messages = []) {
  const normalized = normalizeChatMessages(messages);
  if (normalized.length === 0) return [];

  let lastUserIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex < 0) return normalized.slice(-1);

  const latestUserText = normalized[lastUserIndex]?.content || '';
  // For greeting turns, don't carry forward previous assistant output.
  if (isSimpleGreeting(latestUserText)) {
    return [normalized[lastUserIndex]];
  }

  const result = [];
  const previous = normalized[lastUserIndex - 1];
  if (previous && previous.role === 'assistant') {
    const previousText = previous.content || '';
    const previousLooksNoisy =
      previousText.length > 1200 ||
      /we have a user|according to the policy|<\|start\|>|<\|message\|>|assistant:|user:/i.test(previousText);

    if (!previousLooksNoisy) {
      result.push(previous);
    }
  }
  result.push(normalized[lastUserIndex]);
  return result;
}

function buildGenerateFallbackPrompt(systemPrompt, chatMessages = []) {
  const parts = [];
  const sys = (systemPrompt || '').trim();
  if (sys) {
    parts.push(`System: ${sys}`);
  }

  for (const msg of chatMessages) {
    const role = msg.role === 'assistant' ? 'Assistant' : 'User';
    const content = (msg.content || '').trim();
    if (!content) continue;
    parts.push(`${role}: ${content}`);
  }

  parts.push('Assistant:');
  return parts.join('\n\n');
}

function buildGptOssHarmonyPrompt(systemPrompt, chatMessages = []) {
  const parts = [];
  const sys = (systemPrompt || '').trim() || 'You are a helpful assistant.';
  parts.push(`<|start|>system<|message|>${sys}<|end|>`);

  for (const msg of chatMessages) {
    const content = (msg.content || '').trim();
    if (!content) continue;

    if (msg.role === 'assistant') {
      parts.push(`<|start|>assistant<|channel|>final<|message|>${content}<|end|>`);
    } else {
      parts.push(`<|start|>user<|message|>${content}<|end|>`);
    }
  }

  parts.push('<|start|>assistant<|channel|>final<|message|>');
  return parts.join('');
}

function extractLastUserImages(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      return msg.images;
    }
  }
  return null;
}

function isSimpleGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  return /^(hi|hello|hey|yo|sup|how are you|good morning|good afternoon|good evening|what's up|whats up)[!.? ]*$/i
    .test(text.trim());
}

function isLikelyCodeRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const codeSignals = [
    /```/,
    /`[^`]+`/,
    /\b(error|exception|stack trace|traceback|bug|debug|refactor|compile|build|test|lint|runtime|syntax)\b/i,
    /\b(function|class|method|variable|array|object|sql|regex|api|endpoint|typescript|javascript|python|java|c\+\+|c#|rust|go)\b/i,
    /[{}()[\];]/,
  ];
  return codeSignals.some((pattern) => pattern.test(raw));
}

async function getModelTemplateMeta(endpoint, modelName) {
  const key = String(modelName || '').trim().toLowerCase();
  if (!key) return { template: null, family: null };

  const now = Date.now();
  const cached = modelTemplateCache.get(key);
  if (cached && now - cached.ts < MODEL_TEMPLATE_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await makeRequest(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: modelName },
      timeout: 12000,
    });
    const template = response?.data?.template || null;
    const family = response?.data?.details?.family || null;
    const value = { template, family };
    modelTemplateCache.set(key, { ts: now, value });
    return value;
  } catch {
    const value = { template: null, family: null };
    modelTemplateCache.set(key, { ts: now, value });
    return value;
  }
}

async function buildGenerateCompatRequest(endpoint, modelName, systemPrompt, messages, baseOptions = {}, stream = true) {
  const meta = await getModelTemplateMeta(endpoint, modelName);
  const isRawTemplate = isRawPromptTemplate(meta.template);
  const isGptOss = isLikelyGptOssModel(modelName, meta.family);
  if (!isRawTemplate && !isGptOss) return null;

  const normalizedMessages = normalizeChatMessages(messages);
  const latestUser = [...normalizedMessages].reverse().find((msg) => msg.role === 'user')?.content || '';
  const history = isGptOss ? buildRawModelHistory(normalizedMessages) : normalizedMessages;
  const greetingLike = isSimpleGreeting(latestUser);
  const codeLike = isLikelyCodeRequest(latestUser);

  const compatSystemPrompt = isGptOss
    ? (codeLike
      ? 'You are a precise coding assistant. Give direct, practical answers with runnable code when asked.'
      : 'You are a helpful assistant. Reply naturally and directly in a concise way.')
    : (systemPrompt || '');

  const cappedCtx = isGptOss ? 8192 : 16384;
  const cappedPredict = greetingLike ? 96 : (isGptOss ? 384 : 768);

  const options = {
    ...baseOptions,
    repeat_penalty: Math.max(1.1, baseOptions.repeat_penalty || 1.05),
    num_ctx: Number.isFinite(baseOptions.num_ctx) ? Math.min(baseOptions.num_ctx, cappedCtx) : cappedCtx,
    num_predict: Number.isFinite(baseOptions.num_predict) ? Math.min(baseOptions.num_predict, cappedPredict) : cappedPredict,
    temperature: greetingLike
      ? Math.min(Math.max(baseOptions.temperature ?? 0.2, 0.2), 0.35)
      : (baseOptions.temperature ?? 0.2),
  };

  if (isGptOss) {
    const stops = Array.isArray(baseOptions.stop) ? baseOptions.stop : [];
    options.stop = Array.from(new Set([
      ...stops,
      '<|return|>',
      '<|end|>',
      '<|start|>',
    ]));
  } else {
    const stops = Array.isArray(baseOptions.stop) ? baseOptions.stop : [];
    options.stop = Array.from(new Set([
      ...stops,
      'Human:', 'human:', 'User:', 'user:',
      '\nHuman:', '\nUser:', '\n\nHuman:', '\n\nUser:',
    ]));
  }

  const prompt = isGptOss
    ? buildGptOssHarmonyPrompt(compatSystemPrompt, history)
    : buildGenerateFallbackPrompt(compatSystemPrompt, history);

  const requestBody = {
    model: modelName,
    prompt,
    stream,
    options: {
      ...options,
      frequency_penalty: options.frequency_penalty ?? 0.05,
      presence_penalty: options.presence_penalty ?? 0.05,
    },
  };

  const visionImages = extractLastUserImages(messages);
  if (Array.isArray(visionImages) && visionImages.length > 0) {
    requestBody.images = visionImages;
  }

  return {
    apiPath: '/api/generate',
    requestBody,
    reason: isGptOss ? 'gpt-oss-harmony-compat' : 'raw-template-compat',
  };
}

// Guard against double registration during HMR
let handlersRegistered = false;

async function setupIpcHandlers(ipcMain, mainWindow, store) {
  // Prevent double registration during hot reload
  if (handlersRegistered) {
    console.log('IPC handlers already registered, skipping...');
    return;
  }
  handlersRegistered = true;
  
  const userDataPath = app.getPath('userData');
  const appPath = app.getAppPath();
  
  // Start automatic idle service cleanup (every 5 min, unload after 10 min idle)
  startIdleCleanup(5 * 60 * 1000, 10 * 60 * 1000);
  
  // Initialize database (must complete before services that depend on it)
  try {
    await initDatabase(userDataPath);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }

  // Web search IPC (DuckDuckGo-backed tool calls)
  try {
    setupWebSearchHandlers(ipcMain);
  } catch (error) {
    console.error('[IPC] Failed to setup web search handlers:', error.message);
  }

  // Code tools IPC (autonomous agent read/search/patch/command loop)
  try {
    const toolSetup = setupCodeToolsHandlers(ipcMain, mainWindow, store);
    if (!toolSetup?.success) {
      throw new Error('Code tools handlers did not report success');
    }
  } catch (error) {
    console.error('[IPC] Failed to setup code tools handlers:', error.message);
  }

  // Research IPC (project-based multi-agent research workflows)
  try {
    setupResearchHandlers(ipcMain, mainWindow, { db, saveDatabase, store });
  } catch (error) {
    console.error('[IPC] Failed to setup research handlers:', error.message);
  }

  const { getAgentService } = require('./services/agent-service');
  const agentService = getAgentService(db);

  // Agent run progress mirror (renderer -> main, queryable from any surface)
  ipcMain.handle('agent:updateRunProgress', async (_, payload = {}) => {
    const now = Date.now();
    agentRunProgressState.snapshot = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      updatedAt: now,
    };
    agentRunProgressState.updatedAt = now;

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:runProgress', agentRunProgressState.snapshot);
      }
    } catch (error) {
      console.warn('[IPC] Failed to emit agent:runProgress event:', error.message);
    }

    return { success: true, updatedAt: now };
  });

  ipcMain.handle('agent:getRunProgress', async () => {
    if (!agentRunProgressState.snapshot) {
      return {
        status: 'idle',
        runId: null,
        progressPct: 0,
        updatedAt: agentRunProgressState.updatedAt || Date.now(),
      };
    }
    return {
      ...agentRunProgressState.snapshot,
      updatedAt: agentRunProgressState.updatedAt || agentRunProgressState.snapshot.updatedAt || Date.now(),
    };
  });

  ipcMain.handle('listAgentTasks', async () => {
    try {
      return agentService.listTasks();
    } catch (error) {
      console.error('[IPC] listAgentTasks failed:', error.message);
      return [];
    }
  });

  ipcMain.handle('createAgentTask', async (_, payload = {}) => {
    try {
      return agentService.createTask(payload || {});
    } catch (error) {
      console.error('[IPC] createAgentTask failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getAgentTask', async (_, id) => {
    try {
      return agentService.getTask(id);
    } catch (error) {
      console.error('[IPC] getAgentTask failed:', error.message);
      return null;
    }
  });

  ipcMain.handle('cancelAgentTask', async (_, id) => {
    try {
      return agentService.cancelTask(id);
    } catch (error) {
      console.error('[IPC] cancelAgentTask failed:', error.message);
      return { success: false, error: error.message };
    }
  });
  
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    app.quit();
    return true;
  });
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());
  
  // Settings
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value));
  
  // Batched settings - reduces IPC overhead for multiple settings
  ipcMain.handle('store:getBatch', (_, keys) => {
    if (!Array.isArray(keys)) return {};
    const result = {};
    for (const key of keys) {
      result[key] = store.get(key);
    }
    return result;
  });
  
  ipcMain.handle('store:setBatch', (_, settings) => {
    if (!settings || typeof settings !== 'object') return false;
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value);
    }
    return true;
  });

  // Model Experience manager bootstrap (lazy init, singleton-safe)
  let modelExperienceInitPromise = null;
  const ensureModelExperienceManager = async () => {
    if (!getModelExperienceManagerFn) return null;
    const manager = getModelExperienceManagerFn({
      store,
      mainWindow,
      userDataPath,
    });
    if (!manager) return null;

    if (!manager.initialized) {
      if (!modelExperienceInitPromise) {
        modelExperienceInitPromise = manager
          .initialize()
          .catch((error) => {
            console.warn('[IPC] MAEE initialization failed:', error.message);
            throw error;
          })
          .finally(() => {
            modelExperienceInitPromise = null;
          });
      }
      await modelExperienceInitPromise;
    }

    return manager;
  };

  // Model inspection / auto-tuning
  ipcMain.handle('inspectModel', async (_, modelPath) => {
    try {
      if (!inspectModelFn) {
        return { success: false, error: 'Model inspector unavailable' };
      }
      const inspected = await inspectModelFn(modelPath);
      return { success: true, ...inspected };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to inspect model' };
    }
  });

  ipcMain.handle('autoTuneModel', async (_, modelPath) => {
    try {
      let recommendation = null;
      let tunerError = null;

      // Primary path: hardware-aware tuner (best when a local file path is provided)
      if (autoTuneModelFn) {
        try {
          recommendation = await autoTuneModelFn(modelPath);
        } catch (error) {
          tunerError = error;
        }
      }

      // Fallback path: derive a practical tuning profile from MAEE analysis
      // so Ollama model tags (e.g. "llama3.2:3b") still get auto-adjustment.
      if (!recommendation) {
        const manager = await ensureModelExperienceManager();
        const profile = manager ? await manager.analyzeModel(modelPath) : null;
        const inference = profile?.inference || null;
        if (inference) {
          recommendation = {
            backend: null,
            device: null,
            contextLength: Number(inference.num_ctx) || 4096,
            batchSize: Number(inference.num_batch) || 256,
            threads: Number(inference.num_thread) || null,
            gpuLayers: inference.num_gpu ?? null,
            kvCachePrecision: inference.f16_kv ? 'fp16' : undefined,
            flashAttention: true,
            temperature: Number(inference.temperature),
            top_p: Number(inference.top_p),
            top_k: Number(inference.top_k),
            repeat_penalty: Number(inference.repeat_penalty),
            source: 'maee-fallback',
            family: profile?.model?.family || 'chat',
          };
        }
      }

      if (!recommendation) {
        return {
          success: false,
          error: tunerError?.message || 'Auto-tune unavailable for this model',
        };
      }

      return { success: true, recommendation, ...recommendation };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to auto-tune model' };
    }
  });

  // Model Experience Engine (MAEE) IPC handlers
  ipcMain.handle('model:getExperience', async (_, modelPath) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return null;
    const profile = await manager.analyzeModel(modelPath);
    return profile || null;
  });

  ipcMain.handle('model:experienceStatus', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) {
      return {
        initialized: false,
        health: {
          engineAvailable: false,
          inspectorAvailable: Boolean(inspectModelFn),
          tunerAvailable: Boolean(autoTuneModelFn),
          orchestratorAvailable: false,
          lastCheck: Date.now(),
          errors: [{ time: Date.now(), error: 'Model Experience Manager unavailable' }],
        },
        currentModel: null,
        currentFamily: 'unknown',
        primaryStrength: 'generalChat',
        capabilities: {
          codeGeneration: 0.6,
          generalChat: 1.0,
          creative: 0.7,
          reasoning: 0.8,
          roleplay: 0.6,
        },
        lastError: 'Model Experience Manager unavailable',
      };
    }
    return manager.getStatus();
  });

  ipcMain.handle('model:healthCheck', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) {
      return {
        timestamp: Date.now(),
        overall: 'limited',
        components: {
          coreEngine: { name: 'Core Engine', status: 'unavailable', details: null },
          modelInspector: {
            name: 'Model Inspector',
            status: inspectModelFn ? 'healthy' : 'unavailable',
            details: inspectModelFn ? { canInspectGGUF: true } : null,
          },
          autoTuner: {
            name: 'Auto-Tuner',
            status: autoTuneModelFn ? 'healthy' : 'unavailable',
            details: null,
          },
        },
        recommendations: ['Model Experience Manager unavailable in this build'],
      };
    }
    return manager.runHealthCheck();
  });

  ipcMain.handle('model:analyzeExperience', async (_, modelPath) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return null;
    const profile = await manager.analyzeModel(modelPath);
    return profile || null;
  });

  ipcMain.handle('model:loadWithProfile', async (_, modelPath) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return null;
    const profile = await manager.loadModelWithExperience(modelPath);
    return profile || null;
  });

  ipcMain.handle('model:getInferenceParams', async (_, presetId) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return {};
    return manager.getInferenceParams(presetId);
  });

  ipcMain.handle('model:getInferencePresets', async () => {
    const manager = await ensureModelExperienceManager();
    if (manager) {
      const presets = manager.getAvailablePresets();
      if (Array.isArray(presets) && presets.length > 0) return presets;
    }
    try {
      const { INFERENCE_PRESETS } = require('./default-config');
      return Object.values(INFERENCE_PRESETS || {});
    } catch {
      return [];
    }
  });

  ipcMain.handle('model:getInferencePreset', async (_, presetId) => {
    try {
      const { getInferencePreset } = require('./default-config');
      return getInferencePreset(presetId);
    } catch {
      const manager = await ensureModelExperienceManager();
      return manager ? manager.getInferenceParams(presetId) : {};
    }
  });

  ipcMain.handle('model:getAccuracyParams', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return {};
    return manager.getAccuracyParams();
  });

  ipcMain.handle('model:getCreativeParams', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return {};
    return manager.getCreativeParams();
  });

  ipcMain.handle('model:getUIHints', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return {};
    return manager.getUIHints();
  });

  ipcMain.handle('model:getPromptTemplate', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return {};
    return manager.getPromptTemplate();
  });

  ipcMain.handle('model:getCapabilities', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) {
      return {
        codeGeneration: 0.6,
        generalChat: 1.0,
        creative: 0.7,
        reasoning: 0.8,
        roleplay: 0.6,
      };
    }
    return manager.getCapabilities();
  });

  ipcMain.handle('model:isGoodFor', async (_, task) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return true;
    return manager.isGoodFor(task);
  });

  ipcMain.handle('model:getRecommendedWorkspace', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return 'casual';
    return manager.getRecommendedWorkspace();
  });

  ipcMain.handle('model:getRecommendedView', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return 'stream';
    return manager.getRecommendedView();
  });

  ipcMain.handle('model:formatPrompt', async (_, userMessage, options = {}) => {
    const manager = await ensureModelExperienceManager();
    if (!manager) {
      return {
        prompt: String(userMessage || ''),
        system: '',
        assistantPrefix: '',
        metadata: {},
      };
    }
    return manager.formatPrompt(userMessage, options);
  });

  ipcMain.handle('model:clearExperienceCache', async () => {
    const manager = await ensureModelExperienceManager();
    if (!manager) return { success: false, error: 'Model Experience Manager unavailable' };
    manager.clearCache();
    return { success: true };
  });
  
  // Sovereignty Status - reports whether app is running in local-only mode
  ipcMain.handle('sovereignty:getStatus', async () => {
    const settings = store.get('settings') || {};
    const llmEndpoint = store.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const isLocalEndpoint = llmEndpoint.includes('127.0.0.1') || llmEndpoint.includes('localhost');
    
    return {
      localOnly: isLocalEndpoint && settings.localOnly !== false,
      llmEndpoint,
      isLocalEndpoint,
      networkAllowed: settings.allowExternalConnections === true,
      timestamp: Date.now(),
    };
  });
  
  // LLM Communication (Ollama API compatible)
  ipcMain.handle('llm:send', async (_, payload) => {
    const endpoint = store.get('llmEndpoint');
    try {
      const requestedTimeout = Number(
        payload?.timeout ?? payload?.options?.timeout ?? 300000
      );
      const requestTimeout = Number.isFinite(requestedTimeout)
        ? Math.max(10000, requestedTimeout)
        : 300000;

      // Use /api/chat when messages array is provided, else /api/generate.
      // For raw-template models (notably GPT-OSS imports), force a safe
      // generate-format compatibility prompt to avoid /api/chat degeneration.
      const useChatPayload = Array.isArray(payload.messages) && payload.messages.length > 0;

      let apiPath;
      let body;
      let responseMode = 'generate';

      if (useChatPayload) {
        const compat = await buildGenerateCompatRequest(
          endpoint,
          payload.model,
          payload.system,
          payload.messages,
          payload.options || {},
          false
        );

        if (compat) {
          apiPath = compat.apiPath;
          body = compat.requestBody;
          responseMode = 'generate';
          console.log(`[LLM Send] Using ${compat.reason} for model "${payload.model}"`);
        } else {
          apiPath = '/api/chat';
          const messages = [];
          if (payload.system) {
            messages.push({ role: 'system', content: payload.system });
          }
          messages.push(...payload.messages);
          body = {
            model: payload.model,
            messages,
            stream: false,
            options: payload.options || {},
            ...(payload.format ? { format: payload.format } : {})
          };
          responseMode = 'chat';
        }
      } else {
        apiPath = '/api/generate';
        body = {
          model: payload.model,
          prompt: payload.prompt,
          system: payload.system,
          stream: false,
          options: payload.options || {},
          ...(payload.format ? { format: payload.format } : {})
        };
      }
      
      const inferencePayload = {
        model: body.model || payload.model,
        options: body.options || payload.options || {},
        format: body.format || payload.format,
        lane: payload?.lane || 'lane_interactive',
        priority: payload?.priority,
        allowFallback: payload?.allowFallback !== false,
        workloadType: payload?.workloadType || (payload?.tools ? 'agent' : 'chat'),
        ...(body.messages ? { messages: body.messages } : {}),
        ...(body.prompt ? { prompt: body.prompt } : {}),
        ...(body.system ? { system: body.system } : {}),
        ...(body.images ? { images: body.images } : {}),
        ...(Array.isArray(payload?.tools) ? { tools: payload.tools } : {}),
      };

      let data = null;
      if (orchestrator) {
        data = await orchestrator.generate(inferencePayload);
      } else {
        const response = await makeRequest(`${endpoint}${apiPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          timeout: requestTimeout
        });
        data = response.data;
      }

      // Normalize: /api/chat returns { message: { content } }, /api/generate returns { response }
      if (responseMode === 'chat' && data?.message?.content && !data.response) {
        data.response = data.message.content;
      }
      return data;
    } catch (error) {
      throw new Error(`LLM request failed: ${error.message}`);
    }
  });
  
  const NON_SERIALIZABLE_IPC_KEYS = new Set(['request', 'fileStream', 'socket', 'connection', 'req', 'res']);

  const toIpcSafePayload = (value, depth = 0, seen = new WeakSet()) => {
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
    if (depth >= 7) return '[Truncated]';

    seen.add(value);

    if (Array.isArray(value)) {
      return value
        .map((item) => toIpcSafePayload(item, depth + 1, seen))
        .filter((item) => item !== undefined);
    }

    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (NON_SERIALIZABLE_IPC_KEYS.has(key)) continue;
      const safeValue = toIpcSafePayload(nested, depth + 1, seen);
      if (safeValue !== undefined) {
        output[key] = safeValue;
      }
    }
    return output;
  };

  const emitRendererEvent = (channel, payload, context = 'IPC') => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(channel, payload);
    } catch (error) {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(channel, toIpcSafePayload(payload));
      } catch (fallbackError) {
        console.warn(`[${context}] Failed to send ${channel}:`, fallbackError.message || error.message);
      }
    }
  };

  // Safe send helper - checks window is still valid before sending
  const safeSend = (ch, data) => {
    emitRendererEvent(ch, data, 'LLM Stream');
  };

  ipcMain.handle('llm:stream', async (_, payload) => {
    const endpoint = store.get('llmEndpoint');
    const { channel, ...rest } = payload;
    
    // Track whether the stream already sent a done/error signal via Ollama's own done:true
    let streamCompletedByOllama = false;

    // ── Build the request body ──
    // Use /api/chat (structured messages) when the frontend sends a messages array,
    // fall back to /api/generate for legacy callers.
    const useChatPayload = Array.isArray(rest.messages) && rest.messages.length > 0;
    let effectiveUseChat = useChatPayload;

    let requestBody;
    let apiPath;

    if (useChatPayload) {
      const compat = await buildGenerateCompatRequest(
        endpoint,
        rest.model,
        rest.system,
        rest.messages,
        rest.options || {},
        true
      );

      if (compat) {
        effectiveUseChat = false;
        apiPath = compat.apiPath;
        requestBody = compat.requestBody;
        console.log(`[LLM Stream] Using ${compat.reason} for model "${rest.model}"`);
      }
    }

    if (!requestBody && effectiveUseChat) {
      // ── /api/chat path (proper chat format — model template applied correctly) ──
      apiPath = '/api/chat';
      
      // Build messages array — system message first, then conversation
      const messages = [];
      if (rest.system) {
        messages.push({ role: 'system', content: rest.system });
      }
      for (const msg of rest.messages) {
        const entry = { role: msg.role, content: msg.content };
        // Vision/multimodal: attach images to the last user message
        if (msg.images && Array.isArray(msg.images) && msg.images.length > 0) {
          entry.images = msg.images;
          console.log(`[LLM Stream] Attached ${msg.images.length} image(s) to user message`);
        }
        messages.push(entry);
      }
      
      // Build options: use frontend-provided values, only apply safety defaults when absent
      const chatOpts = rest.options || {};
      // With /api/chat, Ollama's chat template handles stop tokens natively.
      // Do NOT inject manual stop tokens — they conflict with the template
      // and cause premature truncation (especially for thinking models).
      requestBody = {
        model: rest.model,
        messages,
        stream: true,
        options: {
          ...chatOpts,
          repeat_penalty: chatOpts.repeat_penalty ?? 1.05,
          num_predict: chatOpts.num_predict ?? 4096,
          frequency_penalty: chatOpts.frequency_penalty ?? 0.05,
          presence_penalty: chatOpts.presence_penalty ?? 0.05,
        }
      };
    } else if (!requestBody) {
      // ── /api/generate fallback (legacy — raw prompt) ──
      apiPath = '/api/generate';
      
      const genOpts = rest.options || {};
      requestBody = {
        model: rest.model,
        prompt: rest.prompt,
        system: rest.system,
        stream: true,
        options: {
          ...genOpts,
          // /api/generate fallback: only add turn-leak prevention tokens
          // (no template tokens — those conflict with the model's own EOS handling)
          stop: [
            ...(genOpts.stop || []),
            'Human:', 'human:', 'User:', 'user:',
            '\nHuman:', '\nUser:', '\n\nHuman:', '\n\nUser:',
          ],
          repeat_penalty: genOpts.repeat_penalty ?? 1.05,
          num_predict: genOpts.num_predict ?? 4096,
          frequency_penalty: genOpts.frequency_penalty ?? 0.05,
          presence_penalty: genOpts.presence_penalty ?? 0.05,
        }
      };

      // Vision/multimodal support for generate endpoint
      if (rest.images && Array.isArray(rest.images) && rest.images.length > 0) {
        requestBody.images = rest.images;
        console.log(`[LLM Stream] Sending ${rest.images.length} image(s) for vision analysis`);
      }
    }
    
    try {
      if (orchestrator) {
        const inferencePayload = {
          model: requestBody.model,
          options: requestBody.options || rest.options || {},
          lane: rest?.lane || 'lane_interactive',
          priority: rest?.priority,
          allowFallback: rest?.allowFallback !== false,
          workloadType: rest?.workloadType || (rest?.tools ? 'agent' : 'chat'),
          ...(requestBody.messages ? { messages: requestBody.messages } : {}),
          ...(requestBody.prompt ? { prompt: requestBody.prompt } : {}),
          ...(requestBody.system ? { system: requestBody.system } : {}),
          ...(requestBody.images ? { images: requestBody.images } : {}),
          ...(Array.isArray(rest?.tools) ? { tools: rest.tools } : {}),
        };

        const streamResult = await orchestrator.stream(inferencePayload, (chunk) => {
          if (!chunk) return;
          if (chunk.done) {
            streamCompletedByOllama = true;
            safeSend(channel, { done: true });
            return;
          }

          if (chunk.error) {
            safeSend(channel, { error: chunk.error });
            return;
          }

          if (chunk.message?.content) {
            safeSend(channel, { response: chunk.message.content });
            return;
          }

          if (chunk.response) {
            safeSend(channel, { response: chunk.response });
            return;
          }
        });

        if (streamResult?.requestId) {
          activeStreams.set(channel, { kind: 'orchestrator', requestId: streamResult.requestId });
        }

        if (streamResult?.streamTask && typeof streamResult.streamTask.then === 'function') {
          streamResult.streamTask
            .then(() => {
              activeStreams.delete(channel);
              if (!streamCompletedByOllama) {
                safeSend(channel, { done: true });
              }
            })
            .catch((error) => {
              activeStreams.delete(channel);
              safeSend(channel, { error: error.message || 'Stream failed' });
            });
        } else {
          activeStreams.delete(channel);
          if (!streamCompletedByOllama) {
            safeSend(channel, { done: true });
          }
        }

        return { started: true, channel };
      }

      // Use retry wrapper for connection resilience
      await withRetry(
        async () => {
          await streamRequest(
            `${endpoint}${apiPath}`,
            requestBody,
            (chunk) => {
              // Ollama sends { done: true } at the end of a stream
              if (chunk.done) {
                streamCompletedByOllama = true;
                safeSend(channel, { done: true });
                return;
              }
              
              // Normalize response format:
              // /api/chat returns { message: { content: "..." } }
              // /api/generate returns { response: "..." }
              if (effectiveUseChat && chunk.message?.content) {
                safeSend(channel, { response: chunk.message.content });
              } else if (chunk.response) {
                safeSend(channel, chunk);
              }
            },
            channel
          );
        },
        { maxRetries: 3, baseDelay: 1000 },
        // Notify frontend about retry status
        (retryInfo) => {
          safeSend(channel, retryInfo);
        }
      );
      // Only send our own done signal if Ollama didn't already
      if (!streamCompletedByOllama) {
        safeSend(channel, { done: true });
      }
      return { started: true, channel };
    } catch (error) {
      activeStreams.delete(channel);
      safeSend(channel, { error: error.message });
      return { started: false, error: error.message, channel };
    }
  });
  
  ipcMain.handle('llm:cancel', async (_, channel) => {
    const req = activeStreams.get(channel);
    if (!req) {
      return { success: false, error: 'Stream not found' };
    }

    try {
      if (req?.kind === 'orchestrator' && req.requestId) {
        if (orchestrator?.cancel) {
          await orchestrator.cancel(req.requestId);
        }
      } else if (typeof req?.destroy === 'function') {
        req.destroy();
      } else if (typeof req?.request?.destroy === 'function') {
        req.request.destroy();
      }
    } catch (error) {
      console.warn('[LLM Stream] Cancel failed:', error.message);
      activeStreams.delete(channel);
      safeSend(channel, { cancelled: true, warning: error.message });
      return { success: false, error: error.message };
    }

    activeStreams.delete(channel);
    safeSend(channel, { cancelled: true });
    return { success: true };
  });
  
  ipcMain.handle('llm:unload', async () => {
    return { success: true, message: 'Model unload not required (Ollama manages memory automatically)' };
  });
  
  ipcMain.handle('llm:health', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`, { timeout: 5000 });
      return { 
        healthy: true, 
        status: response.status === 200 ? 'online' : 'error',
        models: response.data?.models?.length || 0
      };
    } catch (error) {
      return { 
        healthy: false, 
        status: 'offline',
        error: error.message 
      };
    }
  });
  
  ipcMain.handle('llm:models', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`);
      return response.data.models || [];
    } catch {
      return [];
    }
  });
  
  ipcMain.handle('llm:load', async (_, modelPath) => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/pull`, {
        method: 'POST',
        body: { name: modelPath }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to load model: ${error.message}`);
    }
  });
  
  // ── Get real model metadata from Ollama /api/show ──
  // Returns family, parameter size, quantization, and context length
  // so the frontend doesn't have to guess from the filename.
  ipcMain.handle('llm:modelInfo', async (_, modelName) => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { name: modelName }
      });

      if (!response?.data) {
        return { success: false, error: 'No data returned' };
      }

      const data = response.data;
      const details = data.details || {};
      const modelInfo = data.model_info || {};

      // Extract real metadata
      const family = details.family || null;
      const parameterSize = details.parameter_size || null;
      const quantizationLevel = details.quantization_level || null;

      // Extract context length from model parameters or modelfile
      // Ollama stores this in model_info under various keys
      let contextLength = null;
      for (const key of Object.keys(modelInfo)) {
        const k = key.toLowerCase();
        if (k.includes('context_length') || k.includes('context_window') || k.includes('max_position')) {
          const val = modelInfo[key];
          if (typeof val === 'number' && val > 0) {
            contextLength = val;
            break;
          }
        }
      }

      // Also try to get from the template/parameters
      if (!contextLength && data.parameters) {
        const ctxMatch = data.parameters.match(/num_ctx\s+(\d+)/);
        if (ctxMatch) {
          contextLength = parseInt(ctxMatch[1], 10);
        }
      }

      return {
        success: true,
        family,
        parameterSize,
        quantizationLevel,
        contextLength,
        format: details.format || null,
        parentModel: details.parent_model || null,
        // Template: the chat template string (needed for thinking model detection)
        template: data.template || null,
        // Raw details for debugging
        _raw: { families: details.families, format: details.format },
      };
    } catch (error) {
      // Non-fatal — fallback to name-based detection
      console.warn(`[IPC] llm:modelInfo failed for "${modelName}":`, error.message);
      return { success: false, error: error.message };
    }
  });

  // Warmup/preload a model onto GPU
  ipcMain.handle('llm:warmup', async (_, modelName) => {
    console.log(`[IPC] Warming up model: ${modelName}`);
    try {
      if (orchestrator) {
        const result = await orchestrator.warmupModel(modelName, {
          lane: 'lane_interactive',
          workloadType: 'warmup',
          allowFallback: true,
          priority: -60,
        });
        if (result?.success) {
          console.log(`[IPC] Model ${modelName} warmed up successfully via orchestrator`);
        } else {
          console.warn(`[IPC] Warmup verification failed for ${modelName}: ${result?.fallbackReason || 'unknown reason'}`);
        }
        return result;
      }

      // Fallback path when orchestrator is unavailable.
      const endpoint = store.get('llmEndpoint');
      const response = await makeRequest(`${endpoint}/api/generate`, {
        method: 'POST',
        body: {
          model: modelName,
          prompt: 'Hi',
          stream: false,
          options: {
            num_gpu: -1,
            num_predict: 1,
            num_ctx: 512,
          }
        },
        timeout: 120000
      });

      if (response.status !== 200) {
        return {
          ok: false,
          success: false,
          model: modelName,
          backend: 'ollama-cuda',
          fallbackReason: response.data?.error || `HTTP ${response.status}`,
          offloadEvidence: null,
          timings: { elapsedMs: 0 },
        };
      }

      const ps = await makeRequest(`${endpoint}/api/ps`, { timeout: 5000 });
      const models = Array.isArray(ps?.data?.models) ? ps.data.models : [];
      const target = models.find((row) =>
        String(row?.name || '').toLowerCase().includes(String(modelName || '').toLowerCase().split(':')[0])
      );
      const sizeVram = Number(target?.size_vram || 0);
      const verified = sizeVram > 0;

      return {
        ok: verified,
        success: verified,
        model: modelName,
        backend: 'ollama-cuda',
        offloadEvidence: {
          verified,
          backend: 'ollama-cuda',
          method: 'ollama:/api/ps',
          model: modelName,
          sizeVram,
          details: target || null,
          checkedAt: Date.now(),
        },
        timings: { elapsedMs: 0 },
        fallbackReason: verified ? null : 'gpu-offload-not-verified',
      };
    } catch (error) {
      console.error(`[IPC] Warmup failed:`, error.message);
      return {
        ok: false,
        success: false,
        model: modelName,
        backend: null,
        fallbackReason: error.message,
        offloadEvidence: null,
        timings: { elapsedMs: 0 },
      };
    }
  });
  
  // Get currently running/loaded models
  ipcMain.handle('llm:running', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/ps`, { timeout: 5000 });
      return response.data?.models || [];
    } catch {
      return [];
    }
  });
  
  // Image Generation (ComfyUI API compatible)
  ipcMain.handle('image:generate', async (_, payload) => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload.workflow,
        timeout: 300000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Image generation failed: ${error.message}`);
    }
  });
  
  ipcMain.handle('image:models', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/object_info/CheckpointLoaderSimple`);
      return response.data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    } catch {
      return [];
    }
  });
  
  const activeImageJobs = new Map();
  
  ipcMain.handle('image:interrupt', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/interrupt`, {
        method: 'POST',
        timeout: 5000
      });
      activeImageJobs.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('image:health', async () => {
    const endpoint = store.get('imageGenEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/system_stats`, { timeout: 5000 });
      return { 
        healthy: true, 
        status: response.status === 200 ? 'online' : 'error'
      };
    } catch (error) {
      return { 
        healthy: false, 
        status: 'offline',
        error: error.message 
      };
    }
  });

  // ============================================
  // ComfyUI Manager - Local Image Generation
  // Fully offline, unrestricted, NSFW-capable
  // ============================================
  
  ipcMain.handle('comfyui:getStatus', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) {
        return { installed: false, running: false, error: 'ComfyUI manager not available' };
      }
      return await manager.getStatus();
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:install', async (_, options = {}) => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.install(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:start', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:stop', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:downloadModel', async (_, model) => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.downloadModel(model, (progress) => {
        mainWindow?.webContents?.send('comfyui:downloadProgress', { 
          modelId: model.id || model.name, 
          ...progress 
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('comfyui:getAvailableModels', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return manager.getAvailableModels();
    } catch (error) {
      return {};
    }
  });

  ipcMain.handle('comfyui:getInstalledModels', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return await manager.getInstalledModels();
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('comfyui:getSetupInstructions', async () => {
    try {
      const manager = getComfyUIManager();
      if (!manager) throw new Error('ComfyUI manager not available');
      return manager.getSetupInstructions();
    } catch (error) {
      return { error: error.message };
    }
  });

  // Main image generation handler using ImageService
  ipcMain.handle('getImageStatus', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        // Fall back to ComfyUI manager status
        const comfyManager = getComfyUIManager();
        if (comfyManager) {
          const status = await comfyManager.getStatus();
          return {
            running: status.running,
            backend: status.running ? 'comfyui' : null,
            backendName: 'ComfyUI',
            endpoint: `http://localhost:${status.port}`,
            models: status.models || []
          };
        }
        return { running: false, error: 'Image service not available' };
      }
      
      // Initialize if needed
      if (!imageService.isInitialized) {
        await imageService.initialize();
      }
      
      return await imageService.getStatus();
    } catch (error) {
      return { running: false, error: error.message };
    }
  });

  ipcMain.handle('generateImage', async (_, params) => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        throw new Error('Image service not available. Please install ComfyUI first.');
      }
      
      // Initialize if needed
      if (!imageService.isInitialized) {
        await imageService.initialize();
      }
      
      return await imageService.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detectImageBackend', async () => {
    try {
      const imageService = getImageService();
      if (!imageService) {
        return { running: false, backend: null };
      }
      return await imageService.detectBackend();
    } catch (error) {
      return { running: false, error: error.message };
    }
  });

  ipcMain.handle('pollImageResult', async (_, promptId) => {
    try {
      const imageService = getImageService();
      if (!imageService) throw new Error('Image service not available');
      return await imageService.pollComfyUIResult(promptId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getImagePresets', async () => {
    try {
      const imageService = getImageService();
      if (imageService) {
        return imageService.getModelPresets();
      }
      // Return default presets
      return {
        sd15: { name: 'SD 1.5', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7 },
        sdxl: { name: 'SDXL', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 25, defaultCfg: 7 },
        flux: { name: 'Flux', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 20, defaultCfg: 1 }
      };
    } catch (error) {
      return {};
    }
  });

  // ============================================
  // Auto Image Backend - Fully Self-Contained
  // One-click setup, no manual configuration
  // ============================================

  ipcMain.handle('imageAuto:getStatus', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) return { installed: false, running: false, error: 'Backend not available' };
      return await backend.getStatus();
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:setup', async (_, options = {}) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      
      // Set up event forwarding
      backend.onEvent((event, data) => {
        mainWindow?.webContents?.send('imageAuto:event', { event, ...data });
      });
      
      return await backend.autoSetup(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:start', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      // Ensure event forwarding is set up for start progress
      backend.onEvent((event, data) => {
        mainWindow?.webContents?.send('imageAuto:event', { event, ...data });
      });
      return await backend.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:stop', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:generate', async (_, params) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.generate(params);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:downloadModel', async (_, { url, filename }) => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.downloadModel(url, filename, (progress) => {
        mainWindow?.webContents?.send('imageAuto:downloadProgress', progress);
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageAuto:ensureRunning', async () => {
    try {
      const backend = getImageBackendAuto();
      if (!backend) throw new Error('Backend not available');
      return await backend.ensureRunning();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // =============================================================================
  // MEMORY ENGINE - Long conversation memory support
  // =============================================================================
  
  ipcMain.handle('memory:buildContext', async (_, { conversationId, workspace, messages, options }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.buildContext(conversationId, workspace, messages, options);
    } catch (error) {
      console.error('[Memory] buildContext error:', error);
      return { contextText: '', parts: [], totalTokens: 0, messagesIncluded: messages?.length || 0 };
    }
  });

  ipcMain.handle('memory:extractMemories', async (_, { conversationId, messages, workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.extractMemories(conversationId, messages, workspace);
    } catch (error) {
      console.error('[Memory] extractMemories error:', error);
      return [];
    }
  });

  ipcMain.handle('memory:updateSummary', async (_, { conversationId, messages, workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.updateSummary(conversationId, messages, workspace);
    } catch (error) {
      console.error('[Memory] updateSummary error:', error);
      return null;
    }
  });

  ipcMain.handle('memory:pinMessage', async (_, { messageId, conversationId, reason }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.pinMessage(messageId, conversationId, reason);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:unpinMessage', async (_, { messageId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.unpinMessage(messageId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getPinned', async (_, { conversationId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getPinnedMessages(conversationId);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('memory:isMessagePinned', async (_, { messageId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.isMessagePinned(messageId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getMemories', async (_, { workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getWorkspaceMemories(workspace);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('memory:addMemory', async (_, memory) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.addMemory(memory);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('memory:deleteMemory', async (_, { memoryId }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.deleteMemory(memoryId);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('memory:getStats', async (_, { workspace }) => {
    try {
      const { getMemoryEngine } = require('./services/memory-engine');
      const engine = getMemoryEngine();
      return await engine.getStats(workspace);
    } catch (error) {
      return { memories: 0, summaries: 0, pinned: 0 };
    }
  });

  // =============================================================================
  // SOUL ENGINE - Personality persistence and adaptive behavior
  // =============================================================================
  
  ipcMain.handle('soul:getSoul', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().getSoul();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('soul:getStats', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().getStats();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('soul:recordInteraction', async (_, data) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      await getSoulEngine().recordInteraction(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('soul:recordFeedback', async (_, { signal, messageId, value, context }) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      await getSoulEngine().recordFeedback(signal, messageId, value, context);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('soul:getPersonalizedPrompt', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      return getSoulEngine().generatePersonalizedPrompt();
    } catch (error) {
      return '';
    }
  });

  ipcMain.handle('soul:updateUserInfo', async (_, updates) => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      getSoulEngine().updateUserInfo(updates);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });

  ipcMain.handle('soul:reset', async () => {
    try {
      const { getSoulEngine } = require('./services/soul-engine');
      getSoulEngine().reset();
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });
  
  // File System
  ipcMain.handle('fs:selectFile', async (_, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options.properties || ['openFile'],
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  
  ipcMain.handle('fs:selectFolder', async (_, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      ...options
    });
    return result.canceled ? null : result.filePaths[0];
  });

  /**
   * Agent terminal execution (guarded).
   */
  ipcMain.handle('agent:runCommand', async (_, payload = {}) => {
    return executeTerminalCommand(payload);
  });

  ipcMain.handle('runTerminalCommand', async (_, payload = {}) => {
    return executeTerminalCommand(payload);
  });
  
  ipcMain.handle('fs:readFile', async (_, filePath) => {
    const validation = validatePath(filePath, { allowAbsolute: true });
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }
    return await fsPromises.readFile(validation.normalizedPath, 'utf-8');
  });

  // Read file as base64 - used for vision/multimodal model image input
  ipcMain.handle('fs:readFileBase64', async (_, filePath) => {
    try {
      const validation = validatePath(filePath, { allowAbsolute: true });
      if (!validation.valid) {
        throw new Error(`Invalid path: ${validation.reason}`);
      }
      const buffer = await fsPromises.readFile(validation.normalizedPath);
      return buffer.toString('base64');
    } catch (error) {
      console.error('Failed to read file as base64:', error);
      return null;
    }
  });
  
  ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
    const validation = validatePath(filePath, { allowAbsolute: true });
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }
    const targetPath = validation.normalizedPath;
    // Ensure parent directory exists
    const dir = path.dirname(targetPath);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(targetPath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:createFolder', async (_, folderPath) => {
    const validation = validatePath(folderPath, { allowAbsolute: true });
    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }
    await fsPromises.mkdir(validation.normalizedPath, { recursive: true });
    return true;
  });
  
  ipcMain.handle('fs:listModels', async (_, directory) => {
    try {
      const validation = validatePath(directory, { allowAbsolute: true });
      if (!validation.valid) {
        throw new Error(`Invalid path: ${validation.reason}`);
      }
      const files = await fsPromises.readdir(validation.normalizedPath, { withFileTypes: true });
      return files
        .filter(f => f.isFile() && (f.name.endsWith('.gguf') || f.name.endsWith('.bin')))
        .map(f => ({ name: f.name, path: path.join(validation.normalizedPath, f.name) }));
    } catch (error) {
      console.warn('[IPC] fs:listModels failed:', error.message);
      return [];
    }
  });

  // ============================================
  // Screenshot Capture
  // ============================================
  
  ipcMain.handle('captureScreenshot', async () => {
    try {
      const { captureScreen } = require('./services/screenshot-service');
      const result = await captureScreen();
      
      if (result.success) {
        // Read the file and return as data URL
        const imageBuffer = await fsPromises.readFile(result.filePath);
        const base64 = imageBuffer.toString('base64');
        return `data:image/png;base64,${base64}`;
      } else {
        console.error('Screenshot capture failed:', result.error);
        return null;
      }
    } catch (error) {
      console.error('Screenshot capture error:', error);
      return null;
    }
  });

  // ============================================
  // Project Scanning (Code Workspace)
  // ============================================
  
  ipcMain.handle('project:scan', async (_, rootPath, options = {}) => {
    try {
      return scanProject(rootPath, options);
    } catch (error) {
      console.error('Failed to scan project:', error);
      return { root: '', tree: [] };
    }
  });

  ipcMain.handle('project:analyze', async (_, rootPath) => {
    try {
      const resolvedRoot = resolveProjectRoot(rootPath);
      const { analyzeProject } = require('./services/code-intelligence');
      return await analyzeProject(resolvedRoot);
    } catch (error) {
      console.error('Failed to analyze project:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git:status', async (_, rootPath) => {
    try {
      const resolvedRoot = resolveProjectRoot(rootPath);
      const result = spawnSync('git', ['status', '--porcelain', '--branch'], {
        cwd: resolvedRoot,
        encoding: 'utf8',
        windowsHide: true,
      });

      if (result.error) {
        return { branch: 'main', ahead: 0, behind: 0, files: [], error: result.error.message };
      }
      if (result.status !== 0) {
        return {
          branch: 'main',
          ahead: 0,
          behind: 0,
          files: [],
          error: String(result.stderr || 'Not a git repository').trim(),
        };
      }
      return parseGitStatusOutput(result.stdout || '');
    } catch (error) {
      return { branch: 'main', ahead: 0, behind: 0, files: [], error: error.message };
    }
  });

  ipcMain.handle('git:stage', async (_, rootPath, filePath) => {
    try {
      const resolvedRoot = resolveProjectRoot(rootPath);
      const absoluteFile = path.resolve(resolvedRoot, String(filePath || ''));
      const relativeFile = path.relative(resolvedRoot, absoluteFile);
      if (!relativeFile || relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
        throw new Error('File path must be inside project root');
      }

      const result = spawnSync('git', ['add', '--', relativeFile], {
        cwd: resolvedRoot,
        encoding: 'utf8',
        windowsHide: true,
      });

      if (result.error || result.status !== 0) {
        return {
          success: false,
          error: result.error?.message || String(result.stderr || 'git add failed').trim(),
        };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git:commit', async (_, rootPath, message) => {
    try {
      const resolvedRoot = resolveProjectRoot(rootPath);
      const commitMessage = String(message || '').trim();
      if (!commitMessage) {
        throw new Error('Commit message is required');
      }

      const result = spawnSync('git', ['commit', '-m', commitMessage], {
        cwd: resolvedRoot,
        encoding: 'utf8',
        windowsHide: true,
      });

      if (result.error || result.status !== 0) {
        return {
          success: false,
          error: result.error?.message || String(result.stderr || 'git commit failed').trim(),
        };
      }
      return { success: true, output: String(result.stdout || '').trim() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Conversation Export
  // ============================================

  ipcMain.handle('export:selectDestination', async (_, options) => {
    const { scope, defaultPath, defaultFileName } = options || {};

    if (scope === 'all') {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select export folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: defaultPath || app.getPath('documents'),
      });
      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true };
      }
      return { canceled: false, directory: result.filePaths[0] };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export conversation',
      defaultPath:
        defaultFileName ||
        path.join(defaultPath || app.getPath('documents'), 'conversation.txt'),
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('export:conversation', async (_, { conversationId, format, targetPath }) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const filePath = await exportService.exportConversation(db, conversationId, format, targetPath);
      return { success: true, filePath };
    } catch (error) {
      console.error('Failed to export conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:allConversations', async (_, { format, directory }) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const results = await exportService.exportAllConversations(db, format, directory);
      return { success: true, results };
    } catch (error) {
      console.error('Failed to export conversations:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Backup & Restore
  // ============================================

  ipcMain.handle('backup:create', async (_, { targetPath }) => {
    try {
      const filePath = await backupService.createBackup({
        dbPath,
        store,
        targetPath,
      });
      return { success: true, filePath };
    } catch (error) {
      console.error('Failed to create backup:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:restore', async (_, { backupPath }) => {
    try {
      const result = await backupService.restoreBackup({
        backupPath,
        dbPath,
        store,
      });
      return { success: true, ...result, requiresRestart: true };
    } catch (error) {
      console.error('Failed to restore backup:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('backup:schedule', (_, schedule) => {
    try {
      store.set('backupSchedule', schedule || null);
      return { success: true };
    } catch (error) {
      console.error('Failed to save backup schedule:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('backup:list', async () => {
    const backups = [];
    const docsDir = app.getPath('documents');
    try {
      const entries = await fsPromises.readdir(docsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          (entry.name.endsWith('.devforge-backup') || entry.name.startsWith('devforge-backup-'))
        ) {
          const fullPath = path.join(docsDir, entry.name);
          const stat = await fsPromises.stat(fullPath);
          backups.push({
            name: entry.name,
            path: fullPath,
            size: stat.size,
            modified: stat.mtime,
          });
        }
      }
    } catch (error) {
      console.error('Failed to list backups:', error);
    }
    return backups;
  });
  
  // Database operations using sql.js
  ipcMain.handle('db:query', (_, sql, params = []) => {
    if (!db) return [];
    try {
    const stmt = db.prepare(sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('DB query error:', error);
      return [];
    }
  });

  // ============================================
  // Voice (Whisper)
  // ============================================

  ipcMain.handle('voice:check', () => {
    try {
      return whisperService.isAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  ipcMain.handle('voice:transcribe', async (_, { audioData }) => {
    try {
      if (!audioData) {
        throw new Error('No audio data provided');
      }
      const buffer = Buffer.from(audioData);
      const result = await whisperService.transcribeBuffer(buffer);
      return { success: true, text: result.text };
    } catch (error) {
      console.error('Voice transcription failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Documents / RAG
  // ============================================

  ipcMain.handle('documents:ingest', async (_, { filePath, workspace }) => {
    try {
      const doc = await ragService.ingestDocument(db, store, filePath, workspace);
      saveDatabase();
      return { success: true, document: doc };
    } catch (error) {
      console.error('Failed to ingest document:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:list', (_, { workspace }) => {
    try {
      return ragService.listDocuments(db, workspace);
    } catch (error) {
      console.error('Failed to list documents:', error);
      return [];
    }
  });

  ipcMain.handle('documents:delete', (_, id) => {
    const res = ragService.deleteDocument(db, id);
    if (res.success) {
      saveDatabase();
    }
    return res;
  });

  ipcMain.handle('documents:search', async (_, { workspace, query, limit }) => {
    try {
      const matches = await ragService.searchDocuments(db, store, workspace, query, limit || 4);
      return matches;
    } catch (error) {
      console.error('Failed to search documents:', error);
      return [];
    }
  });

  ipcMain.handle('rag:exportWorkspace', async (_, { workspace }) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export knowledge pack',
        filters: [{ name: 'DevForge Knowledge Pack', extensions: ['devforge-knowledge'] }],
        defaultPath: path.join(app.getPath('documents'), 'workspace.devforge-knowledge'),
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      const exportResult = await ragService.exportWorkspace(db, workspace, result.filePath);
      saveDatabase();
      return { success: true, filePath: result.filePath, ...exportResult };
    } catch (error) {
      console.error('Failed to export knowledge pack:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:importWorkspace', async (_, { workspace }) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import knowledge pack',
        filters: [{ name: 'DevForge Knowledge Pack', extensions: ['devforge-knowledge', 'json'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true };
      }
      const importResult = await ragService.importWorkspace(db, workspace, result.filePaths[0]);
      saveDatabase();
      return { success: true, ...importResult };
    } catch (error) {
      console.error('Failed to import knowledge pack:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Auto‑update
  // ============================================

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await updaterService.checkForUpdates();
      return result;
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return { supported: updaterService.isSupported(), error: error.message };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      const result = await updaterService.downloadUpdate();
      return result;
    } catch (error) {
      console.error('Failed to download update:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('updater:install', async () => {
    try {
      const result = await updaterService.installUpdate();
      return result;
    } catch (error) {
      console.error('Failed to install update:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('db:run', (_, sql, params = []) => {
    if (!db) return { changes: 0 };
    try {
      db.run(sql, params);
      saveDatabase(); // Save after each write
      return { changes: db.getRowsModified() };
    } catch (error) {
      console.error('DB run error:', error);
      return { changes: 0, error: error.message };
    }
  });
  
  // =============================================================================
  // ORGANIZATION SYSTEM - Folders, Tags, Pin/Star
  // =============================================================================
  
  // Get all folders for a workspace
  ipcMain.handle('folders:list', async (_, workspace) => {
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT * FROM folders WHERE workspace = ? ORDER BY sort_order ASC, name ASC');
      stmt.bind([workspace]);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('Failed to list folders:', error);
      return [];
    }
  });
  
  // Create a new folder
  ipcMain.handle('folders:create', async (_, { id, name, color, icon, workspace, parentId }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Get next sort order
      const countResult = db.exec(`SELECT COUNT(*) as count FROM folders WHERE workspace = ?`, [workspace]);
      const sortOrder = countResult.length > 0 && countResult[0].values.length > 0 
        ? countResult[0].values[0][0] 
        : 0;
      
      db.run(
        `INSERT INTO folders (id, name, color, icon, workspace, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, color || '#6366f1', icon || 'Folder', workspace, parentId || null, sortOrder]
      );
      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to create folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update a folder
  ipcMain.handle('folders:update', async (_, { id, name, color, icon, sortOrder }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const updates = [];
      const params = [];
      
      if (name !== undefined) { updates.push('name = ?'); params.push(name); }
      if (color !== undefined) { updates.push('color = ?'); params.push(color); }
      if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
      if (sortOrder !== undefined) { updates.push('sort_order = ?'); params.push(sortOrder); }
      
      if (updates.length === 0) return { success: true };
      
      params.push(id);
      db.run(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to update folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Delete a folder (moves conversations to unfiled)
  ipcMain.handle('folders:delete', async (_, folderId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Move conversations to unfiled (null folder_id)
      db.run('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?', [folderId]);
      // Delete the folder
      db.run('DELETE FROM folders WHERE id = ?', [folderId]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Move conversation to folder
  ipcMain.handle('conversation:moveToFolder', async (_, { conversationId, folderId }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET folder_id = ? WHERE id = ?', [folderId, conversationId]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to move conversation to folder:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Toggle conversation starred status
  ipcMain.handle('conversation:toggleStar', async (_, conversationId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = ?', [conversationId]);
      saveDatabase();
      // Return new value
      const result = db.exec('SELECT starred FROM conversations WHERE id = ?', [conversationId]);
      const starred = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
      return { success: true, starred: starred === 1 };
    } catch (error) {
      console.error('Failed to toggle star:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Toggle conversation pinned status
  ipcMain.handle('conversation:togglePin', async (_, conversationId) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('UPDATE conversations SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?', [conversationId]);
      saveDatabase();
      // Return new value
      const result = db.exec('SELECT pinned FROM conversations WHERE id = ?', [conversationId]);
      const pinned = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
      return { success: true, pinned: pinned === 1 };
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update conversation tags (JSON array)
  ipcMain.handle('conversation:setTags', async (_, { conversationId, tags }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const tagsJson = JSON.stringify(tags || []);
      db.run('UPDATE conversations SET tags = ? WHERE id = ?', [tagsJson, conversationId]);
      saveDatabase();
      return { success: true, tags };
    } catch (error) {
      console.error('Failed to set tags:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update conversation preview and message count
  ipcMain.handle('conversation:updateMeta', async (_, { conversationId, preview, messageCount }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const updates = [];
      const params = [];
      
      if (preview !== undefined) { updates.push('preview = ?'); params.push(preview); }
      if (messageCount !== undefined) { updates.push('message_count = ?'); params.push(messageCount); }
      
      if (updates.length === 0) return { success: true };
      
      params.push(conversationId);
      db.run(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to update conversation meta:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get all unique tags for a workspace (for auto-suggest)
  ipcMain.handle('tags:listForWorkspace', async (_, workspace) => {
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT tags FROM conversations WHERE workspace = ? AND tags IS NOT NULL AND tags != "[]"');
      stmt.bind([workspace]);
      const allTags = new Set();
      while (stmt.step()) {
        const row = stmt.getAsObject();
        try {
          const tags = JSON.parse(row.tags || '[]');
          tags.forEach(tag => allTags.add(tag));
        } catch { /* ignore invalid JSON */ }
      }
      stmt.free();
      return Array.from(allTags).sort();
    } catch (error) {
      console.error('Failed to list tags:', error);
      return [];
    }
  });
  
  // NSFW Password Management
  ipcMain.handle('nsfw:setPassword', async (_, password) => {
    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    
    try {
      const existing = db.exec("SELECT * FROM nsfw_auth WHERE id = 'nsfw'");
      
      if (existing.length > 0 && existing[0].values.length > 0) {
        db.run("UPDATE nsfw_auth SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = 'nsfw'", [hash, salt]);
      } else {
        db.run("INSERT INTO nsfw_auth (id, password_hash, salt) VALUES ('nsfw', ?, ?)", [hash, salt]);
      }
      
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to set password:', error);
      throw error;
    }
  });
  
  ipcMain.handle('nsfw:verifyPassword', async (_, password) => {
    try {
      const result = db.exec("SELECT password_hash, salt FROM nsfw_auth WHERE id = 'nsfw'");
      
      if (!result.length || !result[0].values.length) {
        return { verified: false, error: 'No password set' };
      }
      
      const [storedHash, salt] = result[0].values[0];
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      
      const verified = crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(storedHash)
      );
      
      return { verified };
    } catch (error) {
      return { verified: false, error: error.message };
    }
  });
  
  ipcMain.handle('nsfw:hasPassword', async () => {
    try {
      const result = db.exec("SELECT * FROM nsfw_auth WHERE id = 'nsfw'");
      return { hasPassword: result.length > 0 && result[0].values.length > 0 };
    } catch {
      return { hasPassword: false };
    }
  });
  
  // Encryption
  ipcMain.handle('crypto:encrypt', (_, data, password) => {
    if (!password) {
      throw new Error('Password required for encryption');
    }
    
    const algorithm = 'aes-256-gcm';
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      authTag: authTag.toString('hex')
    };
  });
  
  ipcMain.handle('crypto:decrypt', (_, data, password) => {
    if (!password) {
      throw new Error('Password required for decryption');
    }
    
    const algorithm = 'aes-256-gcm';
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.scryptSync(password, salt, 32);
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
    
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  });
  
  // App Info
  ipcMain.handle('app:getPath', () => userDataPath);
  ipcMain.handle('app:getVersion', () => app.getVersion());
  
  // Shell
  ipcMain.handle('shell:openExternal', async (_, url) => {
    try {
      const parsed = new URL(String(url || ''));
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      await shell.openExternal(parsed.toString());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('shell:openPath', async (_, targetPath) => {
    try {
      const validation = validatePath(targetPath, { allowAbsolute: true });
      if (!validation.valid) {
        throw new Error(validation.reason || 'Invalid path');
      }
      const result = await shell.openPath(validation.normalizedPath);
      return {
        success: !result,
        error: result || null,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // GPU Info (legacy - kept for compatibility)
  ipcMain.handle('system:gpuInfo', async () => {
    try {
      const gpuInfo = await app.getGPUInfo('complete');
      return gpuInfo;
    } catch {
      return null;
    }
  });

  // ============================================
  // Hardware Detection & Monitoring
  // ============================================
  
  // Full hardware detection (GPUs, NPU, CPU, RAM)
  ipcMain.handle('hardware:detect', async () => {
    if (!hardwareDetection) {
      return { error: 'Hardware detection not available - systeminformation package not installed' };
    }
    try {
      return await hardwareDetection.detectHardware();
    } catch (error) {
      console.error('Hardware detection failed:', error);
      return { error: error.message };
    }
  });

  // Real-time hardware statistics
  ipcMain.handle('hardware:getStats', async () => {
    if (!hardwareDetection) {
      return { error: 'Hardware detection not available', cpu: { usage: 0 }, memory: { usagePercent: 0 }, gpus: [] };
    }
    try {
      return await hardwareDetection.getHardwareStats();
    } catch (error) {
      console.error('Failed to get hardware stats:', error);
      return { error: error.message };
    }
  });

  // Detailed GPU information
  ipcMain.handle('hardware:getGpuInfo', async () => {
    if (!hardwareDetection) {
      return [];
    }
    try {
      return await hardwareDetection.getGpuInfo();
    } catch (error) {
      console.error('Failed to get GPU info:', error);
      return { error: error.message };
    }
  });

  // Check CUDA availability
  ipcMain.handle('hardware:checkCuda', async () => {
    if (!hardwareDetection) {
      return { available: false, error: 'Hardware detection not available' };
    }
    try {
      return await hardwareDetection.checkCudaAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  // Check Vulkan availability
  ipcMain.handle('hardware:checkVulkan', async () => {
    if (!hardwareDetection) {
      return { available: false, error: 'Hardware detection not available' };
    }
    try {
      return await hardwareDetection.checkVulkanAvailable();
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  // Clear hardware cache (useful after driver updates)
  ipcMain.handle('hardware:clearCache', () => {
    if (hardwareDetection) {
      hardwareDetection.clearCache();
    }
    return { success: true };
  });

  ipcMain.handle('ollama:status', async () => {
    try {
      const endpoint = store.get('llmEndpoint') || 'http://localhost:11434';
      return await ollamaHelper.getStatus(endpoint);
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:start', async () => {
    try {
      return await ollamaHelper.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:stop', async () => {
    try {
      return await ollamaHelper.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:install', async () => {
    try {
      return await ollamaHelper.install();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Create Ollama model from local GGUF file
  ipcMain.handle('ollama:createFromFile', async (_, { name, path: modelPath }) => {
    const { spawn } = require('child_process');
    const os = require('os');
    
    try {
      // Create a temporary Modelfile
      const modelfilePath = path.join(os.tmpdir(), `Modelfile-${Date.now()}`);
      const modelfileContent = `FROM "${modelPath.replace(/\\/g, '/')}"`;
      
      await fsPromises.writeFile(modelfilePath, modelfileContent, 'utf-8');
      console.log(`[Ollama] Created Modelfile at ${modelfilePath}`);
      console.log(`[Ollama] Creating model "${name}" from ${modelPath}`);
      
      return new Promise((resolve) => {
        const proc = spawn('ollama', ['create', name, '-f', modelfilePath], {
          shell: true,
          env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[Ollama create]', data.toString().trim());
        });
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[Ollama create stderr]', data.toString().trim());
        });
        
        proc.on('close', async (code) => {
          // Clean up Modelfile
          try {
            await fsPromises.unlink(modelfilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            resolve({ 
              success: true, 
              name,
              message: `Model "${name}" created successfully from ${path.basename(modelPath)}`
            });
          } else {
            resolve({ 
              success: false, 
              error: stderr || `ollama create failed with code ${code}`,
              stdout,
              stderr
            });
          }
        });
        
        proc.on('error', (error) => {
          resolve({ 
            success: false, 
            error: `Failed to run ollama: ${error.message}. Make sure Ollama is installed and in your PATH.`
          });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:status', async () => {
    try {
      const endpoint = store.get('imageGenEndpoint');
      return await imageBackendHelper.getStatus(endpoint);
    } catch (error) {
      return { installed: false, running: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:start', async (_, command) => {
    try {
      const cmd = command || store.get('imageBackendStartCommand');
      return await imageBackendHelper.start(cmd);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:stop', async (_, command) => {
    try {
      const cmd = command || store.get('imageBackendStopCommand');
      return await imageBackendHelper.stop(cmd);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('imageBackend:install', async () => {
    try {
      return await imageBackendHelper.openInstallPage();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // NPU / OpenVINO Helper
  // ============================================

  ipcMain.handle('npu:getStatus', async (_, options = {}) => {
    try {
      const npuBridge = getNpuBridge();
      if (!npuBridge?.getStatus) {
        return { error: 'NPU bridge unavailable', setupRequired: true };
      }
      return await npuBridge.getStatus(options || {});
    } catch (error) {
      console.error('Failed to get NPU status:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('npu:startServer', async (_, options = {}) => {
    try {
      const npuBridge = getNpuBridge();
      if (!npuBridge?.startServer) {
        return { success: false, error: 'NPU bridge unavailable', setupRequired: true };
      }
      const result = await npuBridge.startServer(options || {});
      if (result?.success) {
        npuBridge.clearAllCaches?.();
        hardwareDetection.clearCache?.();
      }
      return result;
    } catch (error) {
      console.error('Failed to start NPU server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('npu:stopServer', async () => {
    try {
      const npuBridge = getNpuBridge();
      if (!npuBridge?.stopServer) {
        return { success: false, error: 'NPU bridge unavailable' };
      }
      const result = await npuBridge.stopServer();
      npuBridge.clearAllCaches?.();
      hardwareDetection.clearCache?.();
      return result;
    } catch (error) {
      console.error('Failed to stop NPU server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('npu:setup', async () => {
    try {
      if (typeof npuSetupService.runOpenVinoSetup !== 'function') {
        return { success: false, error: 'NPU setup helper unavailable' };
      }

      const result = await npuSetupService.runOpenVinoSetup(appPath);
      if (result?.success) {
        const npuBridge = getNpuBridge();
        npuBridge?.clearAllCaches?.();
        hardwareDetection.clearCache?.();
      }
      return result;
    } catch (error) {
      console.error('Failed to run OpenVINO setup script:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('npu:autoConfigureModel', async (_, options = {}) => {
    try {
      const npuBridge = getNpuBridge();
      if (!npuBridge?.autoConfigureModel) {
        return { configured: false, error: 'NPU bridge unavailable' };
      }
      return await npuBridge.autoConfigureModel(options || {});
    } catch (error) {
      console.error('Failed to auto-configure NPU model:', error);
      return { configured: false, error: error.message };
    }
  });

  ipcMain.handle('npu:clearCache', async () => {
    try {
      const npuBridge = getNpuBridge();
      npuBridge?.clearAllCaches?.();
      hardwareDetection.clearCache?.();
      return { success: true };
    } catch (error) {
      console.error('Failed to clear NPU cache:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Power Mode
  // ============================================
  
  const powerMode = getPowerMode();

  ipcMain.handle('powerMode:enable', async () => {
    try {
      return await powerMode.enable();
    } catch (error) {
      console.error('Failed to enable power mode:', error);
      return { enabled: false, error: error.message };
    }
  });

  ipcMain.handle('powerMode:disable', async () => {
    try {
      return await powerMode.disable();
    } catch (error) {
      console.error('Failed to disable power mode:', error);
      return { enabled: true, error: error.message };
    }
  });

  ipcMain.handle('powerMode:getStatus', () => {
    return powerMode.getStatus();
  });

  ipcMain.handle('powerMode:getMemoryInfo', () => {
    return powerMode.getMemoryInfo();
  });

  ipcMain.handle('powerMode:suggestModelSize', () => {
    return powerMode.suggestModelSize();
  });

  // ============================================
  // Backend Management (Orchestrator)
  // ============================================
  
  let orchestrator = null;
  if (getOrchestrator) {
    orchestrator = getOrchestrator(store);
    
    // Initialize orchestrator
    orchestrator.initialize().catch(error => {
      console.error('Failed to initialize orchestrator:', error);
    });
  }

  ipcMain.handle('llm:getBackends', async () => {
    if (!orchestrator) {
      return [{ id: 'ollama-cpu', name: 'Ollama (CPU)', available: true, status: 'default' }];
    }
    try {
      return await orchestrator.getAvailableBackends();
    } catch (error) {
      console.error('Failed to get backends:', error);
      return [];
    }
  });

  ipcMain.handle('llm:setBackend', async (_, backendId) => {
    if (!orchestrator) {
      return { error: 'Orchestrator not available' };
    }
    try {
      return await orchestrator.setPreferredBackend(backendId);
    } catch (error) {
      console.error('Failed to set backend:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('llm:getCurrentBackend', () => {
    if (!orchestrator) {
      return { id: 'ollama-cpu', name: 'Ollama (CPU)' };
    }
    return orchestrator.getCurrentBackend();
  });

  ipcMain.handle('llm:getProfile', () => {
    if (!orchestrator) {
      return 'balanced';
    }
    return orchestrator.getProfile();
  });

  ipcMain.handle('llm:setProfile', (_, profile) => {
    if (!orchestrator) {
      return { success: false, error: 'Orchestrator not available' };
    }
    orchestrator.setProfile(profile);
    return { success: true, profile: orchestrator.getProfile() };
  });

  ipcMain.handle('llm:getRecommendation', (_, modelParams) => {
    if (!orchestrator) {
      return [];
    }
    return orchestrator.getRecommendation(modelParams);
  });

  ipcMain.handle('llm:getRuntimeState', async () => {
    const buildDeviceSnapshot = async () => {
      const snapshot = {
        cpu: null,
        memory: null,
        gpus: [],
        npu: null,
      };

      try {
        if (hardwareDetection?.getHardwareStats) {
          const stats = await hardwareDetection.getHardwareStats();
          if (stats?.cpu) {
            snapshot.cpu = {
              usage: Number(stats.cpu.usage || 0),
              temperature: stats.cpu.temperature ?? null,
            };
          }
          if (stats?.memory) {
            snapshot.memory = {
              usagePercent: Number(stats.memory.usagePercent || 0),
              usedGB: Number(stats.memory.used || 0),
              totalGB: Number(stats.memory.total || 0),
            };
          }
          if (Array.isArray(stats?.gpus)) {
            snapshot.gpus = stats.gpus.map((gpu) => ({
              name: gpu.name || 'GPU',
              utilizationGpu: Number(gpu.utilizationGpu || 0),
              utilizationMemory: Number(gpu.utilizationMemory || 0),
              temperature: gpu.temperature ?? null,
              vramUsed: Number(gpu.vramUsed || 0),
              vramTotal: Number(gpu.vramTotal || 0),
              vramPercent: Number(gpu.vramPercent || 0),
              ollamaVramUsed: Number(gpu.ollamaVramUsed || 0),
            }));
          }
          if (stats?.npu) {
            snapshot.npu = {
              detected: Boolean(stats.npu.detected),
              active: Boolean(stats.npu.active),
              serverRunning: Boolean(stats.npu.serverRunning),
              modelLoaded: Boolean(stats.npu.modelLoaded),
              name: stats.npu.name || 'NPU',
              tops: Number(stats.npu.tops || 0),
            };
          }
        }
      } catch (error) {
        console.warn('[IPC] Failed to gather device snapshot:', error.message);
      }

      // Fallback NPU probe if stats did not include it.
      if (!snapshot.npu) {
        try {
          const npuBridge = getNpuBridge();
          if (npuBridge?.getStatus) {
            const npuStatus = await npuBridge.getStatus();
            snapshot.npu = {
              detected: Boolean(npuStatus?.npuAvailable || npuStatus?.detected),
              active: Boolean(npuStatus?.modelLoaded),
              serverRunning: Boolean(npuStatus?.serverRunning),
              modelLoaded: Boolean(npuStatus?.modelLoaded),
              name: npuStatus?.name || 'NPU',
              tops: Number(npuStatus?.tops || 0),
            };
          }
        } catch (error) {
          console.warn('[IPC] Failed to gather NPU status:', error.message);
        }
      }

      return snapshot;
    };

    if (!orchestrator) {
      return {
        profile: 'balanced',
        preferredBackendId: 'auto',
        currentBackend: null,
        queue: { queued: 0, active: 0, lanes: {}, activeJobs: [], metrics: {} },
        fallbackCounters: {},
        recentDecisions: [],
        offloadEvidence: [],
        hardware: { gpuCount: 0, hasNpu: false, cpu: null },
        deviceUtilization: await buildDeviceSnapshot(),
        timestamp: Date.now(),
      };
    }
    const runtime = orchestrator.getRuntimeState();
    return {
      ...runtime,
      deviceUtilization: await buildDeviceSnapshot(),
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('llm:benchmark', async (_, config = {}) => {
    if (!orchestrator) {
      return { ok: false, error: 'Orchestrator not available' };
    }
    try {
      return await orchestrator.benchmark(config || {});
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:embed', async (_, payload = {}) => {
    if (!orchestrator) {
      return { ok: false, vectors: [], error: 'Orchestrator not available' };
    }
    try {
      return await orchestrator.embedTexts(payload.texts || [], payload || {});
    } catch (error) {
      return { ok: false, vectors: [], error: error.message };
    }
  });

  // ============================================
  // Prompt Templates
  // ============================================

  ipcMain.handle('templates:list', (_, workspace) => {
    if (!db) return [];
    try {
      const where = workspace ? "WHERE workspace = ? OR workspace IS NULL OR workspace = ''" : '';
      const params = workspace ? [workspace] : [];
      const result = db.exec(
        `SELECT id, name, content, variables, workspace, category, created_at FROM templates ${where} ORDER BY created_at DESC`,
        params,
      );
      if (!result.length) return [];
      return result[0].values.map(([id, name, content, variables, ws, category, createdAt]) => ({
        id,
        name,
        content,
        variables,
        workspace: ws,
        category,
        created_at: createdAt,
      }));
    } catch (error) {
      console.error('Failed to list templates:', error);
      return [];
    }
  });

  ipcMain.handle('templates:save', (_, template) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const id =
        template.id ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
      const vars =
        typeof template.variables === 'string'
          ? template.variables
          : JSON.stringify(template.variables || []);

      db.run(
        `
        INSERT INTO templates (id, name, content, variables, workspace, category, created_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          content = excluded.content,
          variables = excluded.variables,
          workspace = excluded.workspace,
          category = excluded.category
      `,
        [id, template.name, template.content, vars, template.workspace || null, template.category || null, template.created_at || null],
      );

      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to save template:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('templates:delete', (_, id) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('DELETE FROM templates WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete template:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Model Presets
  // ============================================

  ipcMain.handle('presets:getForModel', (_, { modelName, workspace }) => {
    if (!db) return [];
    try {
      const presetInfo = db.exec('PRAGMA table_info(model_presets)');
      const hasCreatedAt = Array.isArray(presetInfo?.[0]?.values)
        ? presetInfo[0].values.some((row) => row?.[1] === 'created_at')
        : false;

      const orderBy = hasCreatedAt
        ? 'ORDER BY is_default DESC, created_at DESC'
        : 'ORDER BY is_default DESC';

      const result = db.exec(
        `
        SELECT id, model_name, temperature, top_p, top_k, context_length, system_prompt, workspace, is_default
        FROM model_presets
        WHERE model_name = ?
          AND (workspace IS NULL OR workspace = '' OR workspace = ?)
        ${orderBy}
      `,
        [modelName, workspace || null],
      );
      if (!result.length) return [];
      return result[0].values.map(
        ([
          id,
          model_name,
          temperature,
          top_p,
          top_k,
          context_length,
          system_prompt,
          ws,
          is_default,
        ]) => ({
          id,
          model_name,
          temperature,
          top_p,
          top_k,
          context_length,
          system_prompt,
          workspace: ws,
          is_default: !!is_default,
        }),
      );
    } catch (error) {
      console.error('Failed to load model presets:', error);
      return [];
    }
  });

  ipcMain.handle('presets:save', (_, preset) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      const id =
        preset.id ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
      const values = [
        id,
        preset.model_name,
        preset.temperature ?? 0.7,
        preset.top_p ?? 0.9,
        preset.top_k ?? 40,
        preset.context_length || null,
        preset.system_prompt || null,
        preset.workspace || null,
        preset.is_default ? 1 : 0,
      ];

      db.run(
        `
        INSERT INTO model_presets (id, model_name, temperature, top_p, top_k, context_length, system_prompt, workspace, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          model_name = excluded.model_name,
          temperature = excluded.temperature,
          top_p = excluded.top_p,
          top_k = excluded.top_k,
          context_length = excluded.context_length,
          system_prompt = excluded.system_prompt,
          workspace = excluded.workspace,
          is_default = excluded.is_default
      `,
        values,
      );

      saveDatabase();
      return { success: true, id };
    } catch (error) {
      console.error('Failed to save model preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('presets:delete', (_, id) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      db.run('DELETE FROM model_presets WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to delete model preset:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('presets:setDefault', (_, { id, modelName, workspace }) => {
    if (!db) return { success: false, error: 'Database not initialized' };
    try {
      // Clear previous defaults for this model/workspace
      db.run(
        `
        UPDATE model_presets
        SET is_default = 0
        WHERE model_name = ?
          AND (workspace IS NULL OR workspace = '' OR workspace = ?)
      `,
        [modelName, workspace || null],
      );

      db.run('UPDATE model_presets SET is_default = 1 WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (error) {
      console.error('Failed to set default preset:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // Model Download Manager
  // ============================================

  ipcMain.handle('models:browse', async () => {
    const endpoint = store.get('llmEndpoint');
    try {
      const response = await makeRequest(`${endpoint}/api/tags`);
      const models = response.data?.models || [];
      return {
        source: 'ollama',
        models,
      };
    } catch (error) {
      console.error('Failed to browse models:', error);
      return { source: 'ollama', models: [], error: error.message };
    }
  });

  ipcMain.handle('models:hfLookup', async (_, { repo, revision }) => {
    try {
      if (!repo || typeof repo !== 'string') {
        throw new Error('Repository name required');
      }
      const data = await modelDownloader.fetchHuggingFaceRepo(
        repo.trim(),
        revision && typeof revision === 'string' && revision.trim() ? revision.trim() : 'main',
      );
      return { success: true, ...data };
    } catch (error) {
      console.error('Failed to fetch HuggingFace metadata:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:download', async (_, payload = {}) => {
    try {
      const targetDir = resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      switch (payload.type) {
        case 'ollama': {
          const endpoint = store.get('llmEndpoint');
          const modelName = typeof payload.name === 'string' ? payload.name.trim() : '';
          if (!modelName) {
            return { success: false, error: 'Model name is required for Ollama download' };
          }

          const startOllamaDownload = modelDownloader.startOllamaDownload;
          if (typeof startOllamaDownload !== 'function') {
            return {
              success: false,
              error: 'Model downloader unavailable (startOllamaDownload missing)',
            };
          }

          const id = startOllamaDownload(modelName, endpoint);
          return { success: true, id };
        }
        case 'huggingface': {
          const id = modelDownloader.startHuggingFaceDownload({
            repo: payload.repo,
            file: payload.file,
            targetDir,
            revision:
              payload.revision && typeof payload.revision === 'string' && payload.revision.trim()
                ? payload.revision.trim()
                : 'main',
          });
          return { success: true, id };
        }
        case 'url': {
          const id = modelDownloader.startCustomDownload({
            url: payload.url,
            fileName: payload.fileName,
            targetDir,
            checksum: payload.checksum,
            checksumAlgorithm: payload.checksumAlgorithm,
          });
          return { success: true, id };
        }
        default:
          return { success: false, error: 'Unsupported download type' };
      }
    } catch (error) {
      console.error('Failed to start model download:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:cancelDownload', async (_, id) => {
    try {
      return modelDownloader.cancelDownload(id);
    } catch (error) {
      console.error('Failed to cancel model download:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:getDownloadProgress', () => {
    try {
      return modelDownloader.getDownloads();
    } catch (error) {
      console.error('Failed to get model download progress:', error);
      return [];
    }
  });

  // ============================================
  // Model Manager
  // ============================================
  
  const modelManager = getModelManager({
    modelsDirectory: store.get('modelsDirectory'),
  });
  const modelConverter = createModelConverter(store, appPath);

  const resolveModelsDirectory = () => {
    let dir = store.get('modelsDirectory');
    if (!dir) {
      dir = path.join(app.getPath('documents'), 'DevForge', 'models');
      store.set('modelsDirectory', dir);
      modelManager.setModelsDirectory(dir);
    }
    return dir;
  };

  const ollamaHelperFactory = getOllamaHelperFactory();
  const ollamaHelper = ollamaHelperFactory ? ollamaHelperFactory({ store, shell, makeRequest }) : null;
  
  const imageBackendHelperFactory = getImageBackendHelperFactory();
  const imageBackendHelper = imageBackendHelperFactory ? imageBackendHelperFactory({ shell, makeRequest, store }) : null;

  ipcMain.handle('models:scan', async (_, directory) => {
    const scanDirectory = directory || resolveModelsDirectory();
    if (scanDirectory) {
      modelManager.setModelsDirectory(scanDirectory);
    }
    return await modelManager.scanDirectory(scanDirectory);
  });

  ipcMain.handle('models:getAll', () => {
    return modelManager.getModels();
  });

  ipcMain.handle('models:getByFormat', (_, format) => {
    return modelManager.getModelsByFormat(format);
  });

  ipcMain.handle('models:getForBackend', (_, backendId) => {
    return modelManager.getModelsForBackend(backendId);
  });

  ipcMain.handle('models:getStats', () => {
    return modelManager.getStatistics();
  });

  ipcMain.handle('models:delete', async (_, modelId) => {
    return await modelManager.deleteModel(modelId);
  });

  ipcMain.handle('models:import', async (_, sourcePath, options) => {
    return await modelManager.importModel(sourcePath, options);
  });

  ipcMain.handle('models:convert', async (_, payload = {}) => {
    try {
      const result = await modelConverter.convert(payload);
      if (result?.outputPath) {
        await modelManager.scanDirectory(path.dirname(result.outputPath));
      }
      return result;
    } catch (error) {
      console.error('Failed to convert model:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:recommend', (_, model, availableBackends) => {
    return modelManager.recommendBackend(model, availableBackends);
  });

  // System-wide model scanning
  ipcMain.handle('models:scanSystem', async (_, options) => {
    return await modelManager.scanSystem(options);
  });

  ipcMain.handle('models:getCommonLocations', () => {
    return modelManager.getCommonLocations();
  });

  ipcMain.handle('models:getReferencedModels', async () => {
    return await modelManager.getReferencedModels();
  });

  ipcMain.handle('models:bulkImport', async (_, modelPaths, options) => {
    return await modelManager.bulkImport(modelPaths, options);
  });

  ipcMain.handle('models:getDiskSpace', async () => {
    if (!modelManager.modelsDirectory) {
      const dir = resolveModelsDirectory();
      if (dir) {
        modelManager.setModelsDirectory(dir);
      }
    }
    return await modelManager.getDiskSpace();
  });

  ipcMain.handle('models:setDirectory', async (_, directory) => {
    modelManager.setModelsDirectory(directory);
    store.set('modelsDirectory', directory);
    return { success: true, directory };
  });

  ipcMain.handle('models:browseForDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Models Directory'
    });
    
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    
    const directory = result.filePaths[0];
    modelManager.setModelsDirectory(directory);
    store.set('modelsDirectory', directory);
    
    return { success: true, directory };
  });

  ipcMain.handle('models:browseForFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Model Files to Import',
      filters: [
        { name: 'AI Models', extensions: ['gguf', 'onnx', 'safetensors', 'pt', 'pth', 'bin'] },
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'ONNX Models', extensions: ['onnx'] },
        { name: 'SafeTensors', extensions: ['safetensors'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }
    
    return { success: true, files: result.filePaths };
  });

  ipcMain.handle('models:openInExplorer', async (_, filePath) => {
    try {
      await shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Scan LM Studio models folder
  ipcMain.handle('models:scanLMStudio', async () => {
    const os = require('os');
    const homeDir = os.homedir();
    const lmStudioPaths = [
      path.join(homeDir, '.lmstudio', 'models'),
      path.join(homeDir, '.cache', 'lm-studio', 'models'),
      // Windows AppData
      path.join(process.env.LOCALAPPDATA || '', 'LM-Studio', 'models'),
    ];

    const models = [];
    const scannedPaths = [];

    for (const basePath of lmStudioPaths) {
      try {
        if (!fs.existsSync(basePath)) continue;
        scannedPaths.push(basePath);
        
        // Recursively find all .gguf files
        const findGgufFiles = (dir, depth = 0) => {
          if (depth > 5) return; // Limit recursion
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findGgufFiles(fullPath, depth + 1);
              } else if (entry.isFile() && entry.name.endsWith('.gguf')) {
                const stats = fs.statSync(fullPath);
                models.push({
                  name: entry.name,
                  path: fullPath,
                  size: stats.size,
                  sizeFormatted: formatFileSize(stats.size),
                  source: 'lm-studio',
                  parentFolder: path.basename(path.dirname(fullPath)),
                });
              }
            }
          } catch (e) {
            // Skip inaccessible directories
          }
        };
        
        findGgufFiles(basePath);
      } catch (error) {
        console.error(`Failed to scan LM Studio path ${basePath}:`, error);
      }
    }

    // Deduplicate by path
    const seen = new Set();
    const uniqueModels = models.filter(m => {
      if (seen.has(m.path)) return false;
      seen.add(m.path);
      return true;
    });

    return { 
      models: uniqueModels, 
      scannedPaths,
      count: uniqueModels.length 
    };
  });

  // ============================================
  // MODEL PROVIDERS - Unified Multi-Provider API
  // ============================================
  
  const { getModelProviders } = require('./services/model-providers');
  const { getHuggingFaceBrowser } = require('./services/huggingface-browser');
  const modelProviders = getModelProviders();
  const hfBrowser = getHuggingFaceBrowser();
  
  // Forward HF download progress events to renderer
  hfBrowser.on('download:progress', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', progress);
  });
  hfBrowser.on('download:completed', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', { ...progress, status: 'completed' });
  });
  hfBrowser.on('download:error', (progress) => {
    mainWindow.webContents.send('hf:downloadProgress', { ...progress, status: 'error' });
  });
  
  // --- Provider Search & Browse ---
  
  ipcMain.handle('providers:searchAll', async (_, query, options) => {
    try {
      return await modelProviders.searchAll(query, options);
    } catch (error) {
      console.error('Failed to search providers:', error);
      return { ollama: [], huggingface: [], civitai: [], error: error.message };
    }
  });
  
  ipcMain.handle('providers:getOllamaModels', async (_, category) => {
    try {
      return await modelProviders.getOllamaModels(category);
    } catch (error) {
      console.error('Failed to get Ollama models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getImageModels', async (_, category) => {
    try {
      return await modelProviders.getImageModels(category);
    } catch (error) {
      console.error('Failed to get image models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getVisionModels', async () => {
    try {
      return await modelProviders.getVisionModels();
    } catch (error) {
      console.error('Failed to get vision models:', error);
      return [];
    }
  });
  
  ipcMain.handle('providers:getAudioModels', async () => {
    // Placeholder for future audio model support
    return [];
  });
  
  ipcMain.handle('providers:getVideoModels', async () => {
    // Placeholder for future video model support
    return [];
  });
  
  ipcMain.handle('providers:getEmbeddingModels', async () => {
    // Placeholder for future embedding model support
    return [];
  });
  
  ipcMain.handle('providers:getNSFWModels', async (_, type) => {
    try {
      // This returns NSFW models - only accessible from Private workspace
      const vaultModels = await modelProviders.getPrivateVaultModels();
      if (type && type !== 'all') {
        return vaultModels[type] || [];
      }
      return vaultModels;
    } catch (error) {
      console.error('Failed to get NSFW models:', error);
      return {};
    }
  });
  
  ipcMain.handle('providers:getAllCategories', async () => {
    try {
      return modelProviders.getAllCategories();
    } catch (error) {
      console.error('Failed to get categories:', error);
      return {};
    }
  });
  
  ipcMain.handle('providers:getFeatured', async () => {
    try {
      return await modelProviders.getFeaturedModels();
    } catch (error) {
      console.error('Failed to get featured models:', error);
      return { llm: { ollama: [], huggingface: [] }, vision: [], image: [] };
    }
  });
  
  ipcMain.handle('providers:getRecommendations', async (_, vramGB, ramGB) => {
    try {
      return modelProviders.getHardwareRecommendations(vramGB, ramGB);
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      return { llm: [], vision: [], image: [] };
    }
  });
  
  ipcMain.handle('providers:getPrivateVaultModels', async () => {
    try {
      return await modelProviders.getPrivateVaultModels();
    } catch (error) {
      console.error('Failed to get Private Vault models:', error);
      return { text: [], vision: [], image: [], audio: [], multimodal: [] };
    }
  });
  
  // --- Provider Downloads ---
  
  ipcMain.handle('providers:pullOllamaModel', async (_, modelName) => {
    try {
      const normalizedModelName =
        typeof modelName === 'string' ? modelName.trim() : String(modelName ?? '').trim();
      if (!normalizedModelName) {
        return { success: false, error: 'Model name is required' };
      }

      const endpoint = store.get('llmEndpoint') || 'http://localhost:11434';
      
      // Generate a V2-compatible job ID
      const jobId = `ollama-${normalizedModelName.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      let jobCreated = false;

      const toFiniteNumber = (value, fallback = 0) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };

      const toSafePullProgress = (download) => ({
        id: String(download?.id || jobId),
        model: normalizedModelName,
        name: String(download?.name || normalizedModelName),
        filename: normalizedModelName,
        status: String(download?.status || 'queued'),
        progress: toFiniteNumber(download?.progress, 0),
        totalBytes: toFiniteNumber(download?.totalBytes, 0),
        downloadedBytes: toFiniteNumber(download?.downloadedBytes, 0),
        speed: toFiniteNumber(download?.speed, 0),
        error: download?.error ? String(download.error) : null,
        startedAt: download?.startedAt ? String(download.startedAt) : null,
        updatedAt: download?.updatedAt ? String(download.updatedAt) : null,
        statusMessage: download?.statusMessage ? String(download.statusMessage) : null,
        digest: download?.digest ? String(download.digest) : null,
      });
      
      // Callback for progress updates
      const onProgress = (download) => {
        const safeDownload = toSafePullProgress(download);

        // Create a V2-compatible job object
        const job = {
          id: jobId,
          name: normalizedModelName,
          url: `ollama://pull/${normalizedModelName}`,
          destinationDir: 'ollama',
          filename: normalizedModelName,
          status: safeDownload.status === 'downloading' ? 'downloading' : 
                  safeDownload.status === 'completed' ? 'completed' :
                  safeDownload.status === 'error' ? 'error' :
                  safeDownload.status === 'cancelled' ? 'cancelled' : 'queued',
          priority: 0,
          totalBytes: safeDownload.totalBytes || 0,
          downloadedBytes: safeDownload.downloadedBytes || 0,
          progress: safeDownload.progress || 0,
          speed: safeDownload.speed || 0,
          provider: 'ollama',
          modelType: 'llm',
          lastError: safeDownload.error || null,
          retryCount: 0,
          createdAt: safeDownload.startedAt,
          startedAt: safeDownload.startedAt,
          completedAt: safeDownload.status === 'completed' ? new Date().toISOString() : null,
          metadata: {
            statusMessage: safeDownload.statusMessage,
            digest: safeDownload.digest,
          },
        };
        
        // Emit V2-style events for DownloadCenter
        if (!jobCreated) {
          emitRendererEvent('downloads:jobCreated', job, 'Provider Downloads');
          emitRendererEvent('downloads:jobStarted', job, 'Provider Downloads');
          jobCreated = true;
        }
        
        // Send progress update
        emitRendererEvent('downloads:jobProgress', job, 'Provider Downloads');
        emitRendererEvent('providers:pullProgress', safeDownload, 'Provider Downloads');
        
        // Send completion/error events
        if (safeDownload.status === 'completed') {
          emitRendererEvent('downloads:jobCompleted', job, 'Provider Downloads');
        } else if (safeDownload.status === 'error') {
          emitRendererEvent('downloads:jobError', job, 'Provider Downloads');
        } else if (safeDownload.status === 'cancelled') {
          emitRendererEvent('downloads:jobCancelled', job, 'Provider Downloads');
        }
      };
      
      const startOllamaDownload = modelDownloader.startOllamaDownload;
      if (typeof startOllamaDownload !== 'function') {
        return {
          success: false,
          error: 'Model downloader unavailable (startOllamaDownload missing)',
        };
      }

      const downloadId = startOllamaDownload(normalizedModelName, endpoint, onProgress);
      
      return { success: true, downloadId, jobId };
    } catch (error) {
      console.error('Failed to pull Ollama model:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('providers:downloadModel', async (_, modelData) => {
    try {
      const targetDir = resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      let downloadId;
      
      if (modelData.source === 'huggingface' || modelData.downloadUrl?.includes('huggingface.co')) {
        const startHuggingFaceDownload = modelDownloader.startHuggingFaceDownload;
        if (typeof startHuggingFaceDownload !== 'function') {
          return {
            success: false,
            error: 'Model downloader unavailable (startHuggingFaceDownload missing)',
          };
        }

        // HuggingFace download
        downloadId = startHuggingFaceDownload({
          repo: modelData.repo || modelData.modelId,
          file: modelData.file || modelData.filename,
          targetDir,
          revision: modelData.revision || 'main',
        });
      } else if (modelData.source === 'civitai' || modelData.civitaiUrl) {
        const startCustomDownload = modelDownloader.startCustomDownload;
        if (typeof startCustomDownload !== 'function') {
          return {
            success: false,
            error: 'Model downloader unavailable (startCustomDownload missing)',
          };
        }

        // CivitAI download - use custom URL
        downloadId = startCustomDownload({
          url: modelData.downloadUrl || modelData.civitaiUrl,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      } else {
        // Generic URL download
        downloadId = modelDownloader.startCustomDownload({
          url: modelData.downloadUrl || modelData.url,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      }
      
      // Send progress updates
      const progressInterval = setInterval(() => {
        const downloads = modelDownloader.getDownloads();
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
          emitRendererEvent('providers:downloadProgress', download, 'Provider Downloads');
          if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
            clearInterval(progressInterval);
          }
        }
      }, 500);
      
      return { success: true, downloadId };
    } catch (error) {
      console.error('Failed to download model:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('providers:downloadNsfwModel', async (_, modelData) => {
    // Same as downloadModel but for NSFW content - could add additional logging/tracking
    try {
      const targetDir = path.join(resolveModelsDirectory(), 'nsfw');
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      let downloadId;
      
      if (modelData.source === 'huggingface' || modelData.downloadUrl?.includes('huggingface.co')) {
        downloadId = modelDownloader.startHuggingFaceDownload({
          repo: modelData.repo || modelData.modelId,
          file: modelData.file || modelData.filename,
          targetDir,
          revision: modelData.revision || 'main',
        });
      } else {
        downloadId = modelDownloader.startCustomDownload({
          url: modelData.downloadUrl || modelData.civitaiUrl || modelData.url,
          fileName: modelData.filename || modelData.name,
          targetDir,
          checksum: modelData.checksum,
          checksumAlgorithm: modelData.checksumAlgorithm || 'sha256',
        });
      }
      
      // Send progress updates
      const progressInterval = setInterval(() => {
        const downloads = modelDownloader.getDownloads();
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
          emitRendererEvent('providers:downloadProgress', download, 'Provider Downloads');
          if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
            clearInterval(progressInterval);
          }
        }
      }, 500);
      
      return { success: true, downloadId };
    } catch (error) {
      console.error('Failed to download NSFW model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // HUGGINGFACE BROWSER - Dedicated HF API
  // ============================================
  
  ipcMain.handle('hf:search', async (_, query, options) => {
    try {
      return await hfBrowser.searchModels(query, options);
    } catch (error) {
      console.error('HF search failed:', error);
      return [];
    }
  });

  ipcMain.handle('hf:searchPage', async (_, query, options) => {
    try {
      return await hfBrowser.searchModelsPage(query, options);
    } catch (error) {
      console.error('HF searchPage failed:', error);
      return {
        models: [],
        nextCursor: null,
        hasMore: false,
        fetchedAt: new Date().toISOString(),
      };
    }
  });
  
  ipcMain.handle('hf:getModelDetails', async (_, modelId) => {
    try {
      return await hfBrowser.getModelDetails(modelId);
    } catch (error) {
      console.error('HF getModelDetails failed:', error);
      return null;
    }
  });
  
  ipcMain.handle('hf:getModelFiles', async (_, modelId, options = {}) => {
    try {
      return await hfBrowser.getModelFiles(modelId, options || {});
    } catch (error) {
      console.error('HF getModelFiles failed:', error);
      return options?.includeAll
        ? { allFiles: [], ggufFiles: [], fileStats: null }
        : [];
    }
  });
  
  ipcMain.handle('hf:getCollections', async () => {
    try {
      return hfBrowser.getCollections();
    } catch (error) {
      console.error('HF getCollections failed:', error);
      return {};
    }
  });
  
  ipcMain.handle('hf:getCollectionModels', async (_, collectionId) => {
    try {
      return await hfBrowser.getCollectionModels(collectionId);
    } catch (error) {
      console.error('HF getCollectionModels failed:', error);
      return { models: [] };
    }
  });
  
  ipcMain.handle('hf:getQuantizationGuide', async () => {
    try {
      return hfBrowser.getQuantizationGuide();
    } catch (error) {
      console.error('HF getQuantizationGuide failed:', error);
      return {};
    }
  });
  
  ipcMain.handle('hf:getTrending', async (_, limit) => {
    try {
      return await hfBrowser.getTrendingModels(limit);
    } catch (error) {
      console.error('HF getTrending failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:getRecent', async (_, limit) => {
    try {
      return await hfBrowser.getRecentModels(limit);
    } catch (error) {
      console.error('HF getRecent failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:compareModels', async (_, modelIds) => {
    try {
      return await hfBrowser.compareModels(modelIds);
    } catch (error) {
      console.error('HF compareModels failed:', error);
      return { models: [], comparison: {} };
    }
  });
  
  ipcMain.handle('hf:recommendForHardware', async (_, vramGB, ramGB) => {
    try {
      return await hfBrowser.recommendForHardware(vramGB, ramGB);
    } catch (error) {
      console.error('HF recommendForHardware failed:', error);
      return { models: [] };
    }
  });
  
  ipcMain.handle('hf:downloadModel', async (_, fileInfo, destDir) => {
    try {
      const targetDir = destDir || resolveModelsDirectory();
      await fsPromises.mkdir(targetDir, { recursive: true });
      
      const download = await hfBrowser.downloadModel(fileInfo, targetDir, (progress) => {
        mainWindow.webContents.send('hf:downloadProgress', progress);
      });
      
      return { success: true, download };
    } catch (error) {
      console.error('HF download failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:cancelDownload', async (_, downloadId) => {
    try {
      const cancelled = hfBrowser.cancelDownload(downloadId);
      return { success: cancelled };
    } catch (error) {
      console.error('HF cancelDownload failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:getDownloads', async () => {
    try {
      return hfBrowser.getDownloads();
    } catch (error) {
      console.error('HF getDownloads failed:', error);
      return [];
    }
  });
  
  ipcMain.handle('hf:clearCache', async () => {
    try {
      hfBrowser.clearCache();
      return { success: true };
    } catch (error) {
      console.error('HF clearCache failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:importToOllama', async (_, filePath, modelName) => {
    try {
      // Use the existing ollama:createFromFile handler logic
      const { spawn } = require('child_process');
      const os = require('os');
      
      const modelfilePath = path.join(os.tmpdir(), `Modelfile-${Date.now()}`);
      const modelfileContent = `FROM "${filePath.replace(/\\/g, '/')}"`;
      
      await fsPromises.writeFile(modelfilePath, modelfileContent, 'utf-8');
      console.log(`[HF Import] Created Modelfile at ${modelfilePath}`);
      console.log(`[HF Import] Creating model "${modelName}" from ${filePath}`);
      
      return new Promise((resolve) => {
        const proc = spawn('ollama', ['create', modelName, '-f', modelfilePath], {
          shell: true,
          env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[HF Import]', data.toString().trim());
        });
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[HF Import stderr]', data.toString().trim());
        });
        
        proc.on('close', async (code) => {
          try {
            await fsPromises.unlink(modelfilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code === 0) {
            resolve({ 
              success: true, 
              name: modelName,
              message: `Model "${modelName}" imported successfully from ${path.basename(filePath)}`
            });
          } else {
            resolve({ 
              success: false, 
              error: stderr || `ollama create failed with code ${code}`,
              stdout,
              stderr
            });
          }
        });
        
        proc.on('error', (error) => {
          resolve({ 
            success: false, 
            error: `Failed to run ollama: ${error.message}. Make sure Ollama is installed and in your PATH.`
          });
        });
      });
    } catch (error) {
      console.error('HF importToOllama failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('hf:getDefaultDownloadDir', async () => {
    try {
      return resolveModelsDirectory();
    } catch (error) {
      console.error('HF getDefaultDownloadDir failed:', error);
      return null;
    }
  });
  
  ipcMain.handle('hf:selectDownloadDir', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Download Directory'
      });
      
      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true };
      }
      
      return { success: true, directory: result.filePaths[0] };
    } catch (error) {
      console.error('HF selectDownloadDir failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // DOWNLOADS QUEUE - Unified Download Management
  // ============================================
  
  ipcMain.handle('downloads:getAll', async () => {
    try {
      // Combine downloads from all sources
      const modelDownloads = modelDownloader.getDownloads();
      const hfDownloads = hfBrowser.getDownloads();
      return [...modelDownloads, ...hfDownloads];
    } catch (error) {
      console.error('Failed to get downloads:', error);
      return [];
    }
  });
  
  ipcMain.handle('downloads:cancel', async (_, downloadId) => {
    try {
      // Try both download managers
      let result = modelDownloader.cancelDownload(downloadId);
      if (!result.success) {
        result = { success: hfBrowser.cancelDownload(downloadId) };
      }
      return result;
    } catch (error) {
      console.error('Failed to cancel download:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ============================================
  // DOWNLOAD MANAGER V2 - Persistent + Resumable
  // ============================================
  
  const { getDownloadManagerV2 } = require('./services/download-manager-v2');
  const downloadManagerV2 = getDownloadManagerV2();
  
  // Initialize DownloadManagerV2 after database is ready
  downloadManagerV2.initialize(userDataPath).then(() => {
    console.log('[IPC] DownloadManagerV2 initialized');
    
    // Forward events to renderer
    downloadManagerV2.on('job:created', (job) => {
      mainWindow.webContents.send('downloads:jobCreated', job);
    });
    downloadManagerV2.on('job:started', (job) => {
      mainWindow.webContents.send('downloads:jobStarted', job);
    });
    downloadManagerV2.on('job:progress', (job) => {
      mainWindow.webContents.send('downloads:jobProgress', job);
    });
    downloadManagerV2.on('job:completed', (job) => {
      mainWindow.webContents.send('downloads:jobCompleted', job);
    });
    downloadManagerV2.on('job:error', (job) => {
      mainWindow.webContents.send('downloads:jobError', job);
    });
    downloadManagerV2.on('job:paused', (job) => {
      mainWindow.webContents.send('downloads:jobPaused', job);
    });
    downloadManagerV2.on('job:cancelled', (job) => {
      mainWindow.webContents.send('downloads:jobCancelled', job);
    });
  }).catch((error) => {
    console.error('[IPC] Failed to initialize DownloadManagerV2:', error);
  });
  
  // Create a new download job via V2
  ipcMain.handle('downloads:create', async (_, options) => {
    try {
      const id = await downloadManagerV2.create(options);
      return { success: true, id };
    } catch (error) {
      console.error('Failed to create download:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get all V2 jobs
  ipcMain.handle('downloads:getAllV2', async () => {
    try {
      return downloadManagerV2.getAll();
    } catch (error) {
      console.error('Failed to get V2 downloads:', error);
      return [];
    }
  });
  
  // Get a specific V2 job
  ipcMain.handle('downloads:getV2', async (_, id) => {
    try {
      return downloadManagerV2.get(id);
    } catch (error) {
      console.error('Failed to get V2 download:', error);
      return null;
    }
  });
  
  ipcMain.handle('downloads:pause', async (_, downloadId) => {
    try {
      return downloadManagerV2.pause(downloadId);
    } catch (error) {
      console.error('Failed to pause download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:resume', async (_, downloadId) => {
    try {
      return downloadManagerV2.resume(downloadId);
    } catch (error) {
      console.error('Failed to resume download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:retry', async (_, downloadId) => {
    try {
      return downloadManagerV2.retry(downloadId);
    } catch (error) {
      console.error('Failed to retry download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:setPriority', async (_, downloadId, priority) => {
    try {
      return downloadManagerV2.setPriority(downloadId, priority);
    } catch (error) {
      console.error('Failed to set priority:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:schedule', async (_, downloadId, scheduleTime) => {
    try {
      return downloadManagerV2.schedule(downloadId, scheduleTime);
    } catch (error) {
      console.error('Failed to schedule download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:delete', async (_, downloadId, deleteFiles) => {
    try {
      return await downloadManagerV2.delete(downloadId, deleteFiles);
    } catch (error) {
      console.error('Failed to delete download:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('downloads:clearCompleted', async () => {
    try {
      return await downloadManagerV2.clearCompleted();
    } catch (error) {
      console.error('Failed to clear completed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // INSTALLER REGISTRY - Model Installation
  // ============================================
  
  const { getInstallerRegistry } = require('./services/installer-registry');
  const installerRegistry = getInstallerRegistry();
  
  // Initialize installer registry
  installerRegistry.initialize({
    ollamaEndpoint: store.get('llmEndpoint') || 'http://localhost:11434',
    comfyuiPath: store.get('comfyuiPath'),
    a1111Path: store.get('a1111Path'),
    llamacppPath: store.get('llamacppPath'),
  }).then(() => {
    console.log('[IPC] InstallerRegistry initialized');
    
    // Forward events to renderer
    installerRegistry.on('install:started', (data) => {
      mainWindow.webContents.send('installer:started', data);
    });
    installerRegistry.on('install:progress', (data) => {
      mainWindow.webContents.send('installer:progress', data);
    });
    installerRegistry.on('install:completed', (data) => {
      mainWindow.webContents.send('installer:completed', data);
    });
    installerRegistry.on('install:dependencies-required', (data) => {
      mainWindow.webContents.send('installer:dependenciesRequired', data);
    });
    installerRegistry.on('uninstall:started', (data) => {
      mainWindow.webContents.send('installer:uninstallStarted', data);
    });
    installerRegistry.on('uninstall:completed', (data) => {
      mainWindow.webContents.send('installer:uninstallCompleted', data);
    });
  }).catch((error) => {
    console.error('[IPC] Failed to initialize InstallerRegistry:', error);
  });
  
  // Get available engines
  ipcMain.handle('installer:getEngines', async () => {
    return installerRegistry.getEnginesInfo();
  });
  
  // Get engines compatible with a model type
  ipcMain.handle('installer:getEnginesForType', async (_, modelType) => {
    return installerRegistry.getEnginesForModelType(modelType);
  });
  
  // Get recommended engine for a model
  ipcMain.handle('installer:getRecommendedEngine', async (_, modelInfo) => {
    return installerRegistry.getRecommendedEngine(modelInfo);
  });
  
  // Install a model
  ipcMain.handle('installer:install', async (_, { filePath, modelInfo, options }) => {
    try {
      const result = await installerRegistry.install(filePath, modelInfo, options);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to install model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Validate an installed model
  ipcMain.handle('installer:validate', async (_, { modelInfo, engineId }) => {
    return installerRegistry.validate(modelInfo, engineId);
  });
  
  // Run readiness check
  ipcMain.handle('installer:readinessCheck', async (_, { modelInfo, engineId }) => {
    return installerRegistry.readinessCheck(modelInfo, engineId);
  });
  
  // Uninstall a model
  ipcMain.handle('installer:uninstall', async (_, { modelInfo, engineId }) => {
    try {
      const result = await installerRegistry.uninstall(modelInfo, engineId);
      return result;
    } catch (error) {
      console.error('Failed to uninstall model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Set engine path
  ipcMain.handle('installer:setEnginePath', async (_, { engineId, path: enginePath }) => {
    store.set(`${engineId}Path`, enginePath);
    // Re-initialize to detect new engine
    await installerRegistry.initialize({
      ollamaEndpoint: store.get('llmEndpoint') || 'http://localhost:11434',
      comfyuiPath: store.get('comfyuiPath'),
      a1111Path: store.get('a1111Path'),
      llamacppPath: store.get('llamacppPath'),
    });
    return { success: true };
  });

  // ============================================
  // LOCAL MODEL SCANNER
  // ============================================
  
  const { getLocalModelScanner } = require('./services/local-model-scanner');
  const localModelScanner = getLocalModelScanner();
  
  // Forward scanner events to renderer
  localModelScanner.on('scan:started', () => {
    mainWindow.webContents.send('scanner:started');
  });
  localModelScanner.on('scan:source', (data) => {
    mainWindow.webContents.send('scanner:source', data);
  });
  localModelScanner.on('scan:completed', (data) => {
    mainWindow.webContents.send('scanner:completed', data);
  });
  localModelScanner.on('model:discovered', (model) => {
    mainWindow.webContents.send('scanner:modelDiscovered', model);
  });
  localModelScanner.on('model:changed', (data) => {
    mainWindow.webContents.send('scanner:modelChanged', data);
  });
  
  // Get all configured sources
  ipcMain.handle('scanner:getSources', async () => {
    return localModelScanner.getSources();
  });
  
  // Scan all sources
  ipcMain.handle('scanner:scanAll', async (_, options) => {
    return localModelScanner.scanAll(options);
  });
  
  // Get all discovered models
  ipcMain.handle('scanner:getAllModels', async () => {
    return localModelScanner.getAllModels();
  });
  
  // Get models by source
  ipcMain.handle('scanner:getBySource', async (_, sourceId) => {
    return localModelScanner.getModelsBySource(sourceId);
  });
  
  // Get models by type
  ipcMain.handle('scanner:getByType', async (_, modelType) => {
    return localModelScanner.getModelsByType(modelType);
  });
  
  // Get specific model
  ipcMain.handle('scanner:getModel', async (_, modelPath) => {
    return localModelScanner.getModel(modelPath);
  });
  
  // Add custom scan path
  ipcMain.handle('scanner:addCustomPath', async (_, { path: scanPath, options }) => {
    localModelScanner.addCustomPath(scanPath, options);
    
    // Save to settings
    const customPaths = store.get('scannerCustomPaths') || [];
    customPaths.push({ path: scanPath, ...options });
    store.set('scannerCustomPaths', customPaths);
    
    return { success: true };
  });
  
  // Remove custom scan path
  ipcMain.handle('scanner:removeCustomPath', async (_, scanPath) => {
    localModelScanner.removeCustomPath(scanPath);
    
    // Remove from settings
    const customPaths = store.get('scannerCustomPaths') || [];
    store.set('scannerCustomPaths', customPaths.filter(p => p.path !== scanPath));
    
    return { success: true };
  });
  
  // Import model (copy)
  ipcMain.handle('scanner:importModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.importModel(modelPath, modelsDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('scanner:importProgress', { modelPath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to import model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Link model (symlink)
  ipcMain.handle('scanner:linkModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.linkModel(modelPath, modelsDir);
      return result;
    } catch (error) {
      console.error('Failed to link model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Move model
  ipcMain.handle('scanner:moveModel', async (_, { modelPath, targetDir }) => {
    try {
      const modelsDir = targetDir || resolveModelsDirectory();
      const result = await localModelScanner.moveModel(modelPath, modelsDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('scanner:moveProgress', { modelPath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to move model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Start watching for changes
  ipcMain.handle('scanner:startWatching', async (_, sourceId) => {
    localModelScanner.startWatching(sourceId);
    return { success: true };
  });
  
  // Stop watching
  ipcMain.handle('scanner:stopWatching', async (_, sourceId) => {
    localModelScanner.stopWatching(sourceId);
    return { success: true };
  });
  
  // Clear discovered models
  ipcMain.handle('scanner:clear', async () => {
    localModelScanner.clear();
    return { success: true };
  });
  
  // Load custom paths from settings on startup
  const savedCustomPaths = store.get('scannerCustomPaths') || [];
  for (const customPath of savedCustomPaths) {
    localModelScanner.addCustomPath(customPath.path, customPath);
  }

  // ============================================
  // STORAGE SERVICE
  // ============================================
  
  const { getStorageService } = require('./services/storage-service');
  const storageService = getStorageService();
  
  // Set model directories
  storageService.setModelDirectories([resolveModelsDirectory()]);
  
  // Forward storage events
  storageService.on('model:moved', (data) => {
    mainWindow.webContents.send('storage:modelMoved', data);
  });
  storageService.on('file:deleted', (data) => {
    mainWindow.webContents.send('storage:fileDeleted', data);
  });
  
  // Get available drives
  ipcMain.handle('storage:getDrives', async () => {
    return storageService.getDrives();
  });
  
  // Get model storage usage
  ipcMain.handle('storage:getUsage', async () => {
    return storageService.getModelStorageUsage();
  });
  
  // Get directory breakdown
  ipcMain.handle('storage:getBreakdown', async (_, dirPath) => {
    return storageService.getDirectoryBreakdown(dirPath);
  });
  
  // Find orphaned files
  ipcMain.handle('storage:findOrphaned', async (_, libraryModels) => {
    return storageService.findOrphanedFiles(libraryModels);
  });
  
  // Find duplicates
  ipcMain.handle('storage:findDuplicates', async () => {
    return storageService.findDuplicates();
  });
  
  // Move model
  ipcMain.handle('storage:moveModel', async (_, { sourcePath, targetDir }) => {
    try {
      const result = await storageService.moveModel(sourcePath, targetDir, {
        onProgress: (progress) => {
          mainWindow.webContents.send('storage:moveProgress', { sourcePath, ...progress });
        },
      });
      return result;
    } catch (error) {
      console.error('Failed to move model:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Delete files
  ipcMain.handle('storage:deleteFiles', async (_, filePaths) => {
    return storageService.deleteFiles(filePaths);
  });
  
  // Get recommendations
  ipcMain.handle('storage:getRecommendations', async () => {
    return storageService.getRecommendations();
  });
  
  // Clear cache
  ipcMain.handle('storage:clearCache', async () => {
    storageService.clearCache();
    return { success: true };
  });

  // ============================================
  // HARDWARE CHECKER
  // ============================================
  
  const { getHardwareChecker } = require('./services/hardware-checker');
  const hardwareChecker = getHardwareChecker();
  
  // Get comprehensive hardware info
  ipcMain.handle('hardwareChecker:getInfo', async (_, forceRefresh) => {
    return hardwareChecker.getHardwareInfo(forceRefresh);
  });
  
  // Check if model can run
  ipcMain.handle('hardwareChecker:canRunModel', async (_, modelInfo) => {
    return hardwareChecker.canRunModel(modelInfo);
  });
  
  // Get model recommendations
  ipcMain.handle('hardwareChecker:getRecommendations', async (_, targetSizeB) => {
    const hw = await hardwareChecker.getHardwareInfo();
    return hardwareChecker.getModelRecommendations(hw, targetSizeB);
  });
  
  // Precheck before download
  ipcMain.handle('hardwareChecker:precheck', async (_, modelInfo) => {
    return hardwareChecker.precheck(modelInfo);
  });
  
  // Estimate VRAM needed
  ipcMain.handle('hardwareChecker:estimateVram', async (_, { sizeB, quant }) => {
    return hardwareChecker.estimateVramNeeded(sizeB, quant);
  });

  // ============================================
  // CATALOG SERVICE
  // ============================================
  
  const { getCatalogService } = require('./services/catalog-service');
  const catalogService = getCatalogService();
  
  // Register providers with catalog service
  try {
    const { getModelProviders } = require('./services/model-providers');
    const providers = getModelProviders();
    
    // Create adapter for Ollama provider
    if (providers.ollama) {
      catalogService.registerProvider('ollama', {
        search: async (query, options) => providers.searchAll?.(query, options)?.ollama || [],
        getTrending: async (limit) => providers.getOllamaModels?.('featured')?.slice(0, limit) || [],
        getRecent: async (limit) => providers.getOllamaModels?.('recent')?.slice(0, limit) || [],
        getModelDetails: async (modelId) => providers.ollama?.getModelDetails?.(modelId),
        getCategories: async () => [
          { id: 'llm', name: 'Language Models' },
          { id: 'vision', name: 'Vision Models' },
          { id: 'embedding', name: 'Embeddings' },
        ],
      });
    }
    
    // Create adapter for HuggingFace provider
    if (providers.huggingface) {
      catalogService.registerProvider('huggingface', {
        search: async (query, options) => providers.huggingface?.search?.(query, options) || [],
        getTrending: async (limit) => providers.huggingface?.getTrending?.(limit) || [],
        getRecent: async (limit) => providers.huggingface?.getRecent?.(limit) || [],
        getModelDetails: async (modelId) => providers.huggingface?.getModelDetails?.(modelId),
        getModelFiles: async (modelId) => providers.huggingface?.getModelFiles?.(modelId),
        getCategories: async () => providers.huggingface?.getCategories?.() || [],
      });
    }
    
    // Create adapter for CivitAI provider
    if (providers.civitai) {
      catalogService.registerProvider('civitai', {
        search: async (query, options) => providers.civitai?.search?.(query, options) || [],
        getTrending: async (limit) => providers.civitai?.getTrending?.(limit) || [],
        getRecent: async (limit) => providers.civitai?.getRecent?.(limit) || [],
        getModelDetails: async (modelId) => providers.civitai?.getModelDetails?.(modelId),
        getCategories: async () => [
          { id: 'checkpoint', name: 'Checkpoints' },
          { id: 'lora', name: 'LoRAs' },
          { id: 'controlnet', name: 'ControlNet' },
        ],
      });
    }
    
    console.log('[IPC] CatalogService providers registered');
  } catch (error) {
    console.warn('[IPC] Could not register catalog providers:', error.message);
  }
  
  // Forward catalog events
  catalogService.on('subscription:added', (sub) => {
    mainWindow.webContents.send('catalog:subscriptionAdded', sub);
  });
  catalogService.on('subscription:removed', (sub) => {
    mainWindow.webContents.send('catalog:subscriptionRemoved', sub);
  });
  catalogService.on('subscription:update-available', (data) => {
    mainWindow.webContents.send('catalog:updateAvailable', data);
  });
  
  // Search models
  ipcMain.handle('catalog:search', async (_, query, options) => {
    return catalogService.search(query, options);
  });
  
  // Get trending
  ipcMain.handle('catalog:getTrending', async (_, options) => {
    return catalogService.getTrending(options);
  });
  
  // Get recent
  ipcMain.handle('catalog:getRecent', async (_, options) => {
    return catalogService.getRecent(options);
  });
  
  // Get model details
  ipcMain.handle('catalog:getModelDetails', async (_, provider, modelId) => {
    return catalogService.getModelDetails(provider, modelId);
  });
  
  // Get model files
  ipcMain.handle('catalog:getModelFiles', async (_, provider, modelId) => {
    return catalogService.getModelFiles(provider, modelId);
  });
  
  // Subscribe to updates
  ipcMain.handle('catalog:subscribe', async (_, modelId, provider, installedVersion, options) => {
    return catalogService.subscribe(modelId, provider, installedVersion, options);
  });
  
  // Unsubscribe
  ipcMain.handle('catalog:unsubscribe', async (_, subscriptionId) => {
    return catalogService.unsubscribe(subscriptionId);
  });
  
  // Get subscriptions
  ipcMain.handle('catalog:getSubscriptions', async () => {
    return catalogService.getSubscriptions();
  });
  
  // Check for updates
  ipcMain.handle('catalog:checkUpdates', async () => {
    return catalogService.checkUpdates();
  });
  
  // Get discovery feed
  ipcMain.handle('catalog:getDiscoveryFeed', async (_, options) => {
    return catalogService.getDiscoveryFeed(options);
  });
  
  // Get categories
  ipcMain.handle('catalog:getCategories', async () => {
    return catalogService.getCategories();
  });
  
  // Clear cache
  ipcMain.handle('catalog:clearCache', async (_, pattern) => {
    catalogService.clearCache(pattern);
    return { success: true };
  });
  
  // Get cache stats
  ipcMain.handle('catalog:getCacheStats', async () => {
    return catalogService.getCacheStats();
  });

  // ============================================
  // LIBRARY SERVICE
  // ============================================
  
  const { getLibraryService } = require('./services/library-service');
  const libraryService = getLibraryService();
  
  // Initialize library
  libraryService.initialize(userDataPath).then(() => {
    console.log('[IPC] LibraryService initialized');
  }).catch(error => {
    console.error('[IPC] Failed to initialize LibraryService:', error);
  });
  
  // Forward library events
  libraryService.on('model:added', (model) => {
    mainWindow.webContents.send('library:modelAdded', model);
  });
  libraryService.on('model:updated', (data) => {
    mainWindow.webContents.send('library:modelUpdated', data);
  });
  libraryService.on('model:deleted', (data) => {
    mainWindow.webContents.send('library:modelDeleted', data);
  });
  libraryService.on('collection:created', (collection) => {
    mainWindow.webContents.send('library:collectionCreated', collection);
  });
  libraryService.on('collection:updated', (data) => {
    mainWindow.webContents.send('library:collectionUpdated', data);
  });
  libraryService.on('collection:deleted', (data) => {
    mainWindow.webContents.send('library:collectionDeleted', data);
  });
  
  // Model operations
  ipcMain.handle('library:addModel', async (_, modelData) => {
    return libraryService.addModel(modelData);
  });
  
  ipcMain.handle('library:updateModel', async (_, id, updates) => {
    return libraryService.updateModel(id, updates);
  });
  
  ipcMain.handle('library:deleteModel', async (_, id) => {
    return libraryService.deleteModel(id);
  });
  
  ipcMain.handle('library:getModel', async (_, id) => {
    return libraryService.getModel(id);
  });
  
  ipcMain.handle('library:getModelByPath', async (_, modelPath) => {
    return libraryService.getModelByPath(modelPath);
  });
  
  ipcMain.handle('library:getAllModels', async (_, options) => {
    return libraryService.getAllModels(options);
  });
  
  ipcMain.handle('library:recordUsage', async (_, id, tokens, responseTime) => {
    return libraryService.recordUsage(id, tokens, responseTime);
  });
  
  // Tag operations
  ipcMain.handle('library:getAllTags', async () => {
    return libraryService.getAllTags();
  });
  
  ipcMain.handle('library:addTagToModel', async (_, modelId, tagName) => {
    return libraryService.addTagToModel(modelId, tagName);
  });
  
  ipcMain.handle('library:removeTagFromModel', async (_, modelId, tagName) => {
    return libraryService.removeTagFromModel(modelId, tagName);
  });
  
  // Collection operations
  ipcMain.handle('library:createCollection', async (_, data) => {
    return libraryService.createCollection(data);
  });
  
  ipcMain.handle('library:updateCollection', async (_, id, updates) => {
    return libraryService.updateCollection(id, updates);
  });
  
  ipcMain.handle('library:deleteCollection', async (_, id) => {
    return libraryService.deleteCollection(id);
  });
  
  ipcMain.handle('library:getCollection', async (_, id) => {
    return libraryService.getCollection(id);
  });
  
  ipcMain.handle('library:getAllCollections', async () => {
    return libraryService.getAllCollections();
  });
  
  ipcMain.handle('library:addToCollection', async (_, collectionId, modelId) => {
    return libraryService.addToCollection(collectionId, modelId);
  });
  
  ipcMain.handle('library:removeFromCollection', async (_, collectionId, modelId) => {
    return libraryService.removeFromCollection(collectionId, modelId);
  });
  
  ipcMain.handle('library:getCollectionModels', async (_, collectionId) => {
    return libraryService.getCollectionModels(collectionId);
  });
  
  // Bulk operations
  ipcMain.handle('library:bulkUpdate', async (_, modelIds, updates) => {
    return libraryService.bulkUpdate(modelIds, updates);
  });
  
  ipcMain.handle('library:bulkDelete', async (_, modelIds) => {
    return libraryService.bulkDelete(modelIds);
  });
  
  ipcMain.handle('library:bulkAddToCollection', async (_, collectionId, modelIds) => {
    return libraryService.bulkAddToCollection(collectionId, modelIds);
  });
  
  // Statistics
  ipcMain.handle('library:getStats', async () => {
    return libraryService.getStats();
  });

  // ===========================
  // FORMAT CONVERTER HANDLERS
  // ===========================
  const { getFormatConverter } = require('./services/format-converter');
  const formatConverter = getFormatConverter();
  
  // Initialize converter
  formatConverter.initialize().catch(err => {
    console.error('[FormatConverter] Initialization error:', err);
  });
  
  // Forward converter events
  formatConverter.on('job:created', (job) => {
    mainWindow.webContents.send('converter:jobCreated', job);
  });
  formatConverter.on('job:started', (job) => {
    mainWindow.webContents.send('converter:jobStarted', job);
  });
  formatConverter.on('job:progress', (job) => {
    mainWindow.webContents.send('converter:jobProgress', job);
  });
  formatConverter.on('job:completed', (job) => {
    mainWindow.webContents.send('converter:jobCompleted', job);
  });
  formatConverter.on('job:error', (job) => {
    mainWindow.webContents.send('converter:jobError', job);
  });
  formatConverter.on('job:cancelled', (job) => {
    mainWindow.webContents.send('converter:jobCancelled', job);
  });
  
  // Get supported conversions for a file
  ipcMain.handle('converter:getSupportedConversions', async (_, filePath) => {
    try {
      return formatConverter.getSupportedConversions(filePath);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create a conversion job
  ipcMain.handle('converter:createJob', async (_, type, sourcePath, options) => {
    try {
      return await formatConverter.createJob(type, sourcePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all jobs
  ipcMain.handle('converter:getAllJobs', async () => {
    try {
      return formatConverter.getAllJobs();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get a specific job
  ipcMain.handle('converter:getJob', async (_, jobId) => {
    try {
      return formatConverter.getJob(jobId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Cancel a job
  ipcMain.handle('converter:cancelJob', async (_, jobId) => {
    try {
      return formatConverter.cancelJob(jobId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Clear completed jobs
  ipcMain.handle('converter:clearCompleted', async () => {
    try {
      return formatConverter.clearCompleted();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get available quantization types
  ipcMain.handle('converter:getQuantTypes', async () => {
    try {
      return formatConverter.getQuantTypes();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Estimate conversion time
  ipcMain.handle('converter:estimateTime', async (_, sourcePath, type, options) => {
    try {
      return formatConverter.estimateConversionTime(sourcePath, type, options);
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // COLLECTIONS SERVICE HANDLERS
  // ===========================
  const { getCollectionsService } = require('./services/collections-service');
  const collectionsService = getCollectionsService();
  
  // Initialize collections service
  collectionsService.initialize(db, userDataPath).catch(err => {
    console.error('[CollectionsService] Initialization error:', err);
  });
  
  // Forward collection events
  collectionsService.on('collection:created', (collection) => {
    mainWindow.webContents.send('collections:created', collection);
  });
  collectionsService.on('collection:updated', (data) => {
    mainWindow.webContents.send('collections:updated', data);
  });
  collectionsService.on('collection:deleted', (data) => {
    mainWindow.webContents.send('collections:deleted', data);
  });
  collectionsService.on('collection:imported', (collection) => {
    mainWindow.webContents.send('collections:imported', collection);
  });
  collectionsService.on('collection:installProgress', (data) => {
    mainWindow.webContents.send('collections:installProgress', data);
  });
  
  // Get all collections
  ipcMain.handle('collections:getAll', async (_, options) => {
    try {
      return collectionsService.getAllCollections(options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get starter packs
  ipcMain.handle('collections:getStarterPacks', async () => {
    try {
      return collectionsService.getStarterPacks();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get user collections
  ipcMain.handle('collections:getUserCollections', async () => {
    try {
      return collectionsService.getUserCollections();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get collection by ID
  ipcMain.handle('collections:getById', async (_, collectionId) => {
    try {
      return collectionsService.getCollection(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create collection
  ipcMain.handle('collections:create', async (_, data) => {
    try {
      return collectionsService.createCollection(data);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Update collection
  ipcMain.handle('collections:update', async (_, collectionId, updates) => {
    try {
      return collectionsService.updateCollection(collectionId, updates);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete collection
  ipcMain.handle('collections:delete', async (_, collectionId) => {
    try {
      return collectionsService.deleteCollection(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Add model to collection
  ipcMain.handle('collections:addModel', async (_, collectionId, modelData) => {
    try {
      return collectionsService.addModelToCollection(collectionId, modelData);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Remove model from collection
  ipcMain.handle('collections:removeModel', async (_, collectionId, provider, modelId) => {
    try {
      return collectionsService.removeModelFromCollection(collectionId, provider, modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Export manifest
  ipcMain.handle('collections:exportManifest', async (_, collectionId) => {
    try {
      return await collectionsService.exportManifest(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import manifest
  ipcMain.handle('collections:importManifest', async (_, manifest) => {
    try {
      return await collectionsService.importManifest(manifest);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Generate share code
  ipcMain.handle('collections:generateShareCode', async (_, collectionId) => {
    try {
      return await collectionsService.generateShareCode(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get collection by share code
  ipcMain.handle('collections:getByShareCode', async (_, shareCode) => {
    try {
      return collectionsService.getCollectionByShareCode(shareCode);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get installation status
  ipcMain.handle('collections:getInstallStatus', async (_, collectionId) => {
    try {
      return collectionsService.getInstallationStatus(collectionId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Track installation
  ipcMain.handle('collections:trackInstall', async (_, collectionId, modelsInstalled, modelsTotal) => {
    try {
      collectionsService.trackInstallation(collectionId, modelsInstalled, modelsTotal);
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get categories
  ipcMain.handle('collections:getCategories', async () => {
    try {
      return collectionsService.getCategories();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // MODEL TESTING SERVICE HANDLERS
  // ===========================
  const { getModelTestingService } = require('./services/model-testing-service');
  const modelTestingService = getModelTestingService();
  
  // Initialize testing service
  modelTestingService.initialize(db).catch(err => {
    console.error('[ModelTestingService] Initialization error:', err);
  });
  
  // Forward testing events
  modelTestingService.on('test:started', (data) => {
    mainWindow.webContents.send('testing:started', data);
  });
  modelTestingService.on('test:progress', (data) => {
    mainWindow.webContents.send('testing:progress', data);
  });
  modelTestingService.on('test:completed', (data) => {
    mainWindow.webContents.send('testing:completed', data);
  });
  modelTestingService.on('test:error', (data) => {
    mainWindow.webContents.send('testing:error', data);
  });
  modelTestingService.on('benchmark:started', (data) => {
    mainWindow.webContents.send('testing:benchmarkStarted', data);
  });
  modelTestingService.on('benchmark:progress', (data) => {
    mainWindow.webContents.send('testing:benchmarkProgress', data);
  });
  modelTestingService.on('benchmark:completed', (data) => {
    mainWindow.webContents.send('testing:benchmarkCompleted', data);
  });
  modelTestingService.on('readiness:checked', (data) => {
    mainWindow.webContents.send('testing:readinessChecked', data);
  });
  
  // Get test prompts
  ipcMain.handle('testing:getPrompts', async (_, modelType) => {
    try {
      return modelTestingService.getTestPrompts(modelType);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Run quick test
  ipcMain.handle('testing:runQuickTest', async (_, modelId, provider, prompt, options) => {
    try {
      return await modelTestingService.runQuickTest(modelId, provider, prompt, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Run benchmark
  ipcMain.handle('testing:runBenchmark', async (_, modelId, provider, options) => {
    try {
      return await modelTestingService.runBenchmark(modelId, provider, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check readiness
  ipcMain.handle('testing:checkReadiness', async (_, modelId, provider) => {
    try {
      return await modelTestingService.checkReadiness(modelId, provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get community benchmarks
  ipcMain.handle('testing:getCommunityBenchmarks', async (_, modelId) => {
    try {
      return modelTestingService.getCommunityBenchmarks(modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get local benchmarks
  ipcMain.handle('testing:getLocalBenchmarks', async (_, modelId) => {
    try {
      return modelTestingService.getLocalBenchmarks(modelId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get test history
  ipcMain.handle('testing:getHistory', async (_, modelId, limit) => {
    try {
      return modelTestingService.getTestHistory(modelId, limit);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Cancel test
  ipcMain.handle('testing:cancelTest', async (_, testId) => {
    try {
      return modelTestingService.cancelTest(testId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get active tests
  ipcMain.handle('testing:getActiveTests', async () => {
    try {
      return modelTestingService.getActiveTests();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // EXPORT/BACKUP SERVICE HANDLERS
  // ===========================
  const { getExportBackupService } = require('./services/export-backup-service');
  const exportBackupService = getExportBackupService();
  
  // Initialize export/backup service
  exportBackupService.initialize(db, store, userDataPath).catch(err => {
    console.error('[ExportBackupService] Initialization error:', err);
  });
  
  // Forward events
  exportBackupService.on('export:completed', (data) => {
    mainWindow.webContents.send('backup:exportCompleted', data);
  });
  exportBackupService.on('import:completed', (data) => {
    mainWindow.webContents.send('backup:importCompleted', data);
  });
  exportBackupService.on('backup:created', (data) => {
    mainWindow.webContents.send('backup:created', data);
  });
  
  // Export manifest
  ipcMain.handle('backup:exportManifest', async (_, options) => {
    try {
      return await exportBackupService.exportManifest(options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Export to file
  ipcMain.handle('backup:exportToFile', async (_, filePath, options) => {
    try {
      return await exportBackupService.exportToFile(filePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import manifest
  ipcMain.handle('backup:importManifest', async (_, manifest, options) => {
    try {
      return await exportBackupService.importManifest(manifest, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Import from file
  ipcMain.handle('backup:importFromFile', async (_, filePath, options) => {
    try {
      return await exportBackupService.importFromFile(filePath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Create backup (using exportBackupService - note: backup:create already registered above)
  // Use a different channel name to avoid conflict
  ipcMain.handle('backup:createV2', async (_, name) => {
    try {
      return await exportBackupService.createBackup(name);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // List backups (V2 - uses exportBackupService, original at line ~953 uses backupService)
  ipcMain.handle('backup:listV2', async () => {
    try {
      return await exportBackupService.listBackups();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Restore from backup (V2 - uses exportBackupService, original at line ~929 uses backupService)
  ipcMain.handle('backup:restoreV2', async (_, backupPath, options) => {
    try {
      return await exportBackupService.restoreFromBackup(backupPath, options);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete backup
  ipcMain.handle('backup:delete', async (_, backupPath) => {
    try {
      return await exportBackupService.deleteBackup(backupPath);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get export preview
  ipcMain.handle('backup:getPreview', async () => {
    try {
      return await exportBackupService.getExportPreview();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // SECRETS STORE HANDLERS
  // ===========================
  const { getSecretsStore } = require('./services/secrets-store');
  const secretsStore = getSecretsStore();
  
  // Initialize secrets store
  secretsStore.initialize(userDataPath).catch(err => {
    console.error('[SecretsStore] Initialization error:', err);
  });
  
  // Forward events
  secretsStore.on('token:set', (data) => {
    mainWindow.webContents.send('secrets:tokenSet', data);
  });
  secretsStore.on('token:deleted', (data) => {
    mainWindow.webContents.send('secrets:tokenDeleted', data);
  });
  secretsStore.on('rateLimit:hit', (data) => {
    mainWindow.webContents.send('secrets:rateLimitHit', data);
  });
  
  // Set token
  ipcMain.handle('secrets:setToken', async (_, provider, token) => {
    try {
      return await secretsStore.setToken(provider, token);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get token (returns redacted)
  ipcMain.handle('secrets:getTokenStatus', async (_, provider) => {
    try {
      return secretsStore.getProviderStatus(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Delete token
  ipcMain.handle('secrets:deleteToken', async (_, provider) => {
    try {
      return await secretsStore.deleteToken(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Validate token
  ipcMain.handle('secrets:validateToken', async (_, provider, token) => {
    try {
      return await secretsStore.validateToken(provider, token);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all provider statuses
  ipcMain.handle('secrets:getAllStatuses', async () => {
    try {
      return secretsStore.getAllProviderStatuses();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get configured providers
  ipcMain.handle('secrets:getConfiguredProviders', async () => {
    try {
      return secretsStore.getConfiguredProviders();
    } catch (error) {
      return { error: error.message };
    }
  });

  // ===========================
  // LICENSING SERVICE HANDLERS
  // ===========================
  const { getLicensingService } = require('./services/licensing-service');
  const licensingService = getLicensingService();
  
  // Initialize licensing service
  licensingService.initialize(db, store).catch(err => {
    console.error('[LicensingService] Initialization error:', err);
  });
  
  // Forward events
  licensingService.on('license:accepted', (data) => {
    mainWindow.webContents.send('licensing:accepted', data);
  });
  licensingService.on('tos:accepted', (data) => {
    mainWindow.webContents.send('licensing:tosAccepted', data);
  });
  licensingService.on('age:verified', (data) => {
    mainWindow.webContents.send('licensing:ageVerified', data);
  });
  
  // Check if license acceptance is required
  ipcMain.handle('licensing:requiresAcceptance', async (_, modelId, provider, licenseId) => {
    try {
      return await licensingService.requiresAcceptance(modelId, provider, licenseId);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Accept license
  ipcMain.handle('licensing:acceptLicense', async (_, modelId, provider, licenseId, licenseName) => {
    try {
      return await licensingService.acceptLicense(modelId, provider, licenseId, licenseName);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get license status
  ipcMain.handle('licensing:getLicenseStatus', async (_, modelId, provider) => {
    try {
      return licensingService.getLicenseStatus(modelId, provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Accept ToS
  ipcMain.handle('licensing:acceptToS', async (_, provider, version) => {
    try {
      return await licensingService.acceptToS(provider, version);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get ToS status
  ipcMain.handle('licensing:getToSStatus', async (_, provider) => {
    try {
      return licensingService.getToSStatus(provider);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verify age
  ipcMain.handle('licensing:verifyAge', async (_, dateOfBirth) => {
    try {
      return await licensingService.verifyAge(dateOfBirth);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check age verification
  ipcMain.handle('licensing:isAgeVerified', async () => {
    try {
      return licensingService.isAgeVerified();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get Private Vault access
  ipcMain.handle('licensing:getVaultAccess', async () => {
    try {
      return licensingService.getPrivateVaultAccess();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Set vault password
  ipcMain.handle('licensing:setVaultPassword', async (_, password) => {
    try {
      return await licensingService.setVaultPassword(password);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verify vault password
  ipcMain.handle('licensing:verifyVaultPassword', async (_, password) => {
    try {
      return licensingService.verifyVaultPassword(password);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Check vault password
  ipcMain.handle('licensing:hasVaultPassword', async () => {
    try {
      return licensingService.hasVaultPassword();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Parse license
  ipcMain.handle('licensing:parseLicense', async (_, licenseString) => {
    try {
      return licensingService.parseLicense(licenseString);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get license summary
  ipcMain.handle('licensing:getLicenseSummary', async (_, license) => {
    try {
      return licensingService.getLicenseSummary(license);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Get all acceptances
  ipcMain.handle('licensing:getAllAcceptances', async () => {
    try {
      return licensingService.getAllAcceptances();
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Revoke acceptance
  ipcMain.handle('licensing:revokeAcceptance', async (_, modelId, provider, licenseId) => {
    try {
      return await licensingService.revokeAcceptance(modelId, provider, licenseId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Convert GGUF to OpenVINO format for NPU
  ipcMain.handle('models:convertToNPU', async (_, { inputPath, outputDir, precision = 'fp16' }) => {
    const { spawn } = require('child_process');
    
    // Get Python path from openvino-env
    const projectRoot = path.resolve(__dirname, '..');
    const openvinoEnv = path.join(projectRoot, 'openvino-env');
    const pythonPath = process.platform === 'win32' 
      ? path.join(openvinoEnv, 'Scripts', 'python.exe')
      : path.join(openvinoEnv, 'bin', 'python');
    
    const convertScript = path.join(projectRoot, 'scripts', 'convert-to-openvino.py');
    
    if (!fs.existsSync(pythonPath)) {
      return { 
        success: false, 
        error: 'OpenVINO environment not set up. Run scripts/setup-openvino.ps1 first.',
        needsSetup: true
      };
    }
    
    if (!fs.existsSync(convertScript)) {
      return { 
        success: false, 
        error: 'Conversion script not found.' 
      };
    }

    // Ensure output directory exists
    const outputPath = outputDir || path.join(projectRoot, 'npu-models');
    await fsPromises.mkdir(outputPath, { recursive: true });

    return new Promise((resolve) => {
      const args = [
        convertScript,
        '--input', inputPath,
        '--output-dir', outputPath,
        '--precision', precision
      ];
      
      console.log(`[NPU Convert] Running: ${pythonPath} ${args.join(' ')}`);
      
      const proc = spawn(pythonPath, args, { cwd: projectRoot });
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log('[NPU Convert]', data.toString().trim());
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error('[NPU Convert Error]', data.toString().trim());
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ 
            success: true, 
            outputPath,
            message: 'Model converted successfully for NPU',
            stdout
          });
        } else {
          resolve({ 
            success: false, 
            error: stderr || `Conversion failed with code ${code}`,
            stdout,
            stderr
          });
        }
      });
      
      proc.on('error', (error) => {
        resolve({ 
          success: false, 
          error: error.message 
        });
      });
    });
  });
}

// Helper to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// Unified Ledger IPC Handlers
// ============================================

async function setupLedgerHandlers(ipcMain, userDataPath) {
  if (!ledgerService) {
    console.warn('[Ledger] Service not available, skipping IPC handlers');
    return;
  }

  // Initialize ledger service
  try {
    await ledgerService.initLedgerService(userDataPath);
    console.log('[Ledger] Service initialized');
  } catch (error) {
    console.error('[Ledger] Failed to initialize:', error);
    return;
  }

  // Record events
  ipcMain.handle('ledger:recordEvent', (_, event) => {
    try {
      return ledgerService.recordEvent(event);
    } catch (error) {
      console.error('[Ledger] recordEvent failed:', error);
      return { error: error.message };
    }
  });

  // Record specific event types
  ipcMain.handle('ledger:recordMessage', (_, params) => {
    try {
      return ledgerService.recordMessage(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordWorkspaceSwitch', (_, params) => {
    try {
      return ledgerService.recordWorkspaceSwitch(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordModelSwitch', (_, params) => {
    try {
      return ledgerService.recordModelSwitch(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordGenerationStart', (_, params) => {
    try {
      return ledgerService.recordGenerationStart(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordGenerationComplete', (_, params) => {
    try {
      return ledgerService.recordGenerationComplete(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordFileOpen', (_, params) => {
    try {
      return ledgerService.recordFileOpen(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordTypingBurst', (_, params) => {
    try {
      return ledgerService.recordTypingBurst(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:recordUserAction', (_, params) => {
    try {
      return ledgerService.recordUserAction(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Evidence
  ipcMain.handle('ledger:addEvidence', (_, params) => {
    try {
      return ledgerService.addEvidence(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getEvidence', (_, eventId) => {
    try {
      return ledgerService.getEvidence(eventId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Action runs
  ipcMain.handle('ledger:createRun', (_, params) => {
    try {
      return ledgerService.createRun(params);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:updateRun', (_, { runId, updates }) => {
    try {
      return ledgerService.updateRun(runId, updates);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:addRunStep', (_, step) => {
    try {
      return ledgerService.addRunStep(step);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getRunSteps', (_, runId) => {
    try {
      return ledgerService.getRunSteps(runId);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Decision forks
  ipcMain.handle('ledger:createDecisionFork', (_, fork) => {
    try {
      return ledgerService.createDecisionFork(fork);
    } catch (error) {
      return { error: error.message };
    }
  });

  // Queries
  ipcMain.handle('ledger:listEvents', (_, filters) => {
    try {
      return ledgerService.listEvents(filters || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionEvents', (_, limit) => {
    try {
      return ledgerService.getSessionEvents(limit);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getFrictionSignals', (_, filters) => {
    try {
      return ledgerService.getFrictionSignals(filters || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getStats', () => {
    try {
      return ledgerService.getStats();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearEvents', () => {
    try {
      ledgerService.clearEvents();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearFrictionSignals', () => {
    try {
      ledgerService.clearFrictionSignals();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:clearAll', () => {
    try {
      ledgerService.clearAll();
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:verifyChain', (_, limit) => {
    try {
      return ledgerService.verifyChain(limit);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionTimeline', (_, { sessionId, options }) => {
    try {
      return ledgerService.getSessionTimeline(sessionId, options || {});
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('ledger:getSessionId', () => {
    try {
      return ledgerService.getSessionId();
    } catch (error) {
      return { error: error.message };
    }
  });

  // State inference handlers
  if (stateInference) {
    ipcMain.handle('soul:inferState', async () => {
      try {
        return await stateInference.inferState();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('soul:getPromptAdjustments', (_, { state, confidence }) => {
      try {
        return stateInference.getPromptAdjustments(state, confidence);
      } catch (error) {
        return { error: error.message };
      }
    });
  }

  // Intent compiler handlers
  if (intentSchema && intentExecutor) {
    ipcMain.handle('intent:compile', async (_, { intent }) => {
      try {
        // For now, return a mock plan structure
        // In production, this would call the LLM with getCompilerSystemPrompt()
        const mockPlan = {
          id: `plan_${Date.now()}`,
          intent,
          reasoning: 'Analysis based on intent',
          steps: [
            {
              type: 'search_codebase',
              description: 'Find relevant files',
              params: { query: intent.split(' ').slice(0, 3).join(' '), type: 'text' }
            },
            {
              type: 'checkpoint',
              description: 'Create safety checkpoint',
              params: { label: 'pre-changes', autoRollbackOnFailure: true }
            }
          ],
          created: new Date().toISOString(),
        };

        const validation = intentSchema.validatePlan(mockPlan);
        const complexity = intentSchema.estimatePlanComplexity(mockPlan);

        return {
          plan: mockPlan,
          valid: validation.valid,
          errors: validation.errors,
          complexity,
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:execute', async (_, { plan, options }) => {
      try {
        const result = await intentExecutor.executePlan(plan, options || {});
        return result;
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:validate', (_, { plan }) => {
      try {
        const validation = intentSchema.validatePlan(plan);
        const complexity = intentSchema.estimatePlanComplexity(plan);
        return { validation, complexity };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('intent:getSystemPrompt', () => {
      try {
        return intentSchema.getCompilerSystemPrompt();
      } catch (error) {
        return { error: error.message };
      }
    });
  }

  // LMA handlers
  const lmaAvailable =
    typeof llamaBridge.initialize === 'function' &&
    typeof trainingScheduler.initialize === 'function';

  if (lmaAvailable) {
    // Initialize LMA services
    llamaBridge.initialize(userDataPath).catch(console.error);
    trainingScheduler.initialize(userDataPath).catch(console.error);

    ipcMain.handle('lma:getStatus', async () => {
      try {
        // Check both backends
        const ollamaStatus = ollamaAdapters ? await ollamaAdapters.getAdapterStatus() : { available: false };
        
        return {
          llamaAvailable: llamaBridge.isAvailable(),
          ollamaAvailable: ollamaStatus.available,
          scheduler: trainingScheduler.getStatus(),
          loadedAdapters: llamaBridge.getLoadedAdapters(),
          ollamaAdapters: ollamaStatus.models || [],
          backend: ollamaStatus.available ? 'ollama' : (llamaBridge.isAvailable() ? 'llama.cpp' : 'none'),
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:listModels', async () => {
      try {
        return await llamaBridge.listModels();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:listAdapters', async () => {
      try {
        return await llamaBridge.listAdapters();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:loadAdapter', async (_, adapterName) => {
      try {
        return await llamaBridge.loadAdapter(adapterName);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:unloadAdapter', (_, adapterName) => {
      try {
        return llamaBridge.unloadAdapter(adapterName);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:buildDataset', async (_, options) => {
      try {
        return await datasetBuilder.buildDataset(options || {});
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:estimateTraining', (_, { dataset, config }) => {
      try {
        return datasetBuilder.estimateTrainingTime(dataset, config);
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:schedulerEnable', () => {
      try {
        return trainingScheduler.enable();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:schedulerDisable', () => {
      try {
        return trainingScheduler.disable();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:triggerTraining', async (_, options) => {
      try {
        return await trainingScheduler.triggerTraining(options || {});
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:cancelTraining', () => {
      try {
        return trainingScheduler.cancelTraining();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:getHistory', () => {
      try {
        return trainingScheduler.getHistory();
      } catch (error) {
        return { error: error.message };
      }
    });

    ipcMain.handle('lma:getSystemInfo', async () => {
      try {
        return await llamaBridge.getSystemInfo();
      } catch (error) {
        return { error: error.message };
      }
    });

    // Ollama-based adapter handlers
    if (ollamaAdapters) {
      ipcMain.handle('lma:createOllamaAdapter', async (_, config) => {
        try {
          // Get friction signals to extract insights
          const signals = ledgerService ? ledgerService.getFrictionSignals({ limit: 100 }) : [];
          const insights = ollamaAdapters.extractInsightsFromFriction(signals);
          
          return await ollamaAdapters.createPersonalizedModel({
            ...config,
            frictionInsights: insights,
          });
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:listOllamaAdapters', async () => {
        try {
          return await ollamaAdapters.listPersonalizedModels();
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:deleteOllamaAdapter', async (_, modelName) => {
        try {
          return await ollamaAdapters.deletePersonalizedModel(modelName);
        } catch (error) {
          return { error: error.message };
        }
      });

      ipcMain.handle('lma:getOllamaModels', async () => {
        try {
          return await ollamaAdapters.getOllamaModels();
        } catch (error) {
          return { error: error.message };
        }
      });
    }
  }
}

// Export saveDatabase for cleanup
module.exports = { setupIpcHandlers, saveDatabase, setupLedgerHandlers };
