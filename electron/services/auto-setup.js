/**
 * auto-setup.js
 *
 * Focused Ollama recovery helper used by the health monitor.
 *
 * Note: full first-run startup orchestration lives in `startup-manager.js`.
 * This module intentionally only exports the small surface needed by the
 * health monitor's `recover` hook so we have a single, predictable ownership
 * story for each subsystem:
 *
 *   startup-manager.js   -> orchestrates all services at boot
 *   auto-setup.js        -> Ollama-only recovery (used by health-monitor)
 *   OnboardingWizard.jsx -> first-run UX (model download, NPU activation)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function detectNvidiaPresent() {
  // Best-effort: reuse cached hardware detection if already initialized.
  try {
    const hw = require('./hardware-detection');
    const cached = hw && typeof hw.getCachedHardware === 'function' ? hw.getCachedHardware() : null;
    if (cached?.gpus?.some?.((g) => String(g.vendor || g.type || '').toLowerCase().includes('nvidia'))) {
      return true;
    }
  } catch (_) {
    // non-blocking
  }
  // If the detector isn't ready, fall back to checking if nvidia-smi exists.
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || '', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
      'C:/Windows/System32/nvidia-smi.exe',
    ];
    return candidates.some((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
  }
  return false;
}

class AutoSetup {
  constructor() {
    this.setupLog = [];
    this.isSetupRunning = false;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.setupLog.push(logEntry);
    console.log(logEntry);
  }

  /**
   * Ensure Ollama is reachable. If not, attempt to start the installed binary
   * with sensible GPU env defaults. Used both as a public recovery hook and by
   * legacy callers that still reference `runAutoSetup`.
   */
  async setupOllama() {
    this.log('Checking Ollama...');

    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        this.log('[OK] Ollama is already running');
        return { running: true, installed: true };
      }
    } catch (_) {
      this.log('Ollama not responding, attempting to start...');
    }

    try {
      const ollamaPath = await this.findOllamaBinary();
      if (!ollamaPath) {
        this.log('[WARN] Ollama not installed. Download from ollama.com');
        return { running: false, installed: false };
      }

      this.log(`Found Ollama at: ${ollamaPath}`);

      const ollamaEnv = { ...process.env };
      // Only hint CUDA when NVIDIA is actually present. On AMD / Apple / Intel
      // systems this env var is at best useless and at worst confusing in logs.
      if (!ollamaEnv.CUDA_VISIBLE_DEVICES && detectNvidiaPresent()) {
        ollamaEnv.CUDA_VISIBLE_DEVICES = '0';
      }
      ollamaEnv.OLLAMA_FLASH_ATTENTION = ollamaEnv.OLLAMA_FLASH_ATTENTION || '1';
      // Keep models resident by default (LM Studio-style). The inference
      // orchestrator sets a profile-aware per-request keep_alive that
      // overrides this env value; the env default only matters for
      // requests that bypass the orchestrator.
      ollamaEnv.OLLAMA_KEEP_ALIVE = ollamaEnv.OLLAMA_KEEP_ALIVE || '24h';
      ollamaEnv.OLLAMA_NUM_PARALLEL = ollamaEnv.OLLAMA_NUM_PARALLEL || '1';
      ollamaEnv.OLLAMA_MAX_LOADED_MODELS = ollamaEnv.OLLAMA_MAX_LOADED_MODELS || '1';

      const ollamaProcess = spawn(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: ollamaEnv,
      });
      ollamaProcess.unref();

      this.log('Starting Ollama service...');
      await this.sleep(1500);

      // Poll with a shorter early cadence so recovery feels snappy.
      const waits = [500, 750, 1000, 1500, 2000];
      for (const waitMs of waits) {
        try {
          const checkResponse = await fetch('http://127.0.0.1:11434/api/tags', {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
          });
          if (checkResponse.ok) {
            this.log('[OK] Ollama started successfully');
            return { running: true, installed: true };
          }
        } catch (_) {
          // continue
        }
        await this.sleep(waitMs);
      }

      this.log('[WARN] Ollama started but not responding yet');
      return { running: false, installed: true };
    } catch (error) {
      this.log(`[WARN] Could not auto-start Ollama: ${error.message}`);
      return { running: false, installed: false };
    }
  }

  async findOllamaBinary() {
    const possiblePaths = [];

    if (process.platform === 'win32') {
      possiblePaths.push(
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        'C:\\Program Files\\Ollama\\ollama.exe',
        'C:\\Program Files (x86)\\Ollama\\ollama.exe'
      );
    } else if (process.platform === 'darwin') {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        path.join(os.homedir(), '.ollama', 'bin', 'ollama')
      );
    } else {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        path.join(os.homedir(), '.ollama', 'bin', 'ollama')
      );
    }

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getSetupLog() {
    return this.setupLog;
  }
}

module.exports = new AutoSetup();
