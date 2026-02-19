/**
 * NPU Bridge Service
 * Bridge to OpenVINO for Intel NPU acceleration
 * 
 * This service detects OpenVINO installation and NPU availability,
 * and provides a bridge to the OpenVINO inference server when available.
 *
 * PERFORMANCE: Installation/device checks use adaptive cache TTLs
 * (longer for success, shorter for failures). Server health is cached
 * briefly to avoid hammering the endpoint.
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const DEFAULT_NPU_MODEL_CANDIDATES = [
  'Qwen/Qwen2.5-0.5B-Instruct',
  'Qwen/Qwen2.5-1.5B-Instruct',
  'Qwen/Qwen2-0.5B-Instruct',
  'HuggingFaceTB/SmolLM2-1.7B-Instruct',
  'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
  'microsoft/phi-2',
  'google/gemma-2-2b-it',
  'stabilityai/stablelm-2-zephyr-1_6b',
];

class NpuBridge {
  constructor() {
    this.openvinoInstalled = false;
    this.npuAvailable = false;
    this.openvinoPath = null;
    this.pythonExecutable = 'python';
    this.pythonArgs = [];
    this.serverProcess = null;
    this.serverEndpoint = 'http://localhost:8081';
    this.devices = [];

    // === Caches ===
    // Installation and device checks are cached with adaptive TTL.
    // Positive results can live longer; negative results are short-lived so
    // setup/install changes are reflected without an app restart.
    this._installationResult = null;
    this._installationCheckedAt = 0;
    this._devicesResult = null;
    this._devicesCheckedAt = 0;
    // Full status cache (short-lived, includes server health).
    this._statusCache = { at: 0, value: null };
    // Server health cache (short-lived, separate from full status).
    this._serverHealthCache = { at: 0, value: false };
    this._cacheTtlMs = {
      installationPositive: 5 * 60 * 1000,
      installationNegative: 10 * 1000,
      devicesPositive: 30 * 1000,
      devicesNegative: 10 * 1000,
      status: 5 * 1000,
      serverHealth: 3 * 1000,
    };
  }

  // ------------------------------------------------------------------
  // Installation detection (session-cached)
  // ------------------------------------------------------------------

  /**
   * Check if OpenVINO is installed.
   * Positive results are cached longer; negative results are short-lived.
   * Pass { force: true } to bypass cache.
   */
  async checkOpenVinoInstallation(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();

    if (!force && this._installationResult) {
      const ttl = this._installationResult.installed
        ? this._cacheTtlMs.installationPositive
        : this._cacheTtlMs.installationNegative;
      if (now - this._installationCheckedAt < ttl) {
        return this._installationResult;
      }
    }

    const result = await this._doCheckOpenVinoInstallation();
    this._installationResult = result;
    this._installationCheckedAt = Date.now();
    this.invalidateStatusCache();
    return result;
  }

  /** @private */
  async _doCheckOpenVinoInstallation() {
    if (process.platform !== 'win32') {
      return { installed: false, reason: 'Not Windows' };
    }

    // 1) Prefer a local DevForge virtualenv.
    const envPath = this._findBundledOpenVinoEnv();
    if (envPath) {
      this._setDetectedOpenVinoEnv(envPath);
      return {
        installed: true,
        path: envPath,
        version: this.extractVersionFromEnv(envPath) || 'env',
      };
    }

    // 2) Check common global OpenVINO toolkit paths.
    const possiblePaths = [
      'C:\\Program Files (x86)\\Intel\\openvino_2024',
      'C:\\Program Files (x86)\\Intel\\openvino_2023',
      'C:\\Program Files\\Intel\\openvino_2024',
      'C:\\Program Files\\Intel\\openvino_2023',
      process.env.INTEL_OPENVINO_DIR,
      process.env.OPENVINO_DIR,
    ].filter(Boolean);

    for (const basePath of possiblePaths) {
      try {
        const setupvarsPath = path.join(basePath, 'setupvars.bat');
        if (!fs.existsSync(setupvarsPath)) continue;
        this.openvinoPath = basePath;
        this.openvinoInstalled = true;
        this._setPythonCommand('python');
        return {
          installed: true,
          path: basePath,
          version: this.extractVersion(basePath),
        };
      } catch {
        // Continue probing.
      }
    }

    // 3) Probe Python for import openvino (covers pip-only installs).
    const pythonCandidates = [
      { executable: process.env.OPENVINO_PYTHON, args: [] },
      { executable: process.env.PYTHON, args: [] },
      { executable: 'python', args: [] },
      { executable: 'python3', args: [] },
      { executable: 'py', args: ['-3'] },
    ].filter((item) => Boolean(item.executable));

    for (const candidate of pythonCandidates) {
      const probe = await this._probePythonForOpenVino(candidate.executable, candidate.args);
      if (!probe.ok) continue;
      this.openvinoInstalled = true;
      this.openvinoPath = probe.location || this.openvinoPath || null;
      this._setPythonCommand(candidate.executable, candidate.args);
      return {
        installed: true,
        path: this.openvinoPath || candidate.executable,
        version: probe.version || 'unknown',
      };
    }

    // 4) Last resort: check if an openvino shim is on PATH.
    try {
      const whereResult = await this._runCommand('where openvino', { timeout: 5000 });
      const firstPath = String(whereResult.stdout || '').trim().split(/\r?\n/)[0];
      if (firstPath) {
        this.openvinoPath = path.dirname(path.dirname(firstPath));
        this.openvinoInstalled = true;
        this._setPythonCommand('python');
        return { installed: true, path: this.openvinoPath, version: 'unknown' };
      }
    } catch {
      // No-op.
    }

    this.openvinoInstalled = false;
    return { installed: false, reason: 'OpenVINO not found' };
  }

  _setPythonCommand(executable, args = []) {
    this.pythonExecutable = executable || 'python';
    this.pythonArgs = Array.isArray(args) ? args : [];
  }

  _setDetectedOpenVinoEnv(envPath) {
    this.openvinoPath = envPath;
    this.openvinoInstalled = true;
    this._setPythonCommand(path.join(envPath, 'Scripts', 'python.exe'));
  }

  _findBundledOpenVinoEnv() {
    try {
      const projectRoot = path.join(__dirname, '..', '..');
      const cwd = process.cwd();
      const parentOfCwd = path.dirname(cwd);
      const explicit = process.env.OPENVINO_ENV_DIR;

      const candidates = [
        explicit,
        path.join(projectRoot, 'openvino-env'),
        path.join(cwd, 'openvino-env'),
        path.join(parentOfCwd, 'openvino-env'),
      ].filter(Boolean);

      for (const envPath of candidates) {
        const envPython = path.join(envPath, 'Scripts', 'python.exe');
        const openvinoPackageDir = path.join(envPath, 'Lib', 'site-packages', 'openvino');
        if (fs.existsSync(envPython) && fs.existsSync(openvinoPackageDir)) {
          return envPath;
        }
      }
    } catch {
      // Ignore and continue.
    }
    return null;
  }

  _probePythonForOpenVino(executable, args = []) {
    return new Promise((resolve) => {
      const script = [
        'import json',
        'result = {"ok": False, "version": None, "location": None}',
        'try:',
        '    import openvino',
        '    result["ok"] = True',
        '    result["version"] = getattr(openvino, "__version__", None)',
        '    result["location"] = getattr(openvino, "__file__", None)',
        'except Exception:',
        '    pass',
        'print(json.dumps(result))',
      ].join('\n');

      let proc;
      try {
        proc = spawn(executable, [...(args || []), '-c', script], {
          timeout: 8000,
          windowsHide: true,
        });
      } catch {
        resolve({ ok: false });
        return;
      }

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.on('error', () => resolve({ ok: false }));
      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ ok: false });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || '').trim());
          if (!parsed?.ok) {
            resolve({ ok: false });
            return;
          }
          resolve({
            ok: true,
            version: parsed.version || null,
            location: parsed.location ? path.dirname(path.dirname(parsed.location)) : null,
          });
        } catch {
          resolve({ ok: false });
        }
      });
    });
  }

  _runCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, { windowsHide: true, ...options }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * Extract OpenVINO version from path
   */
  extractVersion(basePath) {
    try {
      const match = basePath.match(/openvino_(\d+)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Extract OpenVINO version from the bundled virtualenv
   */
  extractVersionFromEnv(envPath) {
    try {
      const sitePackages = path.join(envPath, 'Lib', 'site-packages');
      const entries = fs.readdirSync(sitePackages);
      const distInfo = entries.find((name) =>
        name.toLowerCase().startsWith('openvino-') &&
        name.toLowerCase().endsWith('.dist-info')
      );
      if (!distInfo) return null;
      const metaPath = path.join(sitePackages, distInfo, 'METADATA');
      if (!fs.existsSync(metaPath)) return null;
      const metadata = fs.readFileSync(metaPath, 'utf-8');
      const versionLine = metadata.split('\n').find((line) => line.startsWith('Version:'));
      return versionLine ? versionLine.split(':')[1].trim() : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Device query (session-cached)
  // ------------------------------------------------------------------

  /**
   * Query available OpenVINO devices.
   * Positive results are cached longer; negative results are short-lived.
   * Pass { force: true } to bypass cache.
   */
  async queryDevices(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();
    if (!force && this._devicesResult) {
      const ttl = this._devicesResult?.error
        ? this._cacheTtlMs.devicesNegative
        : this._cacheTtlMs.devicesPositive;
      if (now - this._devicesCheckedAt < ttl) {
        return this._devicesResult;
      }
    }

    // Ensure installation is detected first
    await this.checkOpenVinoInstallation({ force });

    if (!this.openvinoInstalled) {
      const result = { devices: [], error: 'OpenVINO not installed' };
      this._devicesResult = result;
      this._devicesCheckedAt = now;
      return result;
    }

    const result = await this._doQueryDevices();
    this._devicesResult = result;
    this._devicesCheckedAt = Date.now();
    return result;
  }

  /** @private */
  _doQueryDevices() {
    return new Promise((resolve) => {
      const pythonScript = `
import sys
try:
    from openvino import Core
    core = Core()
    devices = core.available_devices
    for device in devices:
        props = {}
        try:
            props['full_name'] = core.get_property(device, 'FULL_DEVICE_NAME')
        except:
            props['full_name'] = device
        print(f"{device}|{props['full_name']}")
except ImportError:
    print("ERROR|OpenVINO Python not installed")
except Exception as e:
    print(f"ERROR|{str(e)}")
`;
      const pythonCmd = this.pythonExecutable || 'python';
      const pythonArgs = Array.isArray(this.pythonArgs) ? this.pythonArgs : [];

      let python;
      try {
        python = spawn(pythonCmd, [...pythonArgs, '-c', pythonScript], {
          timeout: 15000,
          windowsHide: true,
        });
      } catch (spawnError) {
        console.warn('[NpuBridge] Failed to spawn Python for device query:', spawnError.message);
        resolve({ devices: [], error: `Python not available: ${spawnError.message}` });
        return;
      }

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data) => { output += data.toString(); });
      python.stderr.on('data', (data) => { errorOutput += data.toString(); });

      python.on('close', (code) => {
        if (code !== 0 || output.includes('ERROR|')) {
          resolve({
            devices: [],
            error: output.includes('ERROR|')
              ? output.split('ERROR|')[1]?.trim()
              : errorOutput || 'Failed to query devices'
          });
          return;
        }

        const devices = output.trim().split('\n')
          .filter(line => line.includes('|'))
          .map(line => {
            const [id, name] = line.split('|');
            return { id: id.trim(), name: name.trim() };
          });

        this.devices = devices;
        this.npuAvailable = devices.some(d => d.id === 'NPU');

        resolve({ devices, npuAvailable: this.npuAvailable });
      });

      python.on('error', (error) => {
        console.warn('[NpuBridge] Python spawn error:', error.message);
        resolve({ devices: [], error: `Python not available: ${error.message}` });
      });
    });
  }

  /**
   * Check if NPU is available (convenience wrapper)
   */
  async checkNpuAvailable() {
    const result = await this.queryDevices();
    return {
      available: result.npuAvailable || false,
      devices: result.devices || [],
      error: result.error
    };
  }

  // ------------------------------------------------------------------
  // Full status (cached with short TTL — includes server health)
  // ------------------------------------------------------------------

  /**
   * Get full status of OpenVINO/NPU setup.
   * Pass { force: true } to bypass caches.
   */
  async getStatus(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();
    if (!force && this._statusCache?.value && (now - this._statusCache.at) < this._cacheTtlMs.status) {
      return this._statusCache.value;
    }

    const installation = await this.checkOpenVinoInstallation({ force });

    if (!installation.installed) {
      const value = {
        openvinoInstalled: false,
        npuAvailable: false,
        serverRunning: false,
        error: installation.reason,
        setupRequired: true,
        diagnostics: {
          pythonExecutable: this.pythonExecutable,
          pythonArgs: this.pythonArgs,
          openvinoPath: this.openvinoPath,
        },
      };
      this._statusCache = { at: now, value };
      return value;
    }

    const devices = await this.queryDevices({ force });
    const serverRunning = await this.checkServerHealth({ force });

    const value = {
      openvinoInstalled: true,
      openvinoPath: this.openvinoPath,
      openvinoVersion: installation.version,
      npuAvailable: devices.npuAvailable || false,
      devices: devices.devices || [],
      serverRunning,
      error: devices.error || null,
      setupRequired: false,
      diagnostics: {
        pythonExecutable: this.pythonExecutable,
        pythonArgs: this.pythonArgs,
        openvinoPath: this.openvinoPath,
      },
    };
    this._statusCache = { at: now, value };
    return value;
  }

  /**
   * Invalidate status cache (e.g. after starting/stopping server)
   */
  invalidateStatusCache() {
    this._statusCache = { at: 0, value: null };
    this._serverHealthCache = { at: 0, value: false };
  }

  // ------------------------------------------------------------------
  // Server health (cached with short TTL)
  // ------------------------------------------------------------------

  /**
   * Check if OpenVINO inference server is running.
   * Pass { force: true } to bypass cache.
   */
  async checkServerHealth(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();
    if (!force && now - this._serverHealthCache.at < this._cacheTtlMs.serverHealth) {
      return this._serverHealthCache.value;
    }

    const healthy = await this._doCheckServerHealth();
    this._serverHealthCache = { at: now, value: healthy };
    return healthy;
  }

  /** @private */
  _doCheckServerHealth() {
    return new Promise((resolve) => {
      try {
        const req = http.get(`${this.serverEndpoint}/status`, { timeout: 2000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      } catch {
        resolve(false);
      }
    });
  }

  _parseModelSizeHint(modelId = '') {
    const lower = String(modelId || '').toLowerCase();
    if (!lower) return null;
    const match = lower.match(/(\d+(?:\.\d+)?)\s*b/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  _looksLikeModelIdentifier(modelId = '') {
    const value = String(modelId || '').trim();
    if (!value) return false;
    if (fs.existsSync(value)) return true;
    if (path.isAbsolute(value)) return true;
    if (value.startsWith('./') || value.startsWith('.\\') || value.startsWith('../') || value.startsWith('..\\')) {
      return true;
    }
    if (value.includes('\\') || value.includes('/')) return true;
    if (value.endsWith('.xml') || value.endsWith('.onnx')) return true;
    return false;
  }

  _toCandidateEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const modelId = raw.trim();
      if (!modelId) return null;
      return { modelId, tokenizer: modelId };
    }
    if (typeof raw !== 'object') return null;

    const modelId = String(raw.modelId || raw.model || raw.model_path || '').trim();
    if (!modelId) return null;
    return {
      modelId,
      tokenizer: String(raw.tokenizer || raw.tokenizerId || modelId).trim() || modelId,
      source: raw.source || null,
    };
  }

  _buildSelectionContext(options = {}) {
    const workload = String(options.workload || options.intent || 'chat').toLowerCase();
    const profile = String(options.profile || 'balanced').toLowerCase();
    const systemRamGb = Math.max(1, Math.round(os.totalmem() / (1024 ** 3)));

    const explicitMax = Number(options.maxModelSizeB);
    const inferredMax = systemRamGb >= 96 ? 10 : systemRamGb >= 64 ? 8 : systemRamGb >= 32 ? 6 : 4;
    const maxModelSizeB = Number.isFinite(explicitMax) && explicitMax > 0
      ? explicitMax
      : inferredMax;

    const explicitTarget = Number(options.targetModelSizeB);
    const workloadTarget = workload.includes('embed')
      ? 1
      : workload.includes('code')
        ? 3
        : workload.includes('reason')
          ? 2
          : 2;

    const targetModelSizeB = Number.isFinite(explicitTarget) && explicitTarget > 0
      ? explicitTarget
      : Math.min(maxModelSizeB, workloadTarget);

    return {
      workload,
      profile,
      systemRamGb,
      maxModelSizeB,
      targetModelSizeB,
    };
  }

  _getDefaultCandidatesForWorkload(workload = '') {
    const lower = String(workload || '').toLowerCase();
    if (lower.includes('embed')) {
      return [
        'Qwen/Qwen2.5-0.5B-Instruct',
        'HuggingFaceTB/SmolLM2-1.7B-Instruct',
        'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      ];
    }
    if (lower.includes('code')) {
      return [
        'Qwen/Qwen2.5-Coder-1.5B-Instruct',
        'Qwen/Qwen2.5-1.5B-Instruct',
        'microsoft/phi-2',
      ];
    }
    if (lower.includes('reason')) {
      return [
        'Qwen/Qwen2.5-1.5B-Instruct',
        'microsoft/phi-2',
        'google/gemma-2-2b-it',
      ];
    }
    return DEFAULT_NPU_MODEL_CANDIDATES;
  }

  _collectAutoModelCandidates(options = {}, context = {}) {
    const candidates = [];
    const pushEntry = (raw, source) => {
      const entry = this._toCandidateEntry(raw);
      if (!entry) return;
      if (!this._looksLikeModelIdentifier(entry.modelId)) return;
      candidates.push({ ...entry, source: entry.source || source || null });
    };

    const explicitPreferred = [
      options.preferredModel,
      options.modelPath,
      options.modelId,
      options.model,
    ];
    for (const candidate of explicitPreferred) {
      pushEntry(candidate, 'explicit');
    }

    if (Array.isArray(options.candidates)) {
      for (const candidate of options.candidates) {
        pushEntry(candidate, 'options');
      }
    }

    const envCandidates = String(process.env.DEVFORGE_NPU_MODEL_CANDIDATES || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const candidate of envCandidates) {
      pushEntry(candidate, 'env');
    }

    for (const candidate of this._getDefaultCandidatesForWorkload(context.workload)) {
      pushEntry(candidate, 'default');
    }

    const deduped = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const key = String(candidate.modelId || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(candidate);
    }
    return deduped;
  }

  _scoreModelCandidate(candidate, context = {}, options = {}) {
    const modelId = String(candidate?.modelId || '');
    const lower = modelId.toLowerCase();
    const modelSizeB = this._parseModelSizeHint(modelId);

    let score = 0;
    if (modelSizeB !== null) {
      const distance = Math.abs(modelSizeB - context.targetModelSizeB);
      score += Math.max(0, 40 - distance * 14);
      score += modelSizeB <= context.maxModelSizeB ? 18 : -120;
      if (context.profile === 'efficiency' && modelSizeB <= 2) score += 10;
      if (context.profile === 'speed' && modelSizeB >= 1.5 && modelSizeB <= context.maxModelSizeB) score += 8;
      if (context.profile === 'laptop') {
        if (modelSizeB <= 2.5) score += 14;
        else if (modelSizeB > 4) score -= 30;
      }
    } else {
      score += 5;
    }

    if (lower.includes('instruct') || lower.includes('chat') || lower.endsWith('-it')) score += 10;
    if (context.workload.includes('code') && (lower.includes('coder') || lower.includes('code'))) score += 14;
    if (context.workload.includes('reason') && (lower.includes('qwen') || lower.includes('phi') || lower.includes('gemma'))) score += 7;
    if (context.workload.includes('embed') && (lower.includes('embed') || lower.includes('e5') || lower.includes('minilm'))) score += 16;
    if (context.workload.includes('chat') && (lower.includes('chat') || lower.includes('instruct'))) score += 6;

    const explicitPreferred = String(options.preferredModel || options.modelPath || options.modelId || '').trim().toLowerCase();
    if (explicitPreferred && explicitPreferred === lower) {
      score += 250;
    }

    return {
      score,
      modelSizeB,
      modelId,
      source: candidate?.source || null,
      tokenizer: candidate?.tokenizer || modelId,
    };
  }

  _selectBestCandidate(candidates = [], context = {}, options = {}) {
    const ranked = candidates
      .map((candidate) => this._scoreModelCandidate(candidate, context, options))
      .sort((a, b) => b.score - a.score);
    return {
      selected: ranked[0] || null,
      ranked,
    };
  }

  // ------------------------------------------------------------------
  // Model configuration
  // ------------------------------------------------------------------

  async configureModel(modelPath, options = {}) {
    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
    const config = {
      model_path: modelPath,
      tokenizer: options.tokenizer || modelPath,
      device: options.device || 'NPU',
      precision: options.precision || 'fp16'
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Model configured:', config);
      return { success: true, config };
    } catch (error) {
      console.error('[NpuBridge] Failed to configure model:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Auto-configure a suitable model for NPU inference
   */
  async autoConfigureModel(options = {}) {
    console.log('[NpuBridge] Auto-configuring NPU model...');

    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
    const forceReconfigure = Boolean(options.forceReconfigure);
    const context = this._buildSelectionContext(options);

    // Check if already configured with a valid model
    try {
      if (fs.existsSync(configPath)) {
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const existingModelPath = String(existing.model_path || existing.model_id || '').trim();
        if (!forceReconfigure && existingModelPath && this._looksLikeModelIdentifier(existingModelPath)) {
          console.log('[NpuBridge] Model already configured:', existingModelPath);

          if (options.enableAutoStart !== undefined) {
            existing.auto_start = options.enableAutoStart;
            fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
          }

          return {
            configured: true,
            model: existingModelPath,
            existing: true,
            strategy: 'existing',
            context,
          };
        }
      }
    } catch {
      // Config doesn't exist or is invalid, continue with auto-config
    }

    const status = await this.getStatus({ force: Boolean(options.forceStatusRefresh) });
    const candidates = this._collectAutoModelCandidates(options, context);
    const { selected, ranked } = this._selectBestCandidate(candidates, context, options);
    const selectedModel = selected?.modelId;

    if (!selectedModel) {
      return {
        configured: false,
        error: 'No valid NPU model candidates found.',
        context,
      };
    }

    const configuredDevice = String(options.device || (status?.npuAvailable ? 'NPU' : 'AUTO')).trim() || 'AUTO';
    const configuredPrecision = String(options.precision || 'fp16').trim() || 'fp16';
    const config = {
      model_path: selectedModel,
      tokenizer: selected?.tokenizer || selectedModel,
      device: configuredDevice,
      precision: configuredPrecision,
      auto_start: options.enableAutoStart !== false,
      selected_by: 'adaptive-ranking',
      selected_at: new Date().toISOString(),
      workload: context.workload,
      profile: context.profile,
    };

    if (options.dryRun) {
      return {
        configured: true,
        model: selectedModel,
        existing: false,
        autoStart: config.auto_start,
        strategy: 'adaptive-ranking',
        selectedDevice: configuredDevice,
        selectedPrecision: configuredPrecision,
        context,
        ranking: ranked.slice(0, 5),
        dryRun: true,
      };
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Auto-configured model:', selectedModel);
      return {
        configured: true,
        model: selectedModel,
        existing: false,
        autoStart: config.auto_start,
        note: 'Model will be downloaded and converted on first inference request',
        strategy: 'adaptive-ranking',
        selectedDevice: configuredDevice,
        selectedPrecision: configuredPrecision,
        context,
        ranking: ranked.slice(0, 5),
      };
    } catch (error) {
      console.error('[NpuBridge] Failed to auto-configure model:', error);
      return { configured: false, error: error.message };
    }
  }

  /**
   * Set whether NPU server should auto-start on app launch
   */
  async setAutoStart(enabled) {
    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');

    try {
      let config = { auto_start: enabled };
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.auto_start = enabled;
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Auto-start set to:', enabled);
      return { success: true, autoStart: enabled };
    } catch (error) {
      console.error('[NpuBridge] Failed to set auto-start:', error);
      return { success: false, error: error.message };
    }
  }

  // ------------------------------------------------------------------
  // Model loading (via running server API)
  // ------------------------------------------------------------------

  async loadModel(modelPath, options = {}) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model_path: modelPath,
        tokenizer: options.tokenizer || modelPath,
        device: options.device || 'NPU',
        precision: options.precision || 'fp16'
      });

      try {
        const req = http.request(`${this.serverEndpoint}/models/load`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 120000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ success: res.statusCode === 200, data: JSON.parse(data) });
            } catch {
              resolve({ success: false, error: data });
            }
          });
        });

        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Model load timeout' });
        });

        req.write(postData);
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  // ------------------------------------------------------------------
  // Server lifecycle
  // ------------------------------------------------------------------

  /**
   * Start the OpenVINO inference server
   */
  async startServer(options = {}) {
    console.log('[NpuBridge] startServer called');

    if (this.serverProcess) {
      const healthy = await this.checkServerHealth({ force: true });
      if (healthy) {
        console.log('[NpuBridge] Server already running');
        return { success: true, message: 'Server already running' };
      }
      // Stale process handle; clear it and continue with a fresh spawn.
      this.serverProcess = null;
    }

    // Server might already be running from another process/session.
    if (await this.checkServerHealth({ force: true })) {
      this.invalidateStatusCache();
      console.log('[NpuBridge] Detected external OpenVINO server');
      return { success: true, message: 'Server already running (external process)' };
    }

    // Ensure installation is detected (sets pythonExecutable)
    await this.checkOpenVinoInstallation({ force: true });

    if (!this.openvinoInstalled) {
      return {
        success: false,
        error: 'OpenVINO is not installed.',
        setupRequired: true
      };
    }

    let serverScript = options.scriptPath || null;

    const candidates = [
      path.join(__dirname, '../../scripts/start-npu-server.py'),
      path.join(__dirname, '../../python/openvino-server.py'),
    ];

    if (!serverScript) {
      serverScript = candidates.find((p) => fs.existsSync(p)) || candidates[0];
    }

    console.log('[NpuBridge] Server script:', serverScript);

    if (!fs.existsSync(serverScript)) {
      console.error('[NpuBridge] Server script not found');
      return {
        success: false,
        error: 'OpenVINO server script not found. Please set up the Python server first.',
        setupRequired: true
      };
    }

    const pythonCmd = this.pythonExecutable || 'python';
    const pythonArgs = Array.isArray(this.pythonArgs) ? this.pythonArgs : [];
    console.log('[NpuBridge] Using Python:', pythonCmd);

    return new Promise((resolve) => {
      console.log('[NpuBridge] Spawning server process...');

      try {
        this.serverProcess = spawn(pythonCmd, [...pythonArgs, '-u', serverScript], {
          env: {
            ...process.env,
            OPENVINO_DEVICE: options.device || 'NPU',
            PYTHONUNBUFFERED: '1'
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (spawnError) {
        console.error('[NpuBridge] Failed to spawn server process:', spawnError.message);
        resolve({ success: false, error: spawnError.message });
        return;
      }

      let started = false;
      let allOutput = '';
      let allErrors = '';

      const checkStarted = (output) => {
        return output.includes('Running on') ||
               output.includes('Uvicorn running') ||
               output.includes('Application startup complete') ||
               output.includes('Started server process') ||
               output.includes('[DevForge][NPU] Starting OpenVINO server');
      };

      const onStarted = () => {
        if (started) return;
        started = true;
        console.log('[NpuBridge] Server started successfully');
        this.invalidateStatusCache();
        resolve({ success: true, pid: this.serverProcess?.pid });
      };

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        allOutput += output;
        console.log('[OpenVINO Server stdout]', output.trim());
        if (checkStarted(output)) onStarted();
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errOutput = data.toString();
        allErrors += errOutput;
        // uvicorn logs to stderr
        console.log('[OpenVINO Server stderr]', errOutput.trim());
        if (checkStarted(errOutput)) onStarted();
      });

      this.serverProcess.on('error', (error) => {
        console.error('[NpuBridge] Process spawn error:', error);
        this.serverProcess = null;
        if (!started) resolve({ success: false, error: error.message });
      });

      this.serverProcess.on('exit', (code) => {
        console.log('[NpuBridge] Server process exited with code:', code);
        this.serverProcess = null;
        this.invalidateStatusCache();
        if (!started) {
          const errorMsg = allErrors || allOutput || `Server exited with code ${code}`;
          resolve({ success: false, error: errorMsg.substring(0, 500) });
        }
      });

      // Timeout
      setTimeout(() => {
        if (!started) {
          console.error('[NpuBridge] Server start timeout');
          this.stopServer();
          resolve({ success: false, error: 'Server start timeout - check if all dependencies are installed' });
        }
      }, 30000);
    });
  }

  /**
   * Stop the OpenVINO inference server
   */
  async stopServer() {
    if (this.serverProcess) {
      try {
        this.serverProcess.kill();
      } catch {
        // Already dead
      }
      this.serverProcess = null;
    }
    this.invalidateStatusCache();
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Setup instructions
  // ------------------------------------------------------------------

  getSetupInstructions() {
    return {
      title: 'OpenVINO NPU Setup',
      steps: [
        {
          step: 1,
          title: 'Download OpenVINO',
          description: 'Download the OpenVINO toolkit from Intel',
          url: 'https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/download.html'
        },
        {
          step: 2,
          title: 'Install OpenVINO',
          description: 'Run the installer and follow the prompts. Make sure to select NPU support.'
        },
        {
          step: 3,
          title: 'Install Python bindings',
          description: 'Run: pip install openvino',
          command: 'pip install openvino'
        },
        {
          step: 4,
          title: 'Verify NPU detection',
          description: 'Restart DevForge and check Hardware settings'
        }
      ],
      requirements: [
        'Windows 11 22H2 or later',
        'Intel Core Ultra processor with NPU',
        'Latest Intel NPU drivers',
        'Python 3.8 or later'
      ],
      driverUrl: 'https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html'
    };
  }

  // ------------------------------------------------------------------
  // Cache management
  // ------------------------------------------------------------------

  /**
   * Clear all caches (useful after driver updates or fresh setup)
   */
  clearAllCaches() {
    this._installationResult = null;
    this._installationCheckedAt = 0;
    this._devicesResult = null;
    this._devicesCheckedAt = 0;
    this._statusCache = { at: 0, value: null };
    this._serverHealthCache = { at: 0, value: false };
    this.openvinoInstalled = false;
    this.npuAvailable = false;
    this.openvinoPath = null;
    this.pythonExecutable = 'python';
    this.pythonArgs = [];
    this.devices = [];
  }
}

// Singleton instance
let npuBridgeInstance = null;

function getNpuBridge() {
  if (!npuBridgeInstance) {
    npuBridgeInstance = new NpuBridge();
  }
  return npuBridgeInstance;
}

module.exports = {
  NpuBridge,
  getNpuBridge
};
