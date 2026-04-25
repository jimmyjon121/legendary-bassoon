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

// Phase 1: ordered for Intel NPU 3 (~13 TOPS) on the target Copilot+ hardware.
// Small models fit the compute budget and leave iGPU/RTX free for heavier work.
// Anything >3B is deprioritized; users who explicitly want a bigger NPU model
// can still set it via Settings, this list only drives auto-configure.
const DEFAULT_NPU_MODEL_CANDIDATES = [
  // Pre-converted OpenVINO IRs (fastest: no runtime conversion step)
  'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov',
  'OpenVINO/Qwen2.5-0.5B-Instruct-int4-ov',
  'OpenVINO/TinyLlama-1.1B-Chat-v1.0-int4-ov',
  'OpenVINO/SmolLM2-1.7B-Instruct-int4-ov',
  // Hub repos that optimum-intel can convert on first load
  'Qwen/Qwen2.5-0.5B-Instruct',
  'Qwen/Qwen2.5-1.5B-Instruct',
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
    console.log('[NpuBridge] Checking OpenVINO installation (platform:', process.platform, ')');

    if (process.platform !== 'win32') {
      return { installed: false, reason: 'Not Windows' };
    }

    // 1) Prefer a local DevForge virtualenv.
    const envPath = this._findBundledOpenVinoEnv();
    if (envPath) {
      this._setDetectedOpenVinoEnv(envPath);
      const version = this.extractVersionFromEnv(envPath) || 'env';
      console.log('[NpuBridge] OpenVINO detected via bundled venv:', envPath, 'version:', version);
      return { installed: true, path: envPath, version };
    }

    // 2) Check common global OpenVINO toolkit paths.
    const possiblePaths = [
      'C:\\Program Files (x86)\\Intel\\openvino_2024',
      'C:\\Program Files (x86)\\Intel\\openvino_2023',
      'C:\\Program Files\\Intel\\openvino_2024',
      'C:\\Program Files\\Intel\\openvino_2023',
      'C:\\Program Files (x86)\\Intel\\openvino_2025',
      'C:\\Program Files\\Intel\\openvino_2025',
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
        console.log('[NpuBridge] OpenVINO detected via global toolkit:', basePath);
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
    // Also probe the venv python explicitly even if directory check missed it.
    const venvPythonCandidates = this._getVenvPythonCandidates();
    const pythonCandidates = [
      ...venvPythonCandidates.map((exe) => ({ executable: exe, args: [] })),
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
      console.log('[NpuBridge] OpenVINO detected via Python probe:', candidate.executable,
        'version:', probe.version);
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

    console.warn('[NpuBridge] OpenVINO not found by any detection method');
    this.openvinoInstalled = false;
    return { installed: false, reason: 'OpenVINO not found' };
  }

  _getVenvPythonCandidates() {
    const results = [];
    try {
      const projectRoot = path.join(__dirname, '..', '..');
      const cwd = process.cwd();
      let appPath = null;
      try { appPath = require('electron')?.app?.getAppPath?.() || null; } catch { /* noop */ }

      const dirs = [
        process.env.OPENVINO_ENV_DIR,
        appPath ? path.join(appPath, 'openvino-env') : null,
        path.join(projectRoot, 'openvino-env'),
        path.join(cwd, 'openvino-env'),
      ].filter(Boolean);

      for (const dir of dirs) {
        const py = path.join(dir, 'Scripts', 'python.exe');
        if (fs.existsSync(py) && !results.includes(py)) {
          results.push(py);
        }
      }
    } catch { /* noop */ }
    return results;
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
      const projectRootUnpacked = String(projectRoot).includes('app.asar')
        ? String(projectRoot).replace('app.asar', 'app.asar.unpacked')
        : null;
      const resourcesPath = process.resourcesPath || null;
      const execDir = path.dirname(process.execPath || '');
      const cwd = process.cwd();
      const parentOfCwd = path.dirname(cwd);
      const explicit = process.env.OPENVINO_ENV_DIR;
      const explicitPython = process.env.OPENVINO_PYTHON;
      let appPath = null;
      try { appPath = require('electron')?.app?.getAppPath?.() || null; } catch { /* noop */ }

      const fromExplicitPython = explicitPython
        ? path.dirname(path.dirname(String(explicitPython)))
        : null;

      const candidates = [
        explicit,
        fromExplicitPython,
        appPath ? path.join(appPath, 'openvino-env') : null,
        appPath && String(appPath).includes('app.asar')
          ? path.join(String(appPath).replace('app.asar', 'app.asar.unpacked'), 'openvino-env')
          : null,
        resourcesPath ? path.join(resourcesPath, 'openvino-env') : null,
        resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'openvino-env') : null,
        execDir ? path.join(execDir, 'openvino-env') : null,
        execDir ? path.join(execDir, 'resources', 'openvino-env') : null,
        execDir ? path.join(execDir, 'resources', 'app.asar.unpacked', 'openvino-env') : null,
        path.join(projectRoot, 'openvino-env'),
        projectRootUnpacked ? path.join(projectRootUnpacked, 'openvino-env') : null,
        path.join(cwd, 'openvino-env'),
        path.join(parentOfCwd, 'openvino-env'),
      ].filter(Boolean);

      const dedupedCandidates = [];
      const seen = new Set();
      for (const candidate of candidates) {
        const normalized = path.normalize(String(candidate));
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        dedupedCandidates.push(normalized);
      }

      console.log('[NpuBridge] Searching for openvino-env in', dedupedCandidates.length, 'locations');

      for (const envPath of dedupedCandidates) {
        const envPython = path.join(envPath, 'Scripts', 'python.exe');
        const openvinoPackageDir = path.join(envPath, 'Lib', 'site-packages', 'openvino');
        const hasPython = fs.existsSync(envPython);
        const hasOpenvino = fs.existsSync(openvinoPackageDir);
        if (hasPython && hasOpenvino) {
          console.log('[NpuBridge] Found openvino-env at:', envPath);
          return envPath;
        }
      }

      console.warn('[NpuBridge] openvino-env not found in any candidate location');
    } catch (err) {
      console.error('[NpuBridge] _findBundledOpenVinoEnv error:', err?.message);
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
        this.npuAvailable = devices.some((d) => /^NPU(\.|$)/i.test(String(d.id || '').trim()));

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
    const config = this._readConfig();
    const configuredModel = String(config.model_path || config.model_id || '').trim() || null;
    const configuredTokenizer = String(config.tokenizer || configuredModel || '').trim() || null;
    const serverStatus = serverRunning ? await this.getServerStatus() : null;
    const loadedModelPath = String(serverStatus?.model_path || '').trim() || null;
    const configuredDevice = String(config.device || '').trim() || null;
    const serverDevice = String(serverStatus?.device || '').trim() || null;

    const value = {
      openvinoInstalled: true,
      openvinoPath: this.openvinoPath,
      openvinoVersion: installation.version,
      npuAvailable: devices.npuAvailable || false,
      devices: devices.devices || [],
      serverRunning,
      modelConfigured: Boolean(configuredModel),
      model: configuredModel || loadedModelPath,
      modelPath: configuredModel || loadedModelPath,
      tokenizer: configuredTokenizer,
      device: configuredDevice || serverDevice || (devices.npuAvailable ? 'NPU' : 'AUTO'),
      precision: String(config.precision || '').trim() || 'fp16',
      autoStart: Boolean(config.auto_start),
      hybridEnabled: Boolean(config.hybrid_enabled),
      hybridMode: config.hybrid_mode || null,
      modelLoaded: Boolean(serverStatus?.model_loaded),
      loadedModelPath,
      serverDevice: serverDevice || null,
      error: devices.error || null,
      setupRequired: false,
      diagnostics: {
        pythonExecutable: this.pythonExecutable,
        pythonArgs: this.pythonArgs,
        openvinoPath: this.openvinoPath,
        configPath: this._getConfigPath(),
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

  /**
   * Fetch full server status (model path, loaded state) for skip-if-already-loaded optimization.
   */
  async getServerStatus() {
    return new Promise((resolve) => {
      try {
        const req = http.get(`${this.serverEndpoint}/status`, { timeout: 3000 }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch {
        resolve(null);
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

  _getConfigPath() {
    const resPath = process.resourcesPath;
    if (resPath && __dirname.includes('app.asar')) {
      return path.join(resPath, 'scripts', 'openvino-model.json');
    }
    return path.join(__dirname, '../../scripts/openvino-model.json');
  }

  _readConfig() {
    const configPath = this._getConfigPath();
    try {
      if (!fs.existsSync(configPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('[NpuBridge] Failed to read config:', error?.message || error);
      return {};
    }
  }

  async configureModel(modelPath, options = {}) {
    const configPath = this._getConfigPath();
    const existingConfig = this._readConfig();
    const device = String(options.device || existingConfig.device || 'NPU').trim() || 'NPU';
    const config = {
      ...existingConfig,
      model_path: modelPath,
      tokenizer: options.tokenizer || modelPath,
      device,
      precision: options.precision || existingConfig.precision || 'fp16',
      selected_by: options.selectedBy || 'manual',
      selected_at: new Date().toISOString(),
    };
    if (options.enableAutoStart !== undefined) {
      config.auto_start = Boolean(options.enableAutoStart);
    }

    const isHybridDevice = /^(HETERO|MULTI|AUTO:)/i.test(device) || device.includes(',');
    if (!isHybridDevice) {
      config.hybrid_enabled = false;
      config.hybrid_mode = null;
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      this.invalidateStatusCache();
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

    const configPath = this._getConfigPath();
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
            this.invalidateStatusCache();
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
      this.invalidateStatusCache();
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
    const configPath = this._getConfigPath();

    try {
      let config = { auto_start: enabled };
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.auto_start = enabled;
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      this.invalidateStatusCache();
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
          timeout: 300000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const ok = res.statusCode === 200 && parsed.status !== 'error';
              this.invalidateStatusCache();
              resolve({
                success: ok,
                data: parsed,
                error: ok ? null : (parsed.error || `Server returned status ${res.statusCode}`),
              });
            } catch {
              resolve({ success: false, error: data });
            }
          });
        });

        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Model load timeout (5 min) — model may be downloading' });
        });

        req.write(postData);
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  async draftTokens({ prompt = null, prefixTokens = null, lookahead = 4, requestId = null, sampling = {}, branch = null } = {}) {
    return new Promise((resolve) => {
      try {
        const body = JSON.stringify({
          prompt,
          prefix_tokens: prefixTokens,
          lookahead,
          request_id: requestId,
          temperature: Number(sampling.temperature ?? 0),
          top_k: Number(sampling.top_k ?? 40),
          top_p: Number(sampling.top_p ?? 0.95),
          branch,
        });
        const req = http.request(`${this.serverEndpoint}/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (res.statusCode === 200 && parsed.success !== false) {
                resolve({ success: true, ...parsed });
              } else {
                resolve({
                  success: false,
                  error: parsed?.error || `Server returned status ${res.statusCode}`,
                  data: parsed,
                });
              }
            } catch (err) {
              resolve({ success: false, error: err?.message || data });
            }
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Draft request timeout' });
        });
        req.write(body);
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  async cancelDraft(requestId) {
    if (!requestId) return { success: false, error: 'request_id is required' };
    return new Promise((resolve) => {
      try {
        const req = http.request(`${this.serverEndpoint}/draft/${encodeURIComponent(requestId)}`, {
          method: 'DELETE',
          timeout: 10000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve({ success: parsed.success !== false, ...parsed });
            } catch {
              resolve({ success: false, error: data || `Server returned status ${res.statusCode}` });
            }
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Cancel-draft timeout' });
        });
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  // Phase 2 A3: server-side draft sessions. Each session anchors a
  // prompt + running accepted-suffix on the Python side so per-call
  // payloads stay small. We serialize the whole exchange through the
  // existing http stack so timeouts and recovery work uniformly.
  async createDraftSession({ prompt = null, promptTokens = null } = {}) {
    return this._postJson('/draft/session', { prompt, prompt_tokens: promptTokens }, 30000);
  }

  async extendDraftSession({
    sessionId,
    acceptedTokens = null,
    acceptedText = null,
    lookahead = 4,
    requestId = null,
    sampling = {},
  } = {}) {
    if (!sessionId) return { success: false, error: 'session_id is required' };
    return this._postJson(`/draft/session/${encodeURIComponent(sessionId)}/extend`, {
      accepted_tokens: acceptedTokens,
      accepted_text: acceptedText,
      lookahead,
      request_id: requestId,
      temperature: Number(sampling.temperature ?? 0),
      top_k: Number(sampling.top_k ?? 40),
      top_p: Number(sampling.top_p ?? 0.95),
    }, 30000);
  }

  async closeDraftSession(sessionId) {
    if (!sessionId) return { success: false, error: 'session_id is required' };
    return new Promise((resolve) => {
      try {
        const req = http.request(`${this.serverEndpoint}/draft/session/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          timeout: 10000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve({ success: parsed.success !== false, ...parsed });
            } catch {
              resolve({ success: false, error: data || `Server returned status ${res.statusCode}` });
            }
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Close-session timeout' });
        });
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  _postJson(path, body, timeoutMs = 30000) {
    return new Promise((resolve) => {
      try {
        const payload = JSON.stringify(body || {});
        const req = http.request(`${this.serverEndpoint}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (res.statusCode === 200 && parsed.success !== false) {
                resolve({ success: true, ...parsed });
              } else {
                resolve({
                  success: false,
                  error: parsed?.error || `Server returned status ${res.statusCode}`,
                  data: parsed,
                });
              }
            } catch (err) {
              resolve({ success: false, error: err?.message || data });
            }
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: `${path} timeout` });
        });
        req.write(payload);
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  async unloadModel() {
    return new Promise((resolve) => {
      try {
        const req = http.request(`${this.serverEndpoint}/models/unload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': 0,
          },
          timeout: 20000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : {};
              const ok = res.statusCode === 200 && parsed.status !== 'error';
              this.invalidateStatusCache();
              resolve({
                success: ok,
                data: parsed,
                error: ok ? null : (parsed.error || `Server returned status ${res.statusCode}`),
              });
            } catch {
              resolve({ success: false, error: data || `Server returned status ${res.statusCode}` });
            }
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Model unload timeout' });
        });
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
      // Check if the managed process is still alive.
      const processAlive = !this.serverProcess.killed && this.serverProcess.exitCode === null;
      if (processAlive) {
        // Process is still initializing — check health with a brief retry.
        for (let attempt = 0; attempt < 3; attempt++) {
          const healthy = await this.checkServerHealth({ force: true });
          if (healthy) {
            console.log('[NpuBridge] Server already running');
            return { success: true, message: 'Server already running' };
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        // Process is alive but not healthy yet — don't spawn a duplicate.
        console.log('[NpuBridge] Server process alive but not yet healthy; waiting...');
        return { success: true, message: 'Server starting (process alive)' };
      }
      // Process exited — stale handle.
      this.serverProcess = null;
    }

    // Server might already be running from another process/session.
    if (await this.checkServerHealth({ force: true })) {
      this.invalidateStatusCache();
      console.log('[NpuBridge] Detected external OpenVINO server');
      return { success: true, message: 'Server already running (external process)' };
    }

    // If health check failed but port is in use (zombie process), clear it aggressively.
    if (process.platform === 'win32') {
      try {
        console.log('[NpuBridge] Checking for port 8081 conflicts...');
        const { stdout } = await this._runCommand('netstat -ano | findstr :8081');
        const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
        const pids = new Set();
        for (const line of lines) {
          if (!line.includes('LISTENING') && !line.includes('ESTABLISHED')) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && /^\d+$/.test(pid)) {
            pids.add(pid);
          }
        }

        for (const pid of pids) {
          try {
            console.log(`[NpuBridge] Killing conflicting process ${pid} on port 8081`);
            await this._runCommand(`taskkill /F /PID ${pid}`);
          } catch (killErr) {
            console.warn(`[NpuBridge] Failed to kill PID ${pid}:`, killErr?.message);
          }
        }

        if (pids.size > 0) {
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (e) {
        // Ignore "no match" cases, but keep visibility for unexpected errors.
        if (!String(e?.message || '').includes('findstr')) {
          console.warn('[NpuBridge] Port conflict check failed:', e?.message || e);
        }
      }
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

    const resPath = process.resourcesPath || null;
    const candidates = [
      path.join(__dirname, '../../scripts/start-npu-server.py'),
      resPath ? path.join(resPath, 'scripts', 'start-npu-server.py') : null,
      resPath ? path.join(resPath, 'app.asar.unpacked', 'scripts', 'start-npu-server.py') : null,
      path.join(__dirname, '../../python/openvino-server.py'),
    ].filter(Boolean);

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

      let resolvedDevice = options.device;
      if (!resolvedDevice) {
        try {
          const cfgPath = this._getConfigPath();
          if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            if (cfg.hybrid_enabled && cfg.device) {
              resolvedDevice = cfg.device;
            }
          }
        } catch { /* ignore config read errors */ }
        resolvedDevice = resolvedDevice || 'NPU';
      }

      try {
        this.serverProcess = spawn(pythonCmd, [...pythonArgs, '-u', serverScript], {
          env: {
            ...process.env,
            OPENVINO_DEVICE: resolvedDevice,
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

      // Cap captured stdout/stderr so a long-lived NPU server doesn't leak
      // memory through the `allOutput` / `allErrors` closure buffers. We keep
      // the most recent MAX_OUTPUT_BUFFER_BYTES bytes, which is plenty for
      // post-mortem diagnostics after a crash.
      const MAX_OUTPUT_BUFFER_BYTES = 8 * 1024;
      const MAX_LINE_LEN = 500;
      const appendBounded = (existing, incoming) => {
        const combined = existing + incoming;
        if (combined.length <= MAX_OUTPUT_BUFFER_BYTES) return combined;
        return combined.slice(combined.length - MAX_OUTPUT_BUFFER_BYTES);
      };
      const truncateLine = (line) => {
        if (line.length <= MAX_LINE_LEN) return line;
        return `${line.slice(0, MAX_LINE_LEN)} …[+${line.length - MAX_LINE_LEN} chars]`;
      };

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        allOutput = appendBounded(allOutput, output);
        console.log('[OpenVINO Server stdout]', truncateLine(output.trim()));
        if (checkStarted(output)) onStarted();
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errOutput = data.toString();
        allErrors = appendBounded(allErrors, errOutput);
        // uvicorn logs to stderr
        console.log('[OpenVINO Server stderr]', truncateLine(errOutput.trim()));
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

      // Timeout: give the server enough time for first-run model load
      // (OpenVINO can take 60-90s to compile / load a model on first start).
      // Allow override via env var for power users / CI.
      const timeoutMs = Number.parseInt(process.env.DEVFORGE_NPU_START_TIMEOUT_MS || '', 10) || 120000;
      setTimeout(() => {
        if (!started) {
          const tailOut = (allOutput || '').trim().split(/\r?\n/).slice(-5).join(' | ');
          const tailErr = (allErrors || '').trim().split(/\r?\n/).slice(-5).join(' | ');
          console.error(`[NpuBridge] Server start timeout after ${timeoutMs}ms. stdout-tail: ${tailOut || '(empty)'} | stderr-tail: ${tailErr || '(empty)'}`);
          this.stopServer();
          resolve({
            success: false,
            error: `Server start timeout after ${Math.round(timeoutMs / 1000)}s - model may be loading for the first time, or dependencies are missing. Last output: ${(tailErr || tailOut || '(no output)').substring(0, 300)}`,
          });
        }
      }, timeoutMs);
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
          description: 'Run DevForge setup script (installs OpenVINO + server deps).',
          command: 'powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-openvino.ps1'
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
  // Hybrid GPU+NPU unified inference
  // ------------------------------------------------------------------

  _getHybridCapabilitiesSync() {
    const hasNpu = this.devices.some(d => /^NPU/i.test(d.id));
    const hasGpu = this.devices.some(d => /^GPU/i.test(d.id));
    const hasCpu = this.devices.some(d => /^CPU/i.test(d.id));

    const canHetero = hasNpu && hasGpu;
    const canAuto = hasNpu || hasGpu;

    const modes = [];
    if (canHetero) {
      modes.push({
        id: 'hetero-gpu-npu',
        device: 'HETERO:GPU,NPU',
        label: 'Unified Brain',
        description: 'One model split across GPU + NPU as a single pipeline. The GPU handles heavy attention/matmul layers, the NPU handles lighter normalization/activation layers. Two chips, one brain.',
        recommended: true,
      });
      modes.push({
        id: 'multi-gpu-npu',
        device: 'MULTI:GPU,NPU',
        label: 'Throughput Mode',
        description: 'Distributes separate requests across GPU and NPU for higher parallel throughput on batched workloads.',
        recommended: false,
      });
    }
    if (canAuto) {
      const autoDevices = [hasGpu ? 'GPU' : null, hasNpu ? 'NPU' : null, 'CPU'].filter(Boolean);
      modes.push({
        id: 'auto-all',
        device: `AUTO:${autoDevices.join(',')}`,
        label: 'Smart Routing',
        description: 'OpenVINO picks the best device per-layer based on runtime profiling data collected on first run.',
        recommended: !canHetero,
      });
    }
    if (hasNpu) {
      modes.push({ id: 'npu-only', device: 'NPU', label: 'NPU Only', description: 'Dedicated NPU inference.', recommended: false });
    }
    if (hasGpu) {
      modes.push({ id: 'gpu-only', device: 'GPU', label: 'Intel GPU Only', description: 'Intel integrated/discrete GPU inference.', recommended: false });
    }

    return {
      available: canHetero || canAuto,
      canHetero,
      canAuto,
      devices: this.devices,
      modes,
      recommended: modes.find(m => m.recommended) || modes[0] || null,
    };
  }

  async getHybridCapabilities() {
    await this.queryDevices();
    return this._getHybridCapabilitiesSync();
  }

  async enableHybridMode(modeId) {
    // --- Step 1: Verify hardware ---
    const caps = await this.getHybridCapabilities();
    if (!caps.available) {
      return { success: false, error: 'No hybrid-capable devices detected. Need at least Intel GPU + NPU.', setupRequired: false };
    }

    const mode = caps.modes.find(m => m.id === modeId) || caps.recommended;
    if (!mode) {
      return { success: false, error: `Unknown hybrid mode: ${modeId}` };
    }

    console.log(`[NpuBridge] Enabling hybrid mode: ${mode.id} (${mode.device})`);

    // --- Step 2: Ensure OpenVINO is installed (auto-fix) ---
    await this.checkOpenVinoInstallation({ force: true });
    if (!this.openvinoInstalled) {
      console.log('[NpuBridge] OpenVINO not installed — attempting auto-setup...');
      try {
        const appPath = require('electron')?.app?.getAppPath?.() || path.join(__dirname, '../..');
        const { runOpenVinoSetup } = require('./npu-setup');
        const setupResult = await runOpenVinoSetup(appPath);
        if (setupResult?.success) {
          this.clearAllCaches();
          await this.checkOpenVinoInstallation({ force: true });
        }
      } catch (setupErr) {
        console.warn('[NpuBridge] Auto-setup failed:', setupErr?.message);
      }
      if (!this.openvinoInstalled) {
        return { success: false, error: 'OpenVINO is not installed. Please run OpenVINO Setup first.', setupRequired: true };
      }
    }

    // --- Step 3: Read/create config and ensure a model is configured ---
    const configPath = this._getConfigPath();
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch { /* start fresh */ }

    const hasModel = this._looksLikeModelIdentifier(String(config.model_path || config.model_id || '').trim());
    if (!hasModel) {
      console.log('[NpuBridge] No model configured — running autoConfigureModel...');
      try {
        const autoResult = await this.autoConfigureModel({ device: mode.device });
        if (autoResult?.configured && autoResult.model) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          console.log('[NpuBridge] Auto-configured model:', autoResult.model);
        } else {
          console.warn('[NpuBridge] Auto-configure found no model:', autoResult?.error);
        }
      } catch (autoErr) {
        console.warn('[NpuBridge] autoConfigureModel failed:', autoErr?.message);
      }
    }

    // --- Step 4: Write hybrid config ---
    config.device = mode.device;
    config.hybrid_mode = mode.id;
    config.hybrid_enabled = true;
    config.auto_start = true;

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      return { success: false, error: `Failed to write config: ${err.message}` };
    }

    // --- Step 5: Restart server with hybrid device ---
    const wasRunning = await this.checkServerHealth({ force: true });
    if (wasRunning) {
      console.log('[NpuBridge] Restarting server with hybrid device:', mode.device);
      await this.stopServer();
      await new Promise(r => setTimeout(r, 1000));
    }

    const startResult = await this.startServer({ device: mode.device });
    this.invalidateStatusCache();

    // --- Step 6: Load model and report real status ---
    let modelLoaded = false;
    let modelError = null;
    const modelPath = String(config.model_path || config.model_id || '').trim();

    if (startResult.success && modelPath) {
      try {
        const loadResult = await this.loadModel(modelPath, {
          device: mode.device,
          tokenizer: config.tokenizer || modelPath,
          precision: config.precision || 'fp16',
        });
        modelLoaded = loadResult?.success === true;
        if (!modelLoaded) {
          modelError = loadResult?.error || 'Model failed to load';
          console.warn('[NpuBridge] Model load after hybrid switch failed:', modelError);
        }
      } catch (loadErr) {
        modelError = loadErr?.message || 'Model load exception';
        console.warn('[NpuBridge] Model load exception after hybrid switch:', modelError);
      }
    } else if (startResult.success && !modelPath) {
      modelError = 'No model configured. Download an OpenVINO-compatible model first.';
    }

    return {
      success: startResult.success,
      mode,
      device: mode.device,
      modelLoaded,
      modelError,
      error: startResult.success ? null : startResult.error,
    };
  }

  async disableHybridMode() {
    const configPath = this._getConfigPath();
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch { /* start fresh */ }

    const previousDevice = config.device;
    config.device = this.npuAvailable ? 'NPU' : 'AUTO';
    config.hybrid_mode = null;
    config.hybrid_enabled = false;

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      return { success: false, error: `Failed to write config: ${err.message}` };
    }

    if (previousDevice !== config.device) {
      const wasRunning = await this.checkServerHealth({ force: true });
      if (wasRunning) {
        await this.stopServer();
        await new Promise(r => setTimeout(r, 1000));
        await this.startServer({ device: config.device });
      }
    }

    this.invalidateStatusCache();
    return { success: true, device: config.device };
  }

  getHybridStatus() {
    const configPath = this._getConfigPath();
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return {
          enabled: Boolean(config.hybrid_enabled),
          mode: config.hybrid_mode || null,
          device: config.device || 'NPU',
        };
      }
    } catch { /* noop */ }
    return { enabled: false, mode: null, device: 'NPU' };
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
    this.devices = [];

    // Preserve pinned python if set via env var (setup pins these).
    const pinnedPython = process.env.OPENVINO_PYTHON;
    if (pinnedPython && fs.existsSync(pinnedPython)) {
      this.pythonExecutable = pinnedPython;
      this.pythonArgs = [];
    } else {
      this.pythonExecutable = 'python';
      this.pythonArgs = [];
    }
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
