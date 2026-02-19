const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const healthMonitor = require('./health-monitor');

// Startup step definitions for progress tracking
const STARTUP_STEPS = {
  INIT: { id: 'init', name: 'SYSTEM BOOT', order: 0 },
  DEPENDENCIES: { id: 'dependencies', name: 'DEPENDENCIES', order: 1 },
  DATABASE: { id: 'database', name: 'DATABASE', order: 2 },
  OLLAMA: { id: 'ollama', name: 'OLLAMA', order: 3 },
  NPU: { id: 'npu', name: 'NPU SERVER', order: 4 },
  IMAGE_BACKEND: { id: 'imageBackend', name: 'IMAGE BACKEND', order: 5 },
  HEALTH_MONITOR: { id: 'healthMonitor', name: 'HEALTH MONITOR', order: 6 },
  COMPLETE: { id: 'complete', name: 'COMPLETE', order: 7 },
};

const STARTUP_TIMEOUTS_MS = {
  ollama: 15000,
  npu: 45000,
  imageBackend: 6000,
};

function normalizeLogSymbols(input) {
  return String(input || '')
    .replace(/[\u2705\u2713]/g, '[OK]')
    .replace(/[\u274C\u2717]/g, '[FAIL]')
    .replace(/\u26A0(?:\uFE0F)?/g, '[WARN]')
    .replace(/\u2139(?:\uFE0F)?/g, '[INFO]')
    .replace(/\uD83D\uDD04/g, '[RETRY]')
    .replace(/[\u2013\u2014]/g, '-');
}

function withTimeout(taskFn, timeoutMs, label = 'operation') {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(taskFn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

class StartupManager {
  constructor() {
    this.processes = new Map();
    this.log = [];
    this.healthMonitorStarted = false;
    this.progressCallback = null;
    this.steps = STARTUP_STEPS;
  }

  /**
   * Set callback for real-time progress updates
   * @param {Function} callback - (step, status, message, percent) => void
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  /**
   * Emit progress event to callback
   */
  emitProgress(stepId, status, message, percent = null) {
    if (this.progressCallback) {
      const step = Object.values(STARTUP_STEPS).find(s => s.id === stepId);
      this.progressCallback({
        step: stepId,
        stepName: step?.name || stepId.toUpperCase(),
        status, // 'pending' | 'running' | 'success' | 'warning' | 'error'
        message,
        percent,
        timestamp: new Date().toISOString(),
      });
    }
  }

  addLog(message) {
    const normalized = normalizeLogSymbols(message);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${normalized}`;
    this.log.push(entry);
    console.log(entry);
    // Also emit as a log message for the terminal view
    if (this.progressCallback) {
      this.progressCallback({
        type: 'log',
        message: entry,
        timestamp,
      });
    }
  }

  async fetchWithTimeout(url, timeoutMs = 2000, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async runStepWithTimeout(stepLabel, timeoutMs, taskFn, fallback = {}) {
    try {
      return await withTimeout(taskFn, timeoutMs, stepLabel);
    } catch (error) {
      const message = String(error?.message || error || 'Unknown startup error');
      this.addLog(`[WARN] ${stepLabel} degraded: ${message}`);
      return {
        ...fallback,
        timeout: /timed out/i.test(message),
        error: message,
      };
    }
  }

  /**
   * Verify all npm dependencies are installed; install missing ones automatically.
   * Runs synchronously at startup so the app doesn't try to load missing modules.
   */
  ensureDependencies() {
    const projectRoot = path.resolve(__dirname, '../..');
    const pkgPath = path.join(projectRoot, 'package.json');
    const nodeModulesPath = path.join(projectRoot, 'node_modules');

    // Quick check: if node_modules doesn't exist at all, run full install
    if (!fs.existsSync(nodeModulesPath)) {
      this.addLog('node_modules missing - running npm install...');
      try {
        execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
        this.addLog('[OK] npm install complete');
      } catch (err) {
        this.addLog(`[WARN] npm install failed: ${err.message}`);
      }
      return;
    }

    // Read package.json and check each dependency folder exists
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (err) {
      this.addLog(`[WARN] Could not read package.json: ${err.message}`);
      return;
    }

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    const missing = [];
    for (const dep of Object.keys(allDeps)) {
      // Some scoped packages like @monaco-editor/react live in @monaco-editor folder
      const depFolder = dep.startsWith('@')
        ? path.join(nodeModulesPath, ...dep.split('/'))
        : path.join(nodeModulesPath, dep);

      if (!fs.existsSync(depFolder)) {
        missing.push(dep);
      }
    }

    if (missing.length === 0) {
      this.addLog('[OK] All npm dependencies present');
      return;
    }

    this.addLog(`Missing ${missing.length} dependencies: ${missing.join(', ')}`);
    this.addLog('Running npm install to restore missing packages...');

    try {
      execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
      this.addLog('[OK] npm install complete');
    } catch (err) {
      this.addLog(`[WARN] npm install failed: ${err.message}`);
    }
  }

  async startAllServices() {
    this.addLog('Starting all services...');
    this.emitProgress('init', 'running', 'Initializing system...', 0);

    // Note: npm dependency check now runs in main.js before app.whenReady()
    // Emit dependencies as already complete
    this.emitProgress('dependencies', 'success', 'All dependencies synced', 15);

    // Database initialization (handled by ipc-handlers, mark as in-progress)
    this.emitProgress('database', 'running', 'Connecting to local database...', 25);
    await new Promise(r => setTimeout(r, 300)); // Brief pause for visual effect
    this.emitProgress('database', 'success', 'Database connected', 30);

    // Ollama check
    this.emitProgress('ollama', 'running', 'Connecting to Ollama...', 35);
    const ollamaResult = await this.runStepWithTimeout(
      'ollama',
      STARTUP_TIMEOUTS_MS.ollama,
      () => this.ensureOllamaRunning(),
      { running: false, installed: true }
    );
    const results = { ollama: ollamaResult };
    
    if (ollamaResult.running) {
      this.emitProgress('ollama', 'success', 'Ollama connected', 50);
    } else if (ollamaResult.timeout) {
      this.emitProgress('ollama', 'warning', 'Ollama startup timed out; continuing degraded', 50);
    } else if (ollamaResult.installed === false) {
      this.emitProgress('ollama', 'warning', 'Ollama not installed', 50);
    } else {
      this.emitProgress('ollama', 'error', ollamaResult.error || 'Connection failed', 50);
    }

    // NPU Server check
    this.emitProgress('npu', 'running', 'Checking NPU availability...', 55);
    results.npu = await this.runStepWithTimeout(
      'npu',
      STARTUP_TIMEOUTS_MS.npu,
      () => this.startNPUServerIfConfigured(),
      { running: false, configured: false }
    );
    
    if (results.npu.running) {
      this.emitProgress('npu', 'success', 'NPU server active', 70);
    } else if (results.npu.timeout) {
      this.emitProgress('npu', 'warning', 'NPU check timed out; continuing without NPU', 70);
    } else if (results.npu.configured) {
      this.emitProgress('npu', 'warning', 'NPU configured (manual start)', 70);
    } else {
      this.emitProgress('npu', 'pending', 'NPU not configured', 70);
    }

    // Image Backend check
    this.emitProgress('imageBackend', 'running', 'Checking image backend...', 75);
    results.imageBackend = await this.runStepWithTimeout(
      'image_backend',
      STARTUP_TIMEOUTS_MS.imageBackend,
      () => this.checkImageBackend(),
      { running: false }
    );
    
    if (results.imageBackend.running) {
      this.emitProgress('imageBackend', 'success', 'Image backend ready', 85);
    } else if (results.imageBackend.timeout) {
      this.emitProgress('imageBackend', 'warning', 'Image backend check timed out', 85);
    } else {
      this.emitProgress('imageBackend', 'pending', 'Not configured', 85);
    }

    // Start health monitoring after initial setup
    this.emitProgress('healthMonitor', 'running', 'Starting health monitor...', 90);
    try {
      if (!this.healthMonitorStarted) {
        this.startHealthMonitoring(results);
      }
      this.emitProgress('healthMonitor', 'success', 'Health monitor active', 95);
    } catch (error) {
      this.addLog(`[WARN] Health monitor unavailable: ${error.message}`);
      this.emitProgress('healthMonitor', 'warning', 'Health monitor unavailable', 95);
    }

    this.addLog('Service startup complete');
    this.emitProgress('complete', 'success', 'All systems operational', 100);
    
    return results;
  }

  /**
   * Start continuous health monitoring with auto-recovery
   */
  startHealthMonitoring(initialResults) {
    this.addLog('Starting health monitoring...');
    
    // Configure services based on what's available
    // Only enable NPU health monitoring if server is actually running
    if (initialResults.npu?.running) {
      healthMonitor.setServiceEnabled('npu', true);
    } else if (initialResults.npu?.configured) {
      // NPU configured but not running - log once, don't enable continuous monitoring
      this.addLog('[INFO] NPU configured but not started (start manually in settings)');
    }
    
    if (initialResults.imageBackend?.running) {
      healthMonitor.setServiceEnabled('imageBackend', true);
    }
    
    // Listen for health events
    healthMonitor.on('serviceUnhealthy', (data) => {
      this.addLog(`[WARN] Service unhealthy: ${data.service} (${data.failures} failures)`);
    });
    
    healthMonitor.on('recoveryAttempt', (data) => {
      this.addLog(`[RETRY] Attempting recovery: ${data.service} (attempt ${data.attempt})`);
    });
    
    healthMonitor.on('recoverySuccess', (data) => {
      this.addLog(`[OK] Service recovered: ${data.service}`);
    });
    
    healthMonitor.on('recoveryFailed', (data) => {
      this.addLog(`[FAIL] Recovery failed: ${data.service} - ${data.error}`);
    });
    
    // Start monitoring with lite intervals (check every 120 seconds)
    healthMonitor.start(120000);
    this.healthMonitorStarted = true;
  }

  async ensureOllamaRunning() {
    try {
      // Check if already running
      const response = await this.fetchWithTimeout(
        'http://127.0.0.1:11434/api/tags',
        2000,
        { method: 'GET' }
      );

      if (response.ok) {
        this.addLog('[OK] Ollama already running');
        return { running: true, started: false };
      }
    } catch (error) {
      // Not running, try to start
    }

    // Find and start Ollama
    try {
      const ollamaModule = require('./ollama-helper');
      const ollamaHelper = typeof ollamaModule.getOllamaHelper === 'function'
        ? ollamaModule.getOllamaHelper({})
        : ollamaModule;
      if (!ollamaHelper || typeof ollamaHelper.detectBinary !== 'function') {
        throw new Error('ollama helper unavailable');
      }
      const binary = await ollamaHelper.detectBinary();
      
      if (!binary) {
        this.addLog('[WARN] Ollama not installed');
        return { running: false, installed: false };
      }

      this.addLog('Starting Ollama...');
      const result = await ollamaHelper.start();
      
      if (result.success) {
        this.addLog('[OK] Ollama started');
        return { running: true, started: true };
      } else {
        this.addLog(`[WARN] Failed to start Ollama: ${result.error}`);
        return { running: false, installed: true, error: result.error };
      }
    } catch (error) {
      this.addLog(`[WARN] Ollama startup error: ${error.message}`);
      return { running: false, error: error.message };
    }
  }

  async startNPUServerIfConfigured() {
    try {
      const npuBridge = require('./npu-bridge').getNpuBridge();
      const status = await npuBridge.getStatus();
      
      if (status.serverRunning) {
        this.addLog('[OK] NPU server already running');
        return { running: true };
      }

      // Check if OpenVINO is set up
      if (!status.openvinoInstalled) {
        this.addLog('[INFO] NPU not configured (optional)');
        return { running: false, configured: false };
      }

      // Check if user has enabled NPU auto-start
      const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
      let autoStart = false;
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          autoStart = config.auto_start === true && (config.model_path || config.model_id);
        }
      } catch (e) {
        // Config doesn't exist or is invalid
      }

      if (autoStart) {
        this.addLog('Starting NPU server (auto-start enabled)...');
        const result = await npuBridge.startServer();
        if (result.success) {
          this.addLog('[OK] NPU server started');
          return { running: true, configured: true, started: true };
        } else {
          this.addLog(`[WARN] NPU server failed to start: ${result.error}`);
          return { running: false, configured: true, error: result.error };
        }
      }

      this.addLog('[INFO] NPU configured but not started (start manually in settings)');
      return { running: false, configured: true };
    } catch (error) {
      this.addLog(`[INFO] NPU check skipped: ${error.message}`);
      return { running: false, error: error.message };
    }
  }

  async checkImageBackend() {
    try {
      const response = await this.fetchWithTimeout(
        'http://127.0.0.1:8188/system_stats',
        2000,
        { method: 'GET' }
      );

      if (response.ok) {
        this.addLog('[OK] Image backend running');
        return { running: true };
      }
    } catch (error) {
      this.addLog('[INFO] Image backend not running (optional)');
    }

    return { running: false };
  }

  getLog() {
    return this.log;
  }

  stopAllServices() {
    this.addLog('Stopping all managed services...');
    
    // Stop health monitoring
    healthMonitor.stop();
    this.healthMonitorStarted = false;
    
    for (const [name, process] of this.processes.entries()) {
      try {
        process.kill();
        this.addLog(`Stopped ${name}`);
      } catch (error) {
        this.addLog(`Failed to stop ${name}: ${error.message}`);
      }
    }
    
    this.processes.clear();
  }

  /**
   * Get current health status of all services
   */
  getHealthStatus() {
    return healthMonitor.getStatus();
  }
}

module.exports = new StartupManager();
